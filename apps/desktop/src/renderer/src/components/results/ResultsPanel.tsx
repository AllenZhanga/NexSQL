import { useState, useMemo, useEffect } from 'react'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Download, AlertCircle, CheckCircle2, Clock, Copy } from 'lucide-react'
import type { QueryResult } from '@shared/types/query'
import { formatCellValue } from '@shared/utils'
import { clsx } from 'clsx'
import { useQueryStore } from '@renderer/stores/queryStore'

interface ResultsPanelProps {
  result: QueryResult | null
  isLoading: boolean
}
export function ResultsPanel({
  result: fallbackResult,
  isLoading
}: ResultsPanelProps): JSX.Element {
  const tab = useQueryStore((state) => state.tabs.find((t) => t.id === state.activeTabId))
  const [selected, setSelected] = useState(0)
  const [messages, setMessages] = useState(false)
  const [now, setNow] = useState(Date.now())
  const results = tab?.batch?.results ?? (fallbackResult ? [fallbackResult] : [])
  useEffect(() => {
    setSelected(0)
    setMessages(false)
  }, [tab?.id, tab?.executionId])
  useEffect(() => {
    if (!isLoading) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [isLoading])
  const result = results[Math.min(selected, results.length - 1)]
  const seconds = Math.max(0, now - (tab?.startedAt ?? now)) / 1000
  return (
    <div className="result-workspace flex flex-col h-full bg-app-bg">
      <div className="result-toolbar">
        <div className="flex items-center gap-3 min-w-0">
          <span className="section-label">执行结果</span>
          <span className="text-xs text-text-muted" role="status">
            {isLoading
              ? `执行中 · ${seconds.toFixed(1)}s`
              : tab?.batch?.status === 'cancelled'
                ? '已停止'
                : tab?.batch?.status === 'failed' || tab?.error
                  ? '执行失败'
                  : results.length
                    ? `${results.length} 个结果 · ${tab?.batch?.durationMs ?? result?.durationMs}ms`
                    : '就绪'}
          </span>
        </div>
        {result?.rows.length ? (
          <button
            onClick={() => exportCSV(result)}
            className="flex items-center gap-2 text-xs text-text-secondary"
          >
            <Download size={13} />
            导出当前结果
          </button>
        ) : null}
      </div>
      {(tab?.error || tab?.batch?.warning || tab?.batch?.status === 'cancelled') && (
        <div role="alert" className="execution-notice">
          {tab.error ||
            tab.batch?.warning ||
            '已停止后续执行。取消不会撤销已经提交的语句，请核实写入结果。'}
        </div>
      )}
      {results.length > 0 && (
        <div className="result-tabs" role="tablist" aria-label="查询结果">
          {results.map((item, index) => (
            <button
              key={index}
              role="tab"
              aria-selected={selected === index && !messages}
              className={clsx('result-tab', selected === index && !messages && 'selected')}
              onClick={() => {
                setSelected(index)
                setMessages(false)
              }}
            >
              {item.error ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
              结果 {index + 1}
              <span className="text-text-muted">{item.rowCount} 行</span>
            </button>
          ))}
          <button
            role="tab"
            aria-selected={messages}
            onClick={() => setMessages(true)}
            className={clsx('result-tab', messages && 'selected')}
          >
            执行日志
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden selectable">
        {messages ? (
          <div className="h-full overflow-auto p-4 space-y-4 text-xs">
            {results.map((item, index) => (
              <div key={index}>
                <div className={item.error ? 'text-accent-red' : 'text-text-secondary'}>
                  #{index + 1} · {item.error || `完成 · ${item.rowCount} 行 · ${item.durationMs}ms`}
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-text-muted">{item.sql}</pre>
              </div>
            ))}
          </div>
        ) : result ? (
          result.error ? (
            <div className="p-5 text-accent-red text-sm whitespace-pre-wrap">{result.error}</div>
          ) : result.columns.length ? (
            <DataTable key={`${tab?.id}-${selected}-${tab?.executionId}`} result={result} />
          ) : (
            <div className="empty-state">
              <CheckCircle2 size={24} />
              <h3>语句执行完成</h3>
              <p>影响 {result.rowCount} 行</p>
            </div>
          )
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <Clock size={24} />
            </span>
            <h3>{isLoading ? '正在执行查询' : '从一个查询开始'}</h3>
            <p>
              {isLoading
                ? '结果会按执行顺序显示，可随时停止本次执行。'
                : '选中 SQL 后执行，或运行当前标签的全部语句。'}
            </p>
            <kbd>⌘ / Ctrl + Enter</kbd>
          </div>
        )}
      </div>
      <div className="result-footer">
        {result ? `${result.columns.length} 列 · ${result.rowCount} 行` : '等待查询'}
        <span>每次执行独立会话 · SQL Server 按 GO 分批</span>
      </div>
    </div>
  )
}

interface CellMenuState {
  x: number
  y: number
  row: Record<string, unknown>
  cellValue: string | null
}

function DataTable({ result }: { result: QueryResult }): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null)

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      result.columns.map((col) => ({
        id: col.name,
        accessorKey: col.name,
        header: col.name,
        size: estimateColumnWidth(col.name, result.rows),
        cell: (info) => {
          const val = info.getValue()
          if (val === null || val === undefined) {
            return <span className="text-text-muted italic">NULL</span>
          }
          return <span className="font-mono">{formatCellValue(val)}</span>
        }
      })),
    [result.columns, result.rows]
  )

  const table = useReactTable({
    data: result.rows,
    columns,
    getCoreRowModel: getCoreRowModel()
  })

  const { rows } = table.getRowModel()

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20
  })

  const totalSize = virtualizer.getTotalSize()
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 'max-content' }}>
        <thead className="sticky top-0 z-10 bg-app-sidebar">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-app-border">
              {/* Row number */}
              <th className="w-10 px-2 py-1.5 text-right text-text-muted border-r border-app-border font-normal">
                #
              </th>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  style={{ width: header.getSize() }}
                  className="px-2 py-1.5 text-left text-text-secondary font-semibold border-r border-app-border whitespace-nowrap"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr>
              <td colSpan={columns.length + 1} style={{ height: `${paddingTop}px` }} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <tr
                key={row.id}
                className={clsx(
                  'border-b border-app-border hover:bg-app-hover transition-colors',
                  virtualRow.index % 2 === 0 ? 'bg-app-bg' : 'bg-app-panel'
                )}
              >
                <td className="px-2 py-1 text-right text-text-muted border-r border-app-border font-mono text-2xs">
                  {virtualRow.index + 1}
                </td>
                {row.getVisibleCells().map((cell) => {
                  const raw = cell.getValue()
                  return (
                    <td
                      key={cell.id}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCellMenu({
                          x: e.clientX,
                          y: e.clientY,
                          row: row.original,
                          cellValue: raw === null || raw === undefined ? null : String(raw)
                        })
                      }}
                      title="右键复制单元格/整行"
                      className="px-2 py-1 border-r border-app-border max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {paddingBottom > 0 && (
            <tr>
              <td colSpan={columns.length + 1} style={{ height: `${paddingBottom}px` }} />
            </tr>
          )}
        </tbody>
      </table>

      {cellMenu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setCellMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setCellMenu(null)
              }}
            />
            <div
              className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[170px] text-xs"
              style={{ top: cellMenu.y, left: cellMenu.x }}
            >
              <button
                onClick={() => {
                  void copyText(cellMenu.cellValue ?? '')
                  setCellMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
              >
                <Copy size={12} />
                复制单元格
              </button>
              <button
                onClick={() => {
                  void copyText(rowToTsv(result.columns, cellMenu.row))
                  setCellMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
              >
                <Copy size={12} />
                复制整行 (TSV)
              </button>
              <button
                onClick={() => {
                  void copyText(JSON.stringify(cellMenu.row, null, 2))
                  setCellMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
              >
                <Copy size={12} />
                复制整行 (JSON)
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  )
}

function rowToTsv(columns: { name: string }[], row: Record<string, unknown>): string {
  return columns
    .map((c) => {
      const v = row[c.name]
      if (v === null || v === undefined) return ''
      return String(v).replace(/\t/g, ' ').replace(/\n/g, ' ')
    })
    .join('\t')
}

function estimateColumnWidth(name: string, rows: Record<string, unknown>[]): number {
  const headerWidth = name.length * 8 + 32
  const sampleRows = rows.slice(0, 20)
  const maxDataWidth = sampleRows.reduce((max, row) => {
    const val = String(row[name] ?? '')
    return Math.max(max, Math.min(val.length * 7 + 16, 300))
  }, 60)
  return Math.max(headerWidth, maxDataWidth)
}

function exportCSV(result: QueryResult): void {
  const headers = result.columns.map((c) => JSON.stringify(c.name)).join(',')
  const dataRows = result.rows.map((row) =>
    result.columns
      .map((c) => {
        const val = row[c.name]
        if (val == null) return ''
        const str = String(val)
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? JSON.stringify(str)
          : str
      })
      .join(',')
  )
  const csv = [headers, ...dataRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nexsql-export-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function copyText(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => {})
}
