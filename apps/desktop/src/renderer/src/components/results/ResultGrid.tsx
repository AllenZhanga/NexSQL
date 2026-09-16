import { InsertCopyDialog } from './InsertCopyDialog'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, Download, Copy, X, Columns3, PanelRight, Filter } from 'lucide-react'
import type { QueryResult } from '@shared/types/query'
import {
  compareValues,
  selectionJSON,
  type SQLDialect,
  delimitedText,
  rawText,
  selectionBounds,
  type CellPosition
} from './resultData'

export function ResultGrid({
  result,
  active,
  dialect = 'sqlite'
}: {
  result: QueryResult
  active: boolean
  dialect?: SQLDialect
}): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null)
  const scrollPosition = useRef({ top: 0, left: 0 })
  const [insertCopy, setInsertCopy] = useState(false)
  const copyMenuRef = useRef<HTMLDetailsElement>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<number, string>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [hidden, setHidden] = useState<number[]>([])
  const [pinned, setPinned] = useState<number[]>([])
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null)
  const [selection, setSelection] = useState<{ anchor: CellPosition; focus: CellPosition } | null>(
    null
  )
  const [detail, setDetail] = useState<{ row: number; col: number } | null>(null)
  const [formatted, setFormatted] = useState(true)
  const [withHeaders, setWithHeaders] = useState(true)
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null)
  const drag = useRef(false)
  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => {
    const stop = () => {
      drag.current = false
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('blur', stop)
      resizeCleanup.current?.()
    }
  }, [])
  const estimate = (index: number) =>
    Math.min(
      360,
      Math.max(
        120,
        result.columns[index].name.length * 9 + 60,
        ...result.rows
          .slice(0, 30)
          .map((row) => rawText(row[result.columns[index].name]).length * 7 + 24)
      )
    )
  const defaultWidths = useMemo(() => result.columns.map((_, index) => estimate(index)), [result])
  const width = (index: number) => widths[index] ?? defaultWidths[index]
  const visible = [
    ...pinned,
    ...result.columns.map((_, i) => i).filter((i) => !pinned.includes(i))
  ].filter((i) => !hidden.includes(i))
  const rows = useMemo(() => {
    const query = search.toLocaleLowerCase()
    const matches = result.rows
      .map((row, source) => ({ row, source }))
      .filter(
        ({ row }) =>
          (!query ||
            result.columns.some((col) =>
              rawText(row[col.name]).toLocaleLowerCase().includes(query)
            )) &&
          Object.entries(filters).every(
            ([index, value]) =>
              !value ||
              rawText(row[result.columns[Number(index)].name])
                .toLocaleLowerCase()
                .includes(value.toLocaleLowerCase())
          )
      )
    if (sort)
      matches.sort(
        (a, b) =>
          compareValues(
            a.row[result.columns[sort.col].name],
            b.row[result.columns[sort.col].name]
          ) * (sort.desc ? -1 : 1) || a.source - b.source
      )
    return matches
  }, [result, search, filters, sort])
  const virtual = useVirtualizer({
    count: rows.length,
    initialOffset: () => scrollPosition.current.top,
    getScrollElement: () => viewport.current,
    estimateSize: () => 30,
    overscan: 15,
    scrollMargin: showFilters ? 70 : 36
  })
  useLayoutEffect(() => {
    if (active && viewport.current) {
      viewport.current.scrollTop = scrollPosition.current.top
      viewport.current.scrollLeft = scrollPosition.current.left
    }
  }, [active])
  const bounds = selection ? selectionBounds(selection.anchor, selection.focus) : null
  const resetSelection = () => {
    setSelection(null)
    if (viewport.current) viewport.current.scrollTop = 0
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('已复制到剪贴板')
    } catch {
      setNotice('复制失败，请检查剪贴板权限后重试')
    }
  }
  const selectionText = () => {
    if (!bounds) return ''
    const cols = visible.slice(bounds.left, bounds.right + 1)
    return delimitedText(
      cols.map((i) => result.columns[i].name),
      rows
        .slice(bounds.top, bounds.bottom + 1)
        .map(({ row }) => cols.map((i) => row[result.columns[i].name])),
      '\t',
      withHeaders
    )
  }
  const copySelection = () => {
    if (bounds) void copy(selectionText())
  }
  const selectedCols = bounds ? visible.slice(bounds.left, bounds.right + 1) : []
  const selectedHeaders = selectedCols.map((i) => result.columns[i].name)
  const selectedRows = bounds
    ? rows
        .slice(bounds.top, bounds.bottom + 1)
        .map(({ row }) => selectedCols.map((i) => row[result.columns[i].name]))
    : []
  const copyAs = (format: 'tsv' | 'json' | 'insert') => {
    if (copyMenuRef.current) copyMenuRef.current.open = false
    setMenu(null)
    if (!bounds) return
    if (format === 'insert') {
      setInsertCopy(true)
      return
    }
    try {
      if (format === 'json') void copy(selectionJSON(selectedHeaders, selectedRows))
      else copySelection()
    } catch (error) {
      setNotice((error as Error).message)
    }
  }
  const exportCSV = () => {
    const text = delimitedText(
      visible.map((i) => result.columns[i].name),
      rows.map(({ row }) => visible.map((i) => row[result.columns[i].name]))
    )
    const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `nexsql-result-${Date.now()}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice(`已导出 ${rows.length} 行 · ${visible.length} 列`)
  }
  const sticky = (col: number): CSSProperties =>
    pinned.includes(col)
      ? {
          position: 'sticky',
          left:
            44 +
            visible
              .filter((i) => pinned.includes(i))
              .slice(0, pinned.indexOf(col))
              .reduce((sum, i) => sum + width(i), 0),
          zIndex: 2
        }
      : {}
  const startResize = (event: React.PointerEvent, col: number) => {
    event.preventDefault()
    event.stopPropagation()
    resizeCleanup.current?.()
    const start = event.clientX,
      initial = width(col)
    const move = (e: PointerEvent) =>
      setWidths((prev) => ({
        ...prev,
        [col]: Math.max(72, Math.min(1000, initial + e.clientX - start))
      }))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      resizeCleanup.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    resizeCleanup.current = stop
  }
  const detailValue = detail
    ? result.rows[detail.row]?.[result.columns[detail.col].name]
    : undefined
  let detailText = rawText(detailValue)
  if (formatted && detailValue != null) {
    try {
      detailText = JSON.stringify(
        typeof detailValue === 'string' ? JSON.parse(detailValue) : detailValue,
        null,
        2
      )
    } catch {
      /* Plain text remains unchanged. */
    }
  }
  const items = virtual.getVirtualItems()
  return (
    <div className="result-grid-shell">
      <div className="grid-tools">
        <label className="grid-search">
          <Search size={14} />
          <input
            aria-label="搜索当前已加载结果"
            placeholder="搜索当前结果…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              resetSelection()
            }}
          />
          {search && (
            <button
              aria-label="清空搜索"
              onClick={() => {
                setSearch('')
                resetSelection()
              }}
            >
              <X size={13} />
            </button>
          )}
        </label>
        <button
          className={showFilters ? 'active' : ''}
          onClick={() => setShowFilters(!showFilters)}
          aria-pressed={showFilters}
        >
          <Filter size={14} />
          筛选
        </button>
        <details className="grid-columns">
          <summary>
            <Columns3 size={14} />
            列设置
          </summary>
          <div className="grid-column-menu">
            <div className="grid-menu-heading">显示列 / 固定到左侧</div>
            {result.columns.map((col, i) => (
              <div key={i}>
                <label>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(i)}
                    disabled={visible.length === 1 && !hidden.includes(i)}
                    onChange={() => {
                      setHidden((prev) =>
                        prev.includes(i) ? prev.filter((c) => c !== i) : [...prev, i]
                      )
                      setPinned((prev) => prev.filter((c) => c !== i))
                      setSelection(null)
                    }}
                  />
                  {col.name}
                </label>
                <button
                  aria-label={`${pinned.includes(i) ? '取消固定' : '固定'} ${col.name}`}
                  disabled={hidden.includes(i)}
                  onClick={() => {
                    setPinned((prev) =>
                      prev.includes(i) ? prev.filter((c) => c !== i) : [...prev, i]
                    )
                    setSelection(null)
                  }}
                >
                  {pinned.includes(i) ? '已固定' : '固定'}
                </button>
              </div>
            ))}
          </div>
        </details>
        <button disabled={!selection} onClick={copySelection}>
          <Copy size={14} />
          复制选区
        </button>
        <details ref={copyMenuRef} className="grid-columns">
          <summary>复制为…</summary>
          <div className="grid-column-menu grid-copy-menu">
            <button disabled={!selection} onClick={() => copyAs('tsv')}>
              选区 → TSV（表格）
            </button>
            <button disabled={!selection} onClick={() => copyAs('json')}>
              选区 → JSON
            </button>
            <button disabled={!selection} onClick={() => copyAs('insert')}>
              选区 → INSERT 语句…
            </button>
          </div>
        </details>
        <label className="grid-check">
          <input
            type="checkbox"
            checked={withHeaders}
            onChange={(e) => setWithHeaders(e.target.checked)}
          />
          带列名
        </label>
        <button onClick={exportCSV} title="导出筛选后的全部行及可见列">
          <Download size={14} />
          导出 CSV
        </button>
      </div>
      <div className="grid-scope">
        <span>
          仅当前已加载结果 · 显示 {rows.length} / {result.rows.length} 行
        </span>
        {(search || Object.values(filters).some(Boolean) || sort) && (
          <button
            onClick={() => {
              setSearch('')
              setFilters({})
              setSort(null)
              resetSelection()
            }}
          >
            清除筛选与排序
          </button>
        )}
        <span className="grid-feedback" role="status">
          {notice}
        </span>
      </div>
      <div className="grid-body">
        <div
          ref={viewport}
          onScroll={(e) => {
            if (active && e.currentTarget.clientHeight)
              scrollPosition.current = {
                top: e.currentTarget.scrollTop,
                left: e.currentTarget.scrollLeft
              }
          }}
          className="result-grid-scroll"
          onCopy={(e) => {
            if (!bounds || (e.target as HTMLElement).closest('input')) return
            e.preventDefault()
            e.clipboardData.setData('text/plain', selectionText())
            setNotice('已复制到剪贴板')
          }}
          tabIndex={0}
          aria-label="结果表格，方向键移动，Shift 连选，Command 或 Control C 复制"
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest('input,button,summary')) return
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selection) {
              e.preventDefault()
              copySelection()
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && rows.length) {
              e.preventDefault()
              setSelection({
                anchor: { row: 0, col: 0 },
                focus: { row: rows.length - 1, col: visible.length - 1 }
              })
            }
            if (e.key === 'Escape') {
              setMenu(null)
              setDetail(null)
              setSelection(null)
            }
            if (e.key === 'Enter' && selection)
              setDetail({
                row: rows[selection.focus.row].source,
                col: visible[selection.focus.col]
              })
            const delta: Record<string, [number, number]> = {
              ArrowDown: [1, 0],
              ArrowUp: [-1, 0],
              ArrowLeft: [0, -1],
              ArrowRight: [0, 1]
            }
            if (delta[e.key] && rows.length) {
              e.preventDefault()
              const old = selection?.focus ?? { row: 0, col: 0 }
              const [r, c] = delta[e.key]
              const next = {
                row: Math.max(0, Math.min(rows.length - 1, old.row + r)),
                col: Math.max(0, Math.min(visible.length - 1, old.col + c))
              }
              setSelection({
                anchor: e.shiftKey && selection ? selection.anchor : next,
                focus: next
              })
              virtual.scrollToIndex(next.row, { align: 'auto' })
            }
          }}
        >
          <table
            className="result-data-grid"
            style={{ width: 44 + visible.reduce((sum, i) => sum + width(i), 0) }}
          >
            <colgroup>
              <col style={{ width: 44 }} />
              {visible.map((i) => (
                <col key={i} style={{ width: width(i) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="grid-row-number">#</th>
                {visible.map((i) => (
                  <th
                    key={i}
                    style={sticky(i)}
                    aria-sort={sort?.col === i ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                  >
                    <button
                      className="grid-sort"
                      title={`${result.columns[i].name} · ${result.columns[i].type} · 点击排序`}
                      onClick={() => {
                        setSort(
                          sort?.col === i
                            ? sort.desc
                              ? null
                              : { col: i, desc: true }
                            : { col: i, desc: false }
                        )
                        resetSelection()
                      }}
                    >
                      {result.columns[i].name}
                      <span>{sort?.col === i ? (sort.desc ? '↓' : '↑') : '↕'}</span>
                    </button>
                    <span
                      role="separator"
                      aria-label={`调整 ${result.columns[i].name} 列宽`}
                      aria-orientation="vertical"
                      tabIndex={0}
                      className="grid-resizer"
                      onPointerDown={(e) => startResize(e, i)}
                      onDoubleClick={() => setWidths((prev) => ({ ...prev, [i]: estimate(i) }))}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault()
                          setWidths((prev) => ({
                            ...prev,
                            [i]: Math.max(
                              72,
                              Math.min(1000, width(i) + (e.key === 'ArrowRight' ? 16 : -16))
                            )
                          }))
                        }
                      }}
                    />
                  </th>
                ))}
              </tr>
              {showFilters && (
                <tr>
                  <th className="grid-row-number">
                    <Filter size={12} />
                  </th>
                  {visible.map((i) => (
                    <th key={i} style={sticky(i)}>
                      <input
                        aria-label={`筛选 ${result.columns[i].name}`}
                        placeholder="包含…"
                        value={filters[i] ?? ''}
                        onChange={(e) => {
                          setFilters((prev) => ({ ...prev, [i]: e.target.value }))
                          resetSelection()
                        }}
                      />
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {items.length > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visible.length + 1}
                    style={{
                      height: Math.max(0, items[0].start - (showFilters ? 70 : 36)),
                      padding: 0,
                      border: 0
                    }}
                  />
                </tr>
              )}
              {items.map((item) => (
                <tr key={rows[item.index].source}>
                  <td className="grid-row-number">
                    <button
                      aria-label={`选择第 ${item.index + 1} 行`}
                      onClick={() =>
                        setSelection({
                          anchor: { row: item.index, col: 0 },
                          focus: { row: item.index, col: visible.length - 1 }
                        })
                      }
                    >
                      {item.index + 1}
                    </button>
                  </td>
                  {visible.map((col, colIndex) => {
                    const value = rows[item.index].row[result.columns[col].name]
                    const selected =
                      bounds &&
                      item.index >= bounds.top &&
                      item.index <= bounds.bottom &&
                      colIndex >= bounds.left &&
                      colIndex <= bounds.right
                    return (
                      <td
                        key={col}
                        style={sticky(col)}
                        data-selected={selected || undefined}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          e.preventDefault()
                          viewport.current?.focus({ preventScroll: true })
                          drag.current = true
                          const position = { row: item.index, col: colIndex }
                          setSelection((prev) => ({
                            anchor: e.shiftKey && prev ? prev.anchor : position,
                            focus: position
                          }))
                        }}
                        onPointerEnter={() => {
                          if (drag.current)
                            setSelection((prev) =>
                              prev ? { ...prev, focus: { row: item.index, col: colIndex } } : null
                            )
                        }}
                        onDoubleClick={() => setDetail({ row: rows[item.index].source, col })}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setMenu({
                            x: Math.min(e.clientX, window.innerWidth - 220),
                            y: Math.min(e.clientY, window.innerHeight - 290),
                            row: rows[item.index].source,
                            col
                          })
                        }}
                        title="双击查看完整内容"
                      >
                        <span>
                          {value == null ? (
                            <em>NULL</em>
                          ) : value === '' ? (
                            <em>空字符串</em>
                          ) : (
                            rawText(value)
                          )}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {items.length > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visible.length + 1}
                    style={{
                      height: Math.max(
                        0,
                        virtual.getTotalSize() -
                          (items[items.length - 1].end - (showFilters ? 70 : 36))
                      ),
                      padding: 0,
                      border: 0
                    }}
                  />
                </tr>
              )}
            </tbody>
          </table>
          {!rows.length && (
            <div className="grid-empty">
              {result.rows.length
                ? '没有匹配的结果，请调整搜索或筛选条件。'
                : '查询完成，没有返回数据。'}
            </div>
          )}
        </div>
        {detail && (
          <aside className="cell-inspector" aria-label="单元格详情">
            <div className="inspector-title">
              <PanelRight size={15} />
              <strong>单元格详情</strong>
              <button
                aria-label="关闭单元格详情"
                onClick={() => {
                  setDetail(null)
                  viewport.current?.focus()
                }}
              >
                <X size={16} />
              </button>
            </div>
            <h3>{result.columns[detail.col].name}</h3>
            <p>
              原始行 {detail.row + 1} · {result.columns[detail.col].type || '未知类型'}
            </p>
            <div className="inspector-actions">
              <button onClick={() => void copy(rawText(detailValue))}>
                <Copy size={13} />
                复制原值
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={formatted}
                  onChange={(e) => setFormatted(e.target.checked)}
                />
                格式化 JSON
              </label>
            </div>
            <pre tabIndex={0}>
              {detailValue == null
                ? 'NULL'
                : detailValue === ''
                  ? '空字符串（长度 0）'
                  : detailText}
            </pre>
          </aside>
        )}
      </div>
      {menu &&
        createPortal(
          <div
            className="grid-menu-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          >
            <div
              className="grid-cell-menu"
              role="menu"
              style={{ top: menu.y, left: menu.x }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setMenu(null)
                  viewport.current?.focus()
                }
              }}
            >
              <button
                autoFocus
                role="menuitem"
                onClick={() => {
                  void copy(rawText(result.rows[menu.row][result.columns[menu.col].name]))
                  setMenu(null)
                }}
              >
                复制单元格原值
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  void copy(
                    delimitedText(
                      result.columns.map((c) => c.name),
                      [result.columns.map((c) => result.rows[menu.row][c.name])],
                      '\t',
                      withHeaders
                    )
                  )
                  setMenu(null)
                }}
              >
                复制整行 TSV
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  void copy(
                    JSON.stringify(
                      result.rows[menu.row],
                      (_, value) => (typeof value === 'bigint' ? String(value) : value),
                      2
                    )
                  )
                  setMenu(null)
                }}
              >
                复制整行 JSON
              </button>
              <button
                role="menuitem"
                disabled={!selection}
                onClick={() => {
                  copySelection()
                  setMenu(null)
                }}
              >
                复制选区
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setDetail({ row: menu.row, col: menu.col })
                  setMenu(null)
                }}
              >
                查看完整内容
              </button>
              <button role="menuitem" disabled={!selection} onClick={() => copyAs('json')}>
                复制选区为 JSON
              </button>
              <button role="menuitem" disabled={!selection} onClick={() => copyAs('insert')}>
                复制选区为 INSERT…
              </button>
            </div>
          </div>,
          document.body
        )}
      {insertCopy && active && (
        <InsertCopyDialog
          headers={selectedHeaders}
          rows={selectedRows}
          dialect={dialect}
          onClose={() => {
            setInsertCopy(false)
            viewport.current?.focus()
          }}
        />
      )}
      <div className="grid-selection-status">
        {bounds
          ? `已选择 ${bounds.bottom - bounds.top + 1} 行 × ${bounds.right - bounds.left + 1} 列`
          : '拖动选择区域 · Shift 连选 · 双击查看详情'}
        <span>⌘ / Ctrl + C 复制</span>
      </div>
    </div>
  )
}
