import mysql, { type Pool, type PoolConnection, type RowDataPacket, type OkPacket } from 'mysql2/promise'
import type { IDbDriver, DriverResult, DriverTableInfo, DriverColumnInfo, DriverIndexInfo } from '../types'

interface MySQLConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
}

export class MySQLDriver implements IDbDriver {
  private pool: Pool
  private currentDatabase: string

  constructor(config: MySQLConfig) {
    this.currentDatabase = config.database
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit: 5,
      multipleStatements: false,
      // Keep connections alive so the server doesn't drop them after wait_timeout
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    })
  }

  /** Escapes a database name for use in a USE statement. */
  private quoteDbName(database: string): string {
    return `\`${database.replace(/\`/g, '\`\`')}\``
  }

  /** Acquires a connection with the current database selected on it. */
  private async withScopedConnection<T>(action: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection()
    try {
      if (this.currentDatabase) {
        // USE must run on the SAME connection as the query: issuing it through
        // pool.query() only applies to one pooled connection, so a subsequent
        // query could land on another connection with the wrong database.
        await conn.query(`USE ${this.quoteDbName(this.currentDatabase)}`)
      }
      return await action(conn)
    } finally {
      conn.release()
    }
  }

  async testConnection(): Promise<void> {
    const conn = await this.pool.getConnection()
    await conn.ping()
    conn.release()
  }

  async execute(sql: string): Promise<DriverResult> {
    const trimmed = sql.trim().toUpperCase()
    const isSelect =
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('WITH') ||
      trimmed.startsWith('SHOW') ||
      trimmed.startsWith('DESCRIBE') ||
      trimmed.startsWith('DESC') ||
      trimmed.startsWith('EXPLAIN')

    return this.withScopedConnection(async (conn) => {
      if (isSelect) {
        const [rows, fields] = await conn.query(sql) as [RowDataPacket[], mysql.FieldPacket[]]
        const columns = (fields || []).map((f) => ({
          name: f.name,
          type: f.type !== undefined ? String(f.type) : 'unknown'
        }))
        return {
          columns,
          rows: rows as Record<string, unknown>[],
          rowCount: rows.length
        }
      } else {
        const [result] = await conn.query(sql) as [OkPacket, mysql.FieldPacket[]]
        return {
          columns: [],
          rows: [],
          rowCount: result.affectedRows ?? 0,
          affectedRows: result.affectedRows
        }
      }
    })
  }

  async transaction(sqls: string[]): Promise<void> {
    await this.withScopedConnection(async (conn) => {
      await conn.beginTransaction()
      try {
        for (const statement of sqls) {
          await conn.query(statement)
        }
        await conn.commit()
      } catch (err) {
        try {
          await conn.rollback()
        } catch {
          // ignore rollback failures while handling the original error
        }
        throw err
      }
    })
  }

  async getDatabases(): Promise<string[]> {
    const [rows] = await this.pool.query('SHOW DATABASES') as [RowDataPacket[], mysql.FieldPacket[]]
    return rows.map((r) => r['Database'] as string)
  }

  async getTables(database?: string): Promise<DriverTableInfo[]> {
    const db = database ?? this.currentDatabase
    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [db]
    ) as [RowDataPacket[], mysql.FieldPacket[]]
    return rows.map((r) => ({
      name: r['TABLE_NAME'] as string,
      type: (r['TABLE_TYPE'] === 'VIEW' ? 'view' : 'table') as 'table' | 'view'
    }))
  }

  async getColumns(table: string, database?: string): Promise<DriverColumnInfo[]> {
    const db = database ?? this.currentDatabase
    const [rows] = await this.pool.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [db, table]
    ) as [RowDataPacket[], mysql.FieldPacket[]]
    return rows.map((r) => ({
      name: r['COLUMN_NAME'] as string,
      type: r['DATA_TYPE'] as string,
      nullable: r['IS_NULLABLE'] === 'YES',
      primaryKey: r['COLUMN_KEY'] === 'PRI',
      defaultValue: r['COLUMN_DEFAULT'] != null ? String(r['COLUMN_DEFAULT']) : undefined,
      collation: r['COLLATION_NAME'] != null ? String(r['COLLATION_NAME']) : undefined
    }))
  }

  async useDatabase(database: string): Promise<void> {
    // Only track the target database here; the actual USE is issued inside
    // execute()/transaction() on the same connection that runs the query.
    this.currentDatabase = database
  }

  async getIndexes(table: string, database?: string): Promise<DriverIndexInfo[]> {
    const db = database ?? this.currentDatabase
    const [rows] = await this.pool.query(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [db, table]
    ) as [RowDataPacket[], mysql.FieldPacket[]]
    const map = new Map<string, DriverIndexInfo>()
    for (const r of rows) {
      const name = r['INDEX_NAME'] as string
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: !r['NON_UNIQUE'], primary: name === 'PRIMARY' })
      }
      map.get(name)!.columns.push(r['COLUMN_NAME'] as string)
    }
    return Array.from(map.values())
  }

  async getTableDDL(table: string, database?: string): Promise<string> {
    const db = database ?? this.currentDatabase
    // Fully-qualified name: no USE needed, immune to pooled-connection races.
    const [rows] = await this.pool.query(
      `SHOW CREATE TABLE \`${db.replace(/\`/g, '\`\`')}\`\.\`${table.replace(/\`/g, '\`\`')}\``
    ) as [RowDataPacket[], mysql.FieldPacket[]]
    return (rows[0]?.['Create Table'] ?? rows[0]?.['Create View'] ?? '') as string
  }

  async disconnect(): Promise<void> {
    await this.pool.end()
  }
}
