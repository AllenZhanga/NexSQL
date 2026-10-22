import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  QueryResult,
  QueryHistoryEntry,
  DatabaseSchema,
  DatabaseInfo,
  SchemaTable,
  SchemaColumn
} from '@shared/types/query'
import { buildExportInsert, terminateDDL } from '@shared/sqlExport'
import { getDriver, getConnectionConfig, reconnectById } from './ConnectionManager'
import { driverResultToQueryResult } from './types'

let internalDb: Database.Database | null = null

function getInternalDb(): Database.Database {
  if (!internalDb) {
    const dbPath = join(app.getPath('userData'), 'nexsql.db')
    internalDb = new Database(dbPath)
  }
  return internalDb
}

/** Network error codes that indicate the connection was dropped by the server */
function isConnectionDropped(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code ?? ''
  const msg = err.message ?? ''
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    msg.includes('Connection lost') ||
    msg.includes('server has gone away') ||
    msg.includes('terminating connection')
  )
}

async function runWithReconnect<T>(connectionId: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (err) {
    if (!isConnectionDropped(err)) throw err
    await reconnectById(connectionId)
    return action()
  }
}

export async function executeQuery(
  connectionId: string,
  sql: string,
  _database?: string
): Promise<QueryResult> {
  const start = Date.now()
  let result: QueryResult

  const runQuery = async (): Promise<QueryResult> => {
    const driver = getDriver(connectionId)
    if (_database) {
      await driver.useDatabase(_database)
    }
    const driverResult = await driver.execute(sql)
    const durationMs = Date.now() - start
    return driverResultToQueryResult(driverResult, sql, durationMs)
  }

  try {
    result = await runQuery()
    saveHistory(connectionId, sql, Date.now() - start, result.rowCount, true)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    result = {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: Date.now() - start,
      sql,
      error: errorMsg
    }
    saveHistory(connectionId, sql, result.durationMs, 0, false, errorMsg)
  }

  return result
}

/**
 * Executes a batch of statements atomically. Each driver runs the statements
 * inside a real transaction (BEGIN/COMMIT, ROLLBACK on failure).
 */
export async function executeTransaction(
  connectionId: string,
  sqls: string[],
  database?: string
): Promise<{ success: boolean; message?: string }> {
  const statements = sqls.map((s) => s.trim()).filter(Boolean)
  if (statements.length === 0) return { success: true }

  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    if (database) {
      await driver.useDatabase(database)
    }
    try {
      await driver.transaction(statements)
      return { success: true }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })
}

export async function getDatabases(connectionId: string): Promise<string[]> {
  return runWithReconnect(connectionId, async () => getDriver(connectionId).getDatabases())
}

export async function getSchema(connectionId: string, database?: string): Promise<DatabaseSchema> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)

    if (config.type === 'redis') {
      const dbNames = await driver.getDatabases()
      return {
        connectionId,
        databases: dbNames.map((name) => ({ name, tables: [] }))
      }
    }

    // Listing a connection must never fan out table queries across every database.
    if (database === undefined) {
      const names = await driver.getDatabases()
      return { connectionId, databases: names.map(name => ({ name, tables: [], tablesLoaded: false })) }
    }

    const tables = await driver.getTables(database)

    // Lazy: only return table list without columns for speed
    const tableList: SchemaTable[] = tables.map((t) => ({
      name: t.name,
      type: t.type,
      columns: [] // loaded on demand
    }))

    const dbInfo: DatabaseInfo = {
      name: database,
      tables: tableList,
      tablesLoaded: true
    }

    return {
      connectionId,
      databases: [dbInfo]
    }
  })
}

export async function getTableColumns(
  connectionId: string,
  table: string,
  database?: string
): Promise<SchemaColumn[]> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    if (config.type === 'redis') return []
    const targetDb = database ?? config.database ?? ''
    const cols = await driver.getColumns(table, targetDb)
    return cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      primaryKey: c.primaryKey,
      defaultValue: c.defaultValue,
      collation: c.collation
    }))
  })
}

export async function getTableIndexes(
  connectionId: string,
  table: string,
  database?: string
): Promise<Array<{ name: string; columns: string[]; unique: boolean; primary: boolean }>> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    if (config.type === 'redis') return []
    const targetDb = database ?? config.database ?? ''
    return driver.getIndexes(table, targetDb)
  })
}

export async function getTableDDL(
  connectionId: string,
  table: string,
  database?: string
): Promise<string> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    if (config.type === 'redis') throw new Error('Redis does not support table DDL')
    const targetDb = database ?? config.database ?? ''
    return driver.getTableDDL(table, targetDb)
  })
}

export async function exportTableSQL(
  connectionId: string,
  table: string,
  database?: string
): Promise<string> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    if (config.type === 'redis') throw new Error('Redis does not support table SQL export')
    const targetDb = database ?? config.database ?? ''

    const ddl = terminateDDL(await driver.getTableDDL(table, targetDb))
    const tables = await driver.getTables(targetDb)
    if (tables.find((item) => item.name === table)?.type === 'view') return ddl
    if (targetDb) await driver.useDatabase(targetDb)
    const dataResult = await driver.execute(buildSelectAllSQL(config.type, table, targetDb))
    const rows = dataResult.rows

    if (rows.length === 0) return ddl + '\n-- No data'

    const columnNames = dataResult.columns.map((c) => c.name)
    const inserts = rows.map((row) => buildInsertSQL(config.type, table, columnNames, row))

    return ddl + '\n\n' + inserts.join('\n')
  })
}

function quoteIdentifierByType(
  type: 'mysql' | 'postgresql' | 'mssql' | 'sqlite' | 'redis',
  name: string
): string {
  if (type === 'mssql') return escapeMSSQLIdentifier(name)
  if (type === 'postgresql' || type === 'sqlite') return escapePostgresIdentifier(name)
  return escapeMySQLIdentifier(name)
}

function buildSelectAllSQL(
  type: 'mysql' | 'postgresql' | 'mssql' | 'sqlite' | 'redis',
  table: string,
  database?: string
): string {
  const ident = quoteIdentifierByType(type, table)
  if (database && type === 'mysql')
    return `SELECT * FROM ${quoteIdentifierByType(type, database)}.${ident}`
  if (database && type === 'mssql')
    return `SELECT * FROM ${quoteIdentifierByType(type, database)}..${ident}`
  return `SELECT * FROM ${ident}`
}

function buildInsertSQL(
  type: 'mysql' | 'postgresql' | 'mssql' | 'sqlite' | 'redis',
  table: string,
  columns: string[],
  row: Record<string, unknown>
): string {
  return buildExportInsert(type, table, columns, row)
}

export async function exportDatabaseSQL(connectionId: string, database?: string): Promise<string> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const targetDb = database ?? config.database ?? ''
    const dbType = config.type

    if (dbType === 'redis') throw new Error('Redis does not support database SQL export')

    if (!targetDb && dbType !== 'sqlite') {
      throw new Error('Select a database to export')
    }

    if (targetDb) {
      await driver.useDatabase(targetDb)
    }

    const tables = await driver.getTables(targetDb)
    const chunks: string[] = [
      '-- NexSQL Database Export',
      `-- Source: ${targetDb || 'main'}`,
      `-- Exported At: ${new Date().toISOString()}`,
      ''
    ]

    if (dbType === 'mysql' && targetDb) {
      chunks.push(`CREATE DATABASE IF NOT EXISTS ${escapeMySQLIdentifier(targetDb)};`)
      chunks.push(`USE ${escapeMySQLIdentifier(targetDb)};`)
      chunks.push('')
    }

    for (const table of tables) {
      const ddl = await driver.getTableDDL(table.name, targetDb)
      chunks.push(`-- ${table.type.toUpperCase()}: ${table.name}`)
      chunks.push(terminateDDL(ddl))

      if (table.type === 'table') {
        if (targetDb) await driver.useDatabase(targetDb)
        const dataResult = await driver.execute(buildSelectAllSQL(dbType, table.name, targetDb))
        if (dataResult.rows.length > 0) {
          const columnNames = dataResult.columns.map((column) => column.name)
          for (const row of dataResult.rows) {
            chunks.push(buildInsertSQL(dbType, table.name, columnNames, row))
          }
        }
      }

      chunks.push('')
    }

    return chunks.join('\n')
  })
}

function escapeMySQLIdentifier(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function escapePostgresIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function escapeMSSQLIdentifier(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

export async function createDatabase(
  connectionId: string,
  database: string,
  charset?: string,
  collation?: string
): Promise<void> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const dbName = database.trim()
    if (!dbName) throw new Error('Database name is required')
    if (config.type === 'redis') throw new Error('Redis does not support database creation')

    if (config.type === 'mysql') {
      const charsetSql = charset?.trim() ? ` CHARACTER SET ${charset.trim()}` : ''
      const collateSql = collation?.trim() ? ` COLLATE ${collation.trim()}` : ''
      await driver.execute(
        `CREATE DATABASE ${escapeMySQLIdentifier(dbName)}${charsetSql}${collateSql}`
      )
      return
    }

    if (config.type === 'postgresql') {
      await driver.execute(`CREATE DATABASE ${escapePostgresIdentifier(dbName)}`)
      return
    }

    if (config.type === 'mssql') {
      await driver.execute(`CREATE DATABASE ${escapeMSSQLIdentifier(dbName)}`)
      return
    }

    throw new Error('Current database type does not support database creation')
  })
}

export async function dropDatabase(connectionId: string, database: string): Promise<void> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const dbName = database.trim()
    if (!dbName) throw new Error('Database name is required')
    if (config.type === 'redis') throw new Error('Redis does not support database deletion')

    if (config.type === 'mysql') {
      // Avoid dropping the currently selected DB.
      await driver.useDatabase('information_schema')
      await driver.execute(`DROP DATABASE ${escapeMySQLIdentifier(dbName)}`)
      return
    }

    if (config.type === 'postgresql') {
      await driver.execute(`DROP DATABASE ${escapePostgresIdentifier(dbName)}`)
      return
    }

    if (config.type === 'mssql') {
      await driver.execute(`DROP DATABASE ${escapeMSSQLIdentifier(dbName)}`)
      return
    }

    throw new Error('Current database type does not support database deletion')
  })
}

export async function alterDatabaseCharset(
  connectionId: string,
  database: string,
  charset: string,
  collation?: string,
  applyToAllTables = false
): Promise<void> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const dbName = database.trim()
    const charsetName = charset.trim()

    if (!dbName) throw new Error('Database name is required')
    if (!charsetName) throw new Error('Charset is required')

    if (config.type === 'redis') {
      throw new Error('Redis does not support charset changes')
    }

    if (config.type !== 'mysql') {
      throw new Error('Only MySQL/MariaDB supports charset changes')
    }

    const collateSql = collation?.trim() ? ` COLLATE ${collation.trim()}` : ''

    await driver.execute(
      `ALTER DATABASE ${escapeMySQLIdentifier(dbName)} CHARACTER SET ${charsetName}${collateSql}`
    )

    if (!applyToAllTables) return

    const tableRows = await driver.execute(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = '${dbName.replace(/'/g, "''")}' AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    )

    for (const row of tableRows.rows) {
      const tableName = String(row['TABLE_NAME'] ?? row['table_name'] ?? '')
      if (!tableName) continue
      await driver.execute(
        `ALTER TABLE ${escapeMySQLIdentifier(dbName)}.${escapeMySQLIdentifier(tableName)} CONVERT TO CHARACTER SET ${charsetName}${collateSql}`
      )
    }
  })
}

export function saveHistory(
  connectionId: string,
  sql: string,
  durationMs: number,
  rowCount: number,
  success: boolean,
  error?: string,
  database?: string
): void {
  try {
    const db = getInternalDb()
    db.prepare(
      `
      INSERT INTO query_history (id, connection_id, sql, duration_ms, row_count, success, error, executed_at, database_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      randomUUID(),
      connectionId,
      sql.trim(),
      durationMs,
      rowCount,
      success ? 1 : 0,
      error ?? null,
      Date.now(),
      database ?? null
    )
  } catch {
    // Non-critical, ignore history save errors
  }
}

export function getHistory(connectionId?: string, limit = 100): QueryHistoryEntry[] {
  const db = getInternalDb()
  const query = connectionId
    ? db.prepare(
        `SELECT * FROM query_history WHERE connection_id = ?
         ORDER BY executed_at DESC LIMIT ?`
      )
    : db.prepare(`SELECT * FROM query_history ORDER BY executed_at DESC LIMIT ?`)

  const rows = (connectionId ? query.all(connectionId, limit) : query.all(limit)) as Array<{
    id: string
    connection_id: string
    database_name?: string
    sql: string
    duration_ms: number
    row_count: number
    success: number
    error: string | null
    executed_at: number
  }>

  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connection_id,
    database: r.database_name,
    sql: r.sql,
    durationMs: r.duration_ms,
    rowCount: r.row_count,
    success: r.success === 1,
    error: r.error ?? undefined,
    executedAt: r.executed_at
  }))
}
