import mysql from 'mysql2/promise'
import { Client } from 'pg'
import * as mssql from 'mssql'
import Database from 'better-sqlite3'
import { splitSQL } from '@shared/sqlStatements'
import type { ConnectionConfig } from '@shared/types/connection'
import type { QueryResult, QueryBatchResult } from '@shared/types/query'

process.once('message', (data) => {
  const {
    config,
    password,
    database,
    sql: script
  } = data as {
    config: ConnectionConfig
    password: string
    database?: string
    sql: string
  }
  let cancelled = false
  let interrupt: (() => Promise<void>) | undefined
  let cancelPending: Promise<void> | undefined
  process.on('message', () => {
    cancelled = true
    cancelPending = interrupt?.().catch((error) => {
      process.send?.({ type: 'cancelError', error: String(error) })
    })
  })
  const start = Date.now()
  async function main(): Promise<void> {
    const results: QueryResult[] = []
    let totalStatements = 0
    let close: (() => Promise<void>) | undefined
    let execute: (
      statement: string
    ) => Promise<Array<Pick<QueryResult, 'columns' | 'rows' | 'rowCount'>>>
    let error: string | undefined
    let warning: string | undefined
    let transactionOpen = false
    try {
      const statements = splitSQL(script, config.type)
      totalStatements = statements.length
      if (!statements.length) throw new Error('没有可执行的 SQL')
      const target = database || config.database
      if (config.type === 'mysql') {
        const options = {
          host: config.host,
          port: config.port,
          user: config.username,
          password,
          database: target,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
          connectTimeout: 15000
        }
        const conn = await mysql.createConnection(options)
        close = async () => {
          await cancelPending
          if (transactionOpen)
            warning = '本次执行中有未提交事务，关闭会话时已回滚。请在同一次执行中包含 COMMIT。'
          conn.destroy()
        }
        interrupt = async () => {
          const control = await mysql.createConnection(options)
          try {
            await control.query(`KILL QUERY ${Number(conn.threadId)}`)
          } finally {
            control.destroy()
          }
        }
        execute = async (statement) => {
          const [rows, fields] = await conn.query(statement)
          if (!Array.isArray(rows))
            transactionOpen = Boolean((rows as mysql.ResultSetHeader).serverStatus & 1)
          if (Array.isArray(rows) && rows.some(Array.isArray)) {
            const sets = rows as unknown as Array<Record<string, unknown>[] | mysql.ResultSetHeader>
            const metadata = fields as unknown as mysql.FieldPacket[][]
            return sets.map((set, index) =>
              Array.isArray(set)
                ? {
                    columns: (metadata[index] || []).map((f) => ({
                      name: f.name,
                      type: String(f.type)
                    })),
                    rows: set,
                    rowCount: set.length
                  }
                : { columns: [], rows: [], rowCount: set.affectedRows }
            )
          }
          if (Array.isArray(rows))
            return [
              {
                columns: (fields || []).map((f) => ({ name: f.name, type: String(f.type) })),
                rows: rows as Record<string, unknown>[],
                rowCount: rows.length
              }
            ]
          return [{ columns: [], rows: [], rowCount: (rows as mysql.ResultSetHeader).affectedRows }]
        }
      } else if (config.type === 'postgresql') {
        const options = {
          host: config.host,
          port: config.port,
          user: config.username,
          password,
          database: target,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: 15000
        }
        const client = new Client(options)
        await client.connect()
        close = async () => {
          await cancelPending
          if (transactionOpen)
            warning = '本次执行中有未提交事务，关闭会话时已回滚。请在同一次执行中包含 COMMIT。'
          await client.end()
        }
        const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
        interrupt = async () => {
          const control = new Client(options)
          await control.connect()
          try {
            await control.query('SELECT pg_cancel_backend($1)', [pid])
          } finally {
            await control.end()
          }
        }
        execute = async (statement) => {
          const result = await client.query(statement)
          if (result.command === 'BEGIN') transactionOpen = true
          if (
            result.command === 'COMMIT' ||
            (result.command === 'ROLLBACK' && !/\bTO\b/i.test(statement))
          )
            transactionOpen = false
          return [
            {
              columns: result.fields.map((f) => ({ name: f.name, type: String(f.dataTypeID) })),
              rows: result.rows,
              rowCount: result.rowCount ?? result.rows.length
            }
          ]
        }
      } else if (config.type === 'mssql') {
        const pool = await new mssql.ConnectionPool({
          server: config.host || 'localhost',
          port: config.port,
          user: config.username,
          password,
          database: target,
          requestTimeout: 0,
          options: { encrypt: config.ssl ?? true, trustServerCertificate: true },
          pool: { max: 1, min: 1 }
        }).connect()
        close = async () => {
          try {
            const pending = await pool.request().query('SELECT @@TRANCOUNT AS pending')
            if (pending.recordset[0].pending > 0) {
              await pool.request().query('ROLLBACK TRANSACTION')
              warning = '本次执行中有未提交事务，已回滚。请在同一次执行中包含 COMMIT。'
            }
          } finally {
            await pool.close()
          }
        }
        await pool.request().query('SET XACT_ABORT ON;')
        execute = async (statement) => {
          const request = pool.request()
          interrupt = async () => {
            request.cancel()
          }
          const result = await request.query(statement)
          const sets = Array.isArray(result.recordsets) ? result.recordsets : []
          if (!sets.length)
            return [
              { columns: [], rows: [], rowCount: result.rowsAffected.reduce((a, b) => a + b, 0) }
            ]
          return sets.map((set) => ({
            columns: Object.values(set.columns).map((c) => ({
              name: c.name,
              type: String(c.type)
            })),
            rows: Array.from(set),
            rowCount: set.length
          }))
        }
      } else if (config.type === 'sqlite') {
        const db = new Database(config.filePath!)
        db.pragma('foreign_keys = ON')
        close = async () => {
          if (db.inTransaction) {
            db.exec('ROLLBACK')
            warning = '本次执行中有未提交事务，已回滚。请在同一次执行中包含 COMMIT。'
          }
          db.close()
        }
        execute = async (statement) => {
          const stmt = db.prepare(statement)
          if (stmt.reader) {
            const rows = stmt.all() as Record<string, unknown>[]
            return [
              {
                columns: stmt.columns().map((c) => ({ name: c.name, type: c.type || 'unknown' })),
                rows,
                rowCount: rows.length
              }
            ]
          }
          return [{ columns: [], rows: [], rowCount: stmt.run().changes }]
        }
      } else throw new Error('当前连接不支持 SQL 批量执行')
      for (let index = 0; index < statements.length; index++) {
        if (cancelled) break
        process.send?.({ type: 'executing', index })
        const began = Date.now()
        try {
          const sets = await execute(statements[index])
          for (const set of sets) {
            const result = { ...set, sql: statements[index], durationMs: Date.now() - began }
            results.push(result)
            process.send?.({ type: 'progress', index, total: statements.length, result })
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
          const result: QueryResult = {
            columns: [],
            rows: [],
            rowCount: 0,
            durationMs: Date.now() - began,
            sql: statements[index],
            error
          }
          results.push(result)
          process.send?.({ type: 'progress', index, total: statements.length, result })
          break
        }
        // Yield between SQLite statements so pending cancellation can be observed.
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      try {
        await close?.()
      } catch (err) {
        error ||= String(err)
      }
      const result: QueryBatchResult = {
        results,
        totalStatements,
        durationMs: Date.now() - start,
        status: cancelled ? 'cancelled' : error ? 'failed' : 'completed',
        error,
        warning
      }
      process.send?.({ type: 'done', result })
      process.disconnect()
    }
  }
  void main()
})
