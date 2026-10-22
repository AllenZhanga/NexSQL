import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { splitSQL } from '@shared/sqlStatements'
import type { DBType } from '@shared/types/connection'
import type { QueryBatchResult, QueryResult } from '@shared/types/query'
import type { ExportMode } from '@shared/sqlExport'
import { buildSQLExport, downloadText } from './sqlTransfer'

export interface SQLTransferTarget {
  connectionId: string
  database: string
  dbType: DBType
  tables?: string[]
}
export function SQLTransferDialog({
  action,
  target,
  onClose,
  onImported
}: {
  action: 'import' | 'export'
  target: SQLTransferTarget
  onClose: () => void
  onImported: () => void | Promise<void>
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const execution = useRef<string | null>(null)
  const [mode, setMode] = useState<ExportMode>('full')
  const [file, setFile] = useState<{ name: string; sql: string; statements: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<QueryBatchResult | null>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => {
      if (execution.current) void window.db?.cancelQuery(execution.current)
    }
  }, [])
  const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!selected) return
    setReading(true)
    setError('')
    setFile(null)
    setResult(null)
    setMessage('')
    try {
      if (selected.size > 50 * 1024 * 1024) throw new Error('目前支持不超过 50 MB 的 SQL 文件。')
      const sql = (await selected.text()).replace(/^\uFEFF/, '')
      const statements = splitSQL(sql, target.dbType)
      if (!statements.length) throw new Error('文件中没有可执行的 SQL。')
      setFile({ name: selected.name, sql, statements })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReading(false)
    }
  }
  const run = async () => {
    if (busy || !window.db) return
    setBusy(true)
    setError('')
    setMessage('')
    setProgress(0)
    let unsubscribe: (() => void) | undefined
    try {
      if (action === 'export') {
        const sql = await buildSQLExport(
          target.connectionId,
          target.database,
          target.dbType,
          mode,
          target.tables
        )
        downloadText(`${target.tables?.join('-') || target.database}-${mode}.sql`, sql)
        setMessage('SQL 文件已生成。')
      } else if (file && !result) {
        const id = crypto.randomUUID()
        execution.current = id
        unsubscribe = window.db.onQueryProgress((p) => {
          if (p.executionId === id) setProgress(p.index + 1)
        })
        const batch = await window.db.executeBatch(
          id,
          target.connectionId,
          file.sql,
          target.database,
          300000
        )
        setResult(batch)
        setMessage(
          batch.status === 'cancelled'
            ? '导入已停止，已提交的数据仍然保留。'
            : batch.status === 'failed'
              ? '导入结束，部分语句失败，请查看下方日志。'
              : '导入执行完成。'
        )
        await onImported()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      execution.current = null
      unsubscribe?.()
      setBusy(false)
    }
  }
  const failures = result?.results.filter((r: QueryResult) => r.error) ?? []
  return createPortal(
    <dialog
      ref={ref}
      className="sql-transfer-dialog"
      aria-labelledby="sql-transfer-title"
      onCancel={(e) => {
        if (busy || reading) e.preventDefault()
        else onClose()
      }}
    >
      <h2 id="sql-transfer-title">
        {action === 'export' ? '导出表 / 数据库 SQL' : '导入表（SQL 文件）'}
      </h2>
      <p>
        目标：{target.database}{' '}
        {action === 'export' && target.tables?.length
          ? `· ${target.tables.join('、')}`
          : '· 当前数据库'}
      </p>
      {action === 'export' ? (
        <fieldset disabled={busy} className="space-y-3 text-xs">
          {(
            [
              ['structure', '仅结构'],
              ['data', '仅数据（INSERT）'],
              ['full', '结构和数据']
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex gap-2">
              <input
                type="radio"
                name="export-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
          {(target.dbType === 'postgresql' || target.dbType === 'mssql') && mode !== 'data' && (
            <p>当前结构导出主要包含字段定义，尚未完整覆盖约束、索引和序列等对象。</p>
          )}
        </fieldset>
      ) : (
        <>
          <label className="block text-xs">
            选择 SQL 文件（UTF-8，最大 50 MB）
            <input
              type="file"
              accept=".sql"
              disabled={busy || reading}
              onChange={readFile}
              className="block mt-2"
            />
          </label>
          <p>
            按文件原始 SQL
            导入当前数据库，表名以文件为准。报错后继续执行后续语句；事务遵循数据库规则。
          </p>
          {file && (
            <>
              <p>
                {file.name} · {file.statements.length} 条语句 / 批次
                {busy ? ` · 已处理 ${progress}` : ''}
              </p>
              <pre className="sql-transfer-preview">
                {file.statements.slice(0, 5).join('\n\n')}
                {file.statements.length > 5 ? '\n\n…仅预览前 5 条' : ''}
              </pre>
            </>
          )}
        </>
      )}
      {reading && <p role="status">正在读取文件…</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-accent-red">
          {error}
        </p>
      )}
      {result && (
        <div className="text-xs space-y-2">
          <p>
            成功结果 {result.results.length - failures.length} · 失败 {failures.length}
          </p>
          {result.error && <p className="text-accent-red">{result.error}</p>}
          {result.warning && <p>{result.warning}</p>}
          {failures.length > 0 && (
            <pre className="sql-transfer-preview">
              {failures.map((r) => `${r.error}\n${r.sql}`).join('\n\n')}
            </pre>
          )}
        </div>
      )}
      <footer>
        <button disabled={busy || reading} onClick={onClose}>
          关闭
        </button>
        {busy && action === 'import' ? (
          <button
            onClick={() => {
              if (execution.current) void window.db?.cancelQuery(execution.current)
            }}
          >
            停止导入
          </button>
        ) : (
          <button
            disabled={busy || reading || (action === 'import' && (!file || !!result))}
            onClick={() => void run()}
          >
            {busy ? '导出中…' : action === 'export' ? '导出 SQL 文件' : '确认导入'}
          </button>
        )}
      </footer>
    </dialog>,
    document.body
  )
}
