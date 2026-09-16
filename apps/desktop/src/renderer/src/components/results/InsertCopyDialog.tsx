import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { insertStatements, type SQLDialect } from './resultData'

export function InsertCopyDialog({
  headers,
  rows,
  dialect: initialDialect,
  onClose
}: {
  headers: string[]
  rows: unknown[][]
  dialect: SQLDialect
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const [table, setTable] = useState('')
  const [schema, setSchema] = useState('')
  const [dialect, setDialect] = useState(initialDialect)
  const [message, setMessage] = useState('')
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const output = useMemo(() => {
    try {
      return { sql: insertStatements(headers, rows, table, schema, dialect), error: '' }
    } catch (error) {
      return { sql: '', error: (error as Error).message }
    }
  }, [headers, rows, table, schema, dialect])
  return createPortal(
    <dialog
      ref={ref}
      className="insert-copy-dialog"
      aria-labelledby="insert-copy-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <h2 id="insert-copy-title">复制选区为 INSERT</h2>
      <p>
        {rows.length} 行 · {headers.length} 列 · 仅生成语句，不执行数据库写入
      </p>
      <div className="insert-copy-fields">
        <label>
          数据库语法
          <select
            aria-label="INSERT 数据库语法"
            value={dialect}
            onChange={(e) => setDialect(e.target.value as SQLDialect)}
          >
            <option value="mysql">MySQL</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="sqlite">SQLite</option>
            <option value="mssql">SQL Server</option>
          </select>
        </label>
        <label>
          Schema / 数据库（可选）
          <input
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            placeholder="例如 public"
          />
        </label>
        <label>
          目标表名
          <input
            autoFocus
            value={table}
            onChange={(e) => setTable(e.target.value)}
            placeholder="填写真实目标表名"
          />
        </label>
      </div>
      <p>使用选中列的结果列名；如包含别名或计算列，请确认目标表存在对应字段。</p>
      <textarea
        aria-label="INSERT 语句预览"
        readOnly
        value={output.sql}
        placeholder={output.error}
      />
      <div role="status">{message || (table ? output.error : '')}</div>
      <footer>
        <button onClick={onClose}>关闭</button>
        <button
          disabled={!output.sql}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(output.sql)
              setMessage(`已复制 ${rows.length} 条 INSERT 语句`)
            } catch {
              setMessage('复制失败，请检查剪贴板权限后重试')
            }
          }}
        >
          复制 INSERT
        </button>
      </footer>
    </dialog>,
    document.body
  )
}
