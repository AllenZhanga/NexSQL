import { Pool, PoolClient } from 'pg'
import type {
  IDbDriver,
  DriverResult,
  DriverTableInfo,
  DriverColumnInfo,
  DriverIndexInfo
} from '../types'

interface PgConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
}

export class PostgresDriver implements IDbDriver {
  private pool: Pool
  private currentDatabase: string
  private config: PgConfig
  private databasePools = new Map<string, Pool>()

  constructor(config: PgConfig) {
    this.config = config
    this.currentDatabase = config.database
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      // Send keepalive probes so the OS/server doesn't drop idle connections
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000
    })
  }

  private databasePool(database = this.currentDatabase): Pool {
    if (!database || database === this.config.database) return this.pool
    let pool = this.databasePools.get(database)
    if (!pool) {
      pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database,
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000
      })
      this.databasePools.set(database, pool)
    }
    return pool
  }

  private async withScopedClient<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = this.databasePool()
    const client = await pool.connect()
    try {
      return await action(client)
    } finally {
      client.release()
    }
  }

  async testConnection(): Promise<void> {
    const client = await this.pool.connect()
    await client.query('SELECT 1')
    client.release()
  }

  async execute(sql: string): Promise<DriverResult> {
    return this.withScopedClient(async (client) => {
      const result = await client.query(sql)
      const columns = (result.fields || []).map((f) => ({
        name: f.name,
        type: String(f.dataTypeID)
      }))
      return {
        columns,
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? result.rows.length
      }
    })
  }

  async transaction(sqls: string[]): Promise<void> {
    await this.withScopedClient(async (client) => {
      await client.query('BEGIN')
      try {
        for (const statement of sqls) {
          await client.query(statement)
        }
        await client.query('COMMIT')
      } catch (err) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // ignore rollback failures while handling the original error
        }
        throw err
      }
    })
  }

  async getDatabases(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`
    )
    return result.rows.map((r) => r.datname as string)
  }

  async getTables(database?: string): Promise<DriverTableInfo[]> {
    const schema = 'public'
    const result = await this.databasePool(database).query(
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name`,
      [schema]
    )
    return result.rows.map((r) => ({
      name: r.table_name as string,
      type: (r.table_type === 'VIEW' ? 'view' : 'table') as 'table' | 'view'
    }))
  }

  async getColumns(table: string, database?: string): Promise<DriverColumnInfo[]> {
    const schema = 'public'
    const result = await this.databasePool(database).query(
      `SELECT
         c.column_name,
         c.data_type,
         c.is_nullable,
         c.column_default,
         CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT ku.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage ku
           ON tc.constraint_name = ku.constraint_name
           AND tc.table_schema = ku.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = $1
           AND tc.table_name = $2
       ) pk ON c.column_name = pk.column_name
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [schema, table]
    )
    return result.rows.map((r) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: r.is_nullable === 'YES',
      primaryKey: r.is_primary_key as boolean,
      defaultValue: r.column_default != null ? String(r.column_default) : undefined
    }))
  }

  async useDatabase(database: string): Promise<void> {
    // Each target database has its own pool; never treat a database as search_path.
    this.currentDatabase = database
  }

  async getIndexes(table: string, database?: string): Promise<DriverIndexInfo[]> {
    const schema = 'public'
    const result = await this.databasePool(database).query(
      `SELECT i.relname AS index_name, a.attname AS column_name,
              ix.indisunique AS is_unique, ix.indisprimary AS is_primary
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE t.relname = $1 AND n.nspname = $2
       ORDER BY i.relname, a.attnum`,
      [table, schema]
    )
    const map = new Map<string, DriverIndexInfo>()
    for (const r of result.rows) {
      const name = r.index_name as string
      if (!map.has(name)) {
        map.set(name, {
          name,
          columns: [],
          unique: r.is_unique as boolean,
          primary: r.is_primary as boolean
        })
      }
      map.get(name)!.columns.push(r.column_name as string)
    }
    return Array.from(map.values())
  }

  async getTableDDL(table: string, database?: string): Promise<string> {
    const schema = 'public'
    // Build a CREATE TABLE statement from pg_catalog
    const colRes = await this.databasePool(database).query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table]
    )
    const lines = colRes.rows.map((r) => {
      let col = `  "${r.column_name}" ${r.data_type as string}`
      if (r.character_maximum_length) col += `(${r.character_maximum_length})`
      if (r.is_nullable === 'NO') col += ' NOT NULL'
      if (r.column_default) col += ` DEFAULT ${r.column_default as string}`
      return col
    })
    return `CREATE TABLE "${schema}"."${table}" (\n${lines.join(',\n')}\n);`
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.pool.end(),
      ...Array.from(this.databasePools.values(), (pool) => pool.end())
    ])
    this.databasePools.clear()
  }
}
