import { saveHistory } from './QueryExecutor'
import { fork } from 'node:child_process'
import { join } from 'path'
import type { WebContents } from 'electron'
import type { QueryBatchResult, QueryResult } from '@shared/types/query'
import { splitSQL } from '@shared/sqlStatements'
import { getConnectionConfig, getConnectionPassword } from './ConnectionManager'

const runs = new Map<string, { owner: number; cancel: () => void }>()
export function cancelQuery(executionId: string, owner: number): boolean {
  const run = runs.get(executionId)
  if (!run || run.owner !== owner) return false
  run.cancel()
  return true
}
export async function executeBatch(
  sender: WebContents,
  executionId: string,
  connectionId: string,
  sql: string,
  database?: string,
  timeoutMs = 300000
): Promise<QueryBatchResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 3600000)
    throw new Error('无效的查询超时设置')
  if (!executionId || runs.has(executionId)) throw new Error('重复执行请求')
  const config = getConnectionConfig(connectionId)
  const totalStatements = splitSQL(sql, config.type).length
  if (!totalStatements) throw new Error('没有可执行的 SQL')
  const password = getConnectionPassword(connectionId)
  const start = Date.now()
  return new Promise((resolve) => {
    const worker = fork(join(__dirname, 'QueryWorker.js'), [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    })
    worker.stderr?.resume()
    const results: QueryResult[] = []
    let cancelled = false,
      finished = false,
      timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: QueryBatchResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      clearTimeout(killTimer)
      runs.delete(executionId)
      sender.removeListener('destroyed', cancel)
      if (timedOut)
        result = {
          ...result,
          status: 'cancelled',
          error: '查询已超过设置的时限并中止。已提交的语句不会撤销，请核实写入结果。'
        }
      resolve(result)
    }
    const cancel = (): void => {
      if (finished || cancelled) return
      cancelled = true
      if (worker.connected) worker.send('cancel')
      killTimer = setTimeout(
        () => {
          worker.kill('SIGKILL')
        },
        config.type === 'sqlite' ? 50 : 10000
      )
    }
    const timeout = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          cancel()
        }, timeoutMs)
      : undefined
    runs.set(executionId, { owner: sender.id, cancel })
    sender.once('destroyed', cancel)
    worker.on('message', (message: any) => {
      if (message.type === 'progress') {
        results.push(message.result)
        saveHistory(
          connectionId,
          message.result.sql,
          message.result.durationMs,
          message.result.rowCount,
          !message.result.error,
          message.result.error,
          database || config.database
        )
        if (!sender.isDestroyed())
          sender.send('db:queryProgress', {
            executionId,
            index: message.index,
            total: message.total,
            result: message.result
          })
      } else if (message.type === 'done') finish(message.result)
    })
    worker.on('error', (err) =>
      finish({
        results,
        totalStatements,
        durationMs: Date.now() - start,
        status: cancelled ? 'cancelled' : 'failed',
        error: err.message
      })
    )
    worker.send({ config, password, database, sql })
    worker.on('exit', (code) => {
      if (!finished)
        finish({
          results,
          totalStatements,
          durationMs: Date.now() - start,
          status: cancelled ? 'cancelled' : 'failed',
          error: cancelled
            ? '执行已中止。已提交的语句不会撤销；若写入期间中断，请核实数据库状态。'
            : `执行进程退出 (${code})，请核实数据库状态。`
        })
    })
  })
}
