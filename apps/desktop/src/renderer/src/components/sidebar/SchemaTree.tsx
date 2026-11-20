import { SQLTransferDialog } from '../transfer/SQLTransferDialog'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, ChevronDown, Table2, Eye, Columns, Database, Key, RefreshCw, Search, X, Plus, Languages, Trash2, Power } from 'lucide-react'
import { clsx } from 'clsx'
import { useT } from '@renderer/stores/i18nStore'
import { matchesSchemaName } from './schemaSearch'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { schemaRequestKey, useQueryStore } from '@renderer/stores/queryStore'
import { TableDesigner } from '@renderer/components/designer/TableDesigner'
import type { DBType } from '@shared/types/connection'
import type { SchemaTable, SchemaColumn, DatabaseInfo } from '@shared/types/query'

function quoteIdentifierByType(dbType: DBType, name: string): string {
  if (dbType === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  if (dbType === 'postgresql' || dbType === 'sqlite') return `"${name.replace(/"/g, '""')}"`
  return `\`${name.replace(/`/g, '``')}\``
}

function buildPreviewSQL(tableName: string, dbType: DBType): string {
  const t = quoteIdentifierByType(dbType, tableName)
  if (dbType === 'mssql') return `SELECT TOP 200 * FROM ${t};`
  return `SELECT * FROM ${t} LIMIT 200;`
}

function buildCreateTableSQL(tableName: string, dbType: DBType): string {
  const t = quoteIdentifierByType(dbType, tableName)

  if (dbType === 'postgresql') {
    return `CREATE TABLE ${t} (\n  id BIGSERIAL PRIMARY KEY\n);`
  }

  if (dbType === 'mssql') {
    return `CREATE TABLE ${t} (\n  [id] BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY\n);`
  }

  if (dbType === 'sqlite') {
    return `CREATE TABLE ${t} (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT\n);`
  }

  return `CREATE TABLE ${t} (\n  \`id\` BIGINT NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
}

// ──────────────────── Context Menu ────────────────────
interface CtxMenu {
  x: number
  y: number
  table: SchemaTable
  connectionId: string
  database: string
}

function ContextMenu({
  menu,
  onClose,
  onDesign,
  onRefreshSchema,
  onTransfer
}: {
  menu: CtxMenu
  onClose: () => void
  onDesign: () => void
  onRefreshSchema: () => void
  onTransfer: (action: 'import' | 'export') => void
}): JSX.Element {
  const { connections } = useConnectionStore()
  const { openTableTab, newTab, updateTabSQL, updateTabConnection, updateTabDatabase, setActiveTab } = useQueryStore()
  const [confirm, setConfirm] = useState<'truncate' | 'drop' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const conn = connections.find((c) => c.id === menu.connectionId)
  const dbType = conn?.type ?? 'mysql'
  const qt = (name: string): string => quoteIdentifierByType(dbType, name)

  const openInNewTab = (sql: string): void => {
    const tabId = newTab(menu.connectionId)
    updateTabConnection(tabId, menu.connectionId)
    updateTabDatabase(tabId, menu.database)
    updateTabSQL(tabId, sql)
    setActiveTab(tabId)
    onClose()
  }

  const openTableView = (): void => {
    openTableTab(menu.connectionId, menu.table.name, menu.database)
    onClose()
  }

  const handleSelectAll = (): void => {
    openTableView()
  }

  const handleSelectSQL = (): void => {
    const sql = buildPreviewSQL(menu.table.name, dbType)
    openInNewTab(sql)
  }

  const handleCount = (): void => {
    openInNewTab(`SELECT COUNT(*) AS total FROM ${qt(menu.table.name)};`)
  }

  const handleDesign = (): void => {
    onDesign()
    onClose()
  }

  const handleTruncateConfirm = async (): Promise<void> => {
    if (!window.db) return
    setActionError(null)
    try {
      const result = await window.db.executeQuery(
        menu.connectionId,
        `TRUNCATE TABLE ${qt(menu.table.name)};`,
        menu.database
      )
      if (result.error) {
        setActionError(result.error)
        return
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      return
    }
    setConfirm(null)
    onClose()
  }

  const handleDropConfirm = async (): Promise<void> => {
    if (!window.db) return
    setActionError(null)
    try {
      const result = await window.db.executeQuery(
        menu.connectionId,
        `DROP TABLE ${qt(menu.table.name)};`,
        menu.database
      )
      if (result.error) {
        setActionError(result.error)
        return
      }
      onRefreshSchema()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      return
    }
    setConfirm(null)
    onClose()
  }

  const normalItems = [
    { label: '查看数据 (表格)', icon: '▶', action: handleSelectAll },
    { label: '查看数据 (SQL)', icon: 'S', action: handleSelectSQL },
    { label: '统计行数 (COUNT)', icon: '#', action: handleCount },
    { divider: true },
    { label: '设计表 (字段/索引/DDL)', icon: '⊞', action: handleDesign },
    { divider: true },
    { label: '导出表（SQL 文件）', icon: '↑', action: () => { onTransfer('export'); onClose() } },
    { label: '导入表（SQL 文件）', icon: '↓', action: () => { onTransfer('import'); onClose() } },
    { divider: true },
    { label: '清空表', icon: '⊘', action: () => setConfirm('truncate'), danger: true },
    { label: '删除表', icon: '✕', action: () => setConfirm('drop'), danger: true },
  ]

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[200px] text-xs"
        style={{ top: Math.min(menu.y, window.innerHeight - 380), left: Math.min(menu.x, window.innerWidth - 240) }}
      >
        <div className="px-3 py-1 text-text-muted text-2xs border-b border-app-border mb-1 truncate">
          {menu.table.name}
        </div>

        {confirm ? (
          <div className="px-3 py-2">
            <p className="text-text-primary mb-2">
              {confirm === 'truncate'
                ? `确认清空表 "${menu.table.name}"？此操作不可撤销。`
                : `确认删除表 "${menu.table.name}"？此操作不可撤销。`}
            </p>
            {actionError && (
              <p className="text-2xs text-accent-red mt-2 break-all">操作失败：{actionError}</p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={confirm === 'truncate' ? handleTruncateConfirm : handleDropConfirm}
                className="flex-1 px-2 py-1 rounded bg-accent-red text-white text-xs hover:opacity-90 transition-opacity"
              >
                确认
              </button>
              <button
                onClick={() => setConfirm(null)}
                className="flex-1 px-2 py-1 rounded border border-app-border text-text-secondary text-xs hover:text-text-primary transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          normalItems.map((item, i) =>
            'divider' in item ? (
              <div key={i} className="border-t border-app-border my-1" />
            ) : (
              <button
                key={i}
                onClick={item.action}
                className={clsx(
                  'w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors',
                  item.danger
                    ? 'text-accent-red hover:bg-red-900/20'
                    : 'text-text-secondary hover:bg-app-active hover:text-text-primary'
                )}
              >
                <span className="font-mono text-text-muted w-4 text-center shrink-0">{item.icon}</span>
                {item.label}
              </button>
            )
          )
        )}
      </div>
    </>,
    document.body
  )
}

interface DbCtxMenu {
  x: number
  y: number
  connectionId: string
  database: string
}

function DatabaseContextMenu({
  menu,
  onClose,
  onCreateTable,
  onAlterCharset,
  onDropDatabase
}: {
  menu: DbCtxMenu
  onClose: () => void
  onCreateTable: (connectionId: string, database: string) => void
  onAlterCharset: (connectionId: string, database: string) => void
  onDropDatabase: (connectionId: string, database: string) => void
}): JSX.Element {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[220px] text-xs"
        style={{ top: menu.y, left: menu.x }}
      >
        <div className="px-3 py-1 text-text-muted text-2xs border-b border-app-border mb-1 truncate">
          {menu.database}
        </div>
        <button
          onClick={() => {
            onCreateTable(menu.connectionId, menu.database)
            onClose()
          }}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
        >
          <Plus size={12} className="shrink-0 text-accent-green" />
          新建数据表
        </button>
        <button
          onClick={() => {
            onAlterCharset(menu.connectionId, menu.database)
            onClose()
          }}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
        >
          <Languages size={12} className="shrink-0 text-accent-blue" />
          修改数据库字符集
        </button>
        <button
          onClick={() => {
            onDropDatabase(menu.connectionId, menu.database)
            onClose()
          }}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-accent-red hover:bg-app-active transition-colors"
        >
          <Trash2 size={12} className="shrink-0" />
          删除数据库
        </button>
      </div>
    </>,
    document.body
  )
}

type SchemaDialog =
  | {
      type: 'none'
    }
  | {
      type: 'create'
      connectionId: string
      name: string
      charset: string
      collation: string
    }
  | {
      type: 'drop'
      connectionId: string
      database: string
      confirmName: string
    }
  | {
      type: 'charset'
      connectionId: string
      database: string
      charset: string
      collation: string
      applyToAllTables: boolean
    }
  | {
      type: 'createTable'
      connectionId: string
      database: string
      tableName: string
    }
  | {
      type: 'message'
      title: string
      message: string
    }

function SchemaActionDialog({
  dialog,
  submitting,
  onClose,
  onChange,
  onSubmit
}: {
  dialog: SchemaDialog
  submitting: boolean
  onClose: () => void
  onChange: (patch: Record<string, string | boolean>) => void
  onSubmit: () => void
}): JSX.Element | null {
  if (dialog.type === 'none') return null

  const isMessage = dialog.type === 'message'
  const canSubmit = (() => {
    if (dialog.type === 'create') return dialog.name.trim().length > 0
    if (dialog.type === 'drop') return dialog.confirmName.trim() === dialog.database
    if (dialog.type === 'charset') return dialog.charset.trim().length > 0
    if (dialog.type === 'createTable') return dialog.tableName.trim().length > 0
    return true
  })()

  const title =
    dialog.type === 'create'
      ? '新建数据库'
      : dialog.type === 'drop'
        ? '删除数据库'
        : dialog.type === 'charset'
          ? '修改数据库字符集'
          : dialog.type === 'createTable'
            ? '新建数据表'
          : dialog.title

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={() => !submitting && onClose()} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded border border-app-border bg-app-sidebar shadow-2xl">
          <div className="px-4 py-3 border-b border-app-border text-sm font-semibold text-text-primary">{title}</div>

          <div className="px-4 py-3 space-y-3 text-xs text-text-secondary">
            {dialog.type === 'create' && (
              <>
                <div>
                  <div className="mb-1 text-text-muted">数据库名</div>
                  <input
                    value={dialog.name}
                    onChange={(e) => onChange({ name: e.target.value })}
                    className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                    placeholder="例如：nexsql_demo"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-text-muted">字符集（可选）</div>
                    <input
                      value={dialog.charset}
                      onChange={(e) => onChange({ charset: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-text-muted">排序规则（可选）</div>
                    <input
                      value={dialog.collation}
                      onChange={(e) => onChange({ collation: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4_general_ci"
                    />
                  </div>
                </div>
              </>
            )}

            {dialog.type === 'drop' && (
              <>
                <div className="text-accent-red">此操作不可恢复。请输入数据库名确认删除。</div>
                <div>
                  <div className="mb-1 text-text-muted">确认删除：{dialog.database}</div>
                  <input
                    value={dialog.confirmName}
                    onChange={(e) => onChange({ confirmName: e.target.value })}
                    className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                    placeholder={dialog.database}
                  />
                </div>
              </>
            )}

            {dialog.type === 'charset' && (
              <>
                <div className="text-text-muted">目标数据库：{dialog.database}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-text-muted">字符集</div>
                    <input
                      value={dialog.charset}
                      onChange={(e) => onChange({ charset: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-text-muted">排序规则（可选）</div>
                    <input
                      value={dialog.collation}
                      onChange={(e) => onChange({ collation: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4_general_ci"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={dialog.applyToAllTables}
                    onChange={(e) => onChange({ applyToAllTables: e.target.checked })}
                  />
                  <span>同时转换该库所有数据表字段字符集</span>
                </label>
              </>
            )}

            {dialog.type === 'createTable' && (
              <>
                <div className="text-text-muted">目标数据库：{dialog.database}</div>
                <div>
                  <div className="mb-1 text-text-muted">数据表名</div>
                  <input
                    value={dialog.tableName}
                    onChange={(e) => onChange({ tableName: e.target.value })}
                    className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                    placeholder="例如：users"
                  />
                </div>
                <div className="text-2xs text-text-muted">
                  将创建一个默认主键字段 id，你可以随后在表设计器中继续调整字段与索引。
                </div>
              </>
            )}

            {dialog.type === 'message' && (
              <div className="text-text-secondary whitespace-pre-wrap">{dialog.message}</div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-app-border flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors text-xs"
              disabled={submitting}
            >
              {isMessage ? '关闭' : '取消'}
            </button>
            {!isMessage && (
              <button
                onClick={onSubmit}
                disabled={!canSubmit || submitting}
                className="px-3 py-1.5 rounded bg-accent-blue text-white hover:bg-blue-600 transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? '处理中...' : '确认'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

// ──────────────────── TableNode ────────────────────
function TableNode({
  table,
  depth,
  connectionId,
  database,
  onContextMenu,
  highlight
}: {
  table: SchemaTable
  depth: number
  connectionId: string
  database: string
  onContextMenu: (e: React.MouseEvent, table: SchemaTable) => void
  highlight?: string
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [columns, setColumns] = useState<SchemaColumn[]>(table.columns)
  const [loading, setLoading] = useState(false)
  const openTableTab = useQueryStore(state => state.openTableTab)

  const handleToggle = async (): Promise<void> => {
    const next = !expanded
    setExpanded(next)
    if (next && columns.length === 0 && !loading) {
      setLoading(true)
      try {
        const cols = await window.db!.getTableColumns(connectionId, table.name, database)
        setColumns(cols)
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
  }

  const handleDoubleClick = (): void => {
    openTableTab(connectionId, table.name, database)
  }

  // Highlight matching characters
  const renderName = (): JSX.Element => {
    if (!highlight) return <span className="truncate">{table.name}</span>
    const idx = table.name.toLowerCase().indexOf(highlight.toLowerCase())
    if (idx === -1) return <span className="truncate">{table.name}</span>
    return (
      <span className="truncate">
        {table.name.slice(0, idx)}
        <mark className="bg-accent-yellow/40 text-text-primary rounded-sm">{table.name.slice(idx, idx + highlight.length)}</mark>
        {table.name.slice(idx + highlight.length)}
      </span>
    )
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, table)}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        className="w-full flex items-center gap-1.5 py-0.5 pr-3 text-xs text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors group"
        title="双击预览数据，右键更多操作"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {table.type === 'view' ? (
          <Eye size={12} className="text-accent-blue shrink-0" />
        ) : (
          <Table2 size={12} className="text-accent-orange shrink-0" />
        )}
        {renderName()}
        {loading && <span className="ml-auto text-2xs text-text-muted animate-pulse">...</span>}
        {!loading && columns.length > 0 && (
          <span className="text-2xs text-text-muted ml-auto opacity-0 group-hover:opacity-100">{columns.length}</span>
        )}
      </button>
      {expanded && columns.map((col) => (
        <ColumnRow key={col.name} col={col} depth={depth + 1} />
      ))}
    </div>
  )
}

function ColumnRow({ col, depth }: { col: SchemaColumn; depth: number }): JSX.Element {
  const handleCopyColumn = async (e: React.MouseEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(col.name)
    } catch {
      // ignore clipboard write errors
    }
  }

  return (
    <div
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
      className="flex items-center gap-1.5 py-0.5 pr-3 text-2xs text-text-muted"
      onContextMenu={(e) => {
        void handleCopyColumn(e)
      }}
      title="右键复制字段名"
    >
      {col.primaryKey ? (
        <Key size={9} className="shrink-0 text-accent-yellow" />
      ) : (
        <Columns size={9} className="shrink-0" />
      )}
      <span className="truncate">{col.name}</span>
      <span className="ml-auto text-text-muted opacity-70 font-mono">{col.type}</span>
    </div>
  )
}

// ──────────────────── DatabaseNode ────────────────────
function DatabaseNode({
  db,
  depth,
  connectionId,
  expanded,
  onToggle,
  onOpenDatabase,
  onDropDatabase,
  onCreateTable,
  onAlterCharset
}: {
  db: DatabaseInfo
  depth: number
  connectionId: string
  expanded: boolean
  onToggle: () => void
  onOpenDatabase: (connectionId: string, database: string) => void
  onDropDatabase: (connectionId: string, database: string) => void
  onCreateTable: (connectionId: string, database: string) => void
  onAlterCharset: (connectionId: string, database: string) => void
}): JSX.Element {
  const t = useT()
  const [filter, setFilter] = useState('')
  useEffect(() => {
    if (!expanded) setFilter('')
  }, [expanded])
  const loadSchema = useQueryStore(state => state.loadSchema)
  const { connections } = useConnectionStore()
  const dbType = connections.find((c) => c.id === connectionId)?.type ?? 'mysql'
  const hasFilter = expanded && filter.trim().length > 0
  const visibleTables = !expanded ? [] : hasFilter
    ? db.tables.filter(table => matchesSchemaName(table.name, filter))
    : db.tables
  const requestKey = schemaRequestKey(connectionId, db.name)
  const loading = useQueryStore(state => state.schemaLoading[requestKey])
  const loadError = useQueryStore(state => state.schemaErrors[requestKey])

  const [contextMenu, setContextMenu] = useState<CtxMenu | null>(null)
  const [dbContextMenu, setDbContextMenu] = useState<DbCtxMenu | null>(null)
  const [designer, setDesigner] = useState<SchemaTable | null>(null)
  const [transfer, setTransfer] = useState<{ action: 'import' | 'export'; table: string } | null>(null)

  const handleCtx = (e: React.MouseEvent, table: SchemaTable): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, table, connectionId, database: db.name })
  }

  const handleDbCtx = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDbContextMenu({ x: e.clientX, y: e.clientY, connectionId, database: db.name })
  }


  return (
    <div>
      <div
        onContextMenu={handleDbCtx}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        className="w-full flex items-center gap-1 py-0.5 pr-3 text-xs text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors"
        title="点击数据库查看概览，右键可进行管理操作"
      >
        <button
          onClick={onToggle}
          aria-label={`${expanded ? '收起' : '展开'}数据库 ${db.name}`}
          aria-expanded={expanded}
          className="shrink-0 rounded p-0.5 hover:bg-app-active"
          title={expanded ? '收起' : '展开'}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <button
          onClick={() => onOpenDatabase(connectionId, db.name)}
          className="min-w-0 flex-1 flex items-center gap-1 text-left"
        >
          <Database size={11} className="text-accent-blue shrink-0" />
          <span className="truncate">{db.name}</span>
        </button>
        <span className="text-2xs text-text-muted ml-auto shrink-0">{loading ? '加载中…' : !db.tablesLoaded ? '未加载' : hasFilter ? `${visibleTables.length}/${db.tables.length}` : db.tables.length}</span>
      </div>
      {expanded && (
        <div className="pr-3 pt-1 pb-1.5" style={{ paddingLeft: `${depth * 12 + 24}px` }}>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={filter}
              onChange={event => setFilter(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); setFilter('') }
              }}
              aria-label={t('sidebar.searchTablesLabel').replace('{database}', db.name)}
              placeholder={t('sidebar.searchTables').replace('{database}', db.name)}
              className="w-full bg-app-input border border-app-border rounded-md pl-6 pr-6 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
            />
            {filter && <button type="button" onClick={() => setFilter('')} aria-label={t('sidebar.clearTableSearch').replace('{database}', db.name)}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text-primary"><X size={11} /></button>}
          </div>
        </div>
      )}
      {expanded && loadError && <div role="alert" className="px-5 py-2 text-xs text-accent-red break-words">{loadError}<button className="ml-2 underline" onClick={() => void loadSchema(connectionId, db.name)}>重试</button></div>}
      {expanded && !loading && !loadError && db.tablesLoaded && visibleTables.length === 0 && <div className="px-6 py-2 text-xs text-text-muted">{hasFilter ? '当前库没有匹配的表' : '当前库暂无数据表'}</div>}
      {expanded && visibleTables.map((table) => (
        <TableNode
          key={table.name}
          table={table}
          depth={depth + 1}
          connectionId={connectionId}
          database={db.name}
          onContextMenu={handleCtx}
          highlight={hasFilter ? filter : undefined}
        />
      ))}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDesign={() => {
            setDesigner(contextMenu.table)
            setContextMenu(null)
          }}
          onTransfer={action => setTransfer({ action, table: contextMenu.table.name })}
          onRefreshSchema={() => loadSchema(connectionId, db.name)}
        />
      )}
      {transfer && <SQLTransferDialog action={transfer.action} target={{ connectionId, database: db.name, dbType, tables: [transfer.table] }} onClose={() => setTransfer(null)} onImported={() => loadSchema(connectionId, db.name)} />}
      {designer && (
        <TableDesigner
          connectionId={connectionId}
          table={designer.name}
          database={db.name}
          dbType={dbType}
          onClose={() => setDesigner(null)}
        />
      )}
      {dbContextMenu && (
        <DatabaseContextMenu
          menu={dbContextMenu}
          onClose={() => setDbContextMenu(null)}
          onDropDatabase={onDropDatabase}
          onCreateTable={onCreateTable}
          onAlterCharset={onAlterCharset}
        />
      )}
    </div>
  )
}

// ──────────────────── SchemaConnectionNode ────────────────────
function SchemaConnectionNode({
  connectionId,
  connectionName,
  databases,
  isActive,
  activeDatabase,
  onToggleDatabase,
  databaseFilter,
  onCollapse,
  onCreateDatabase,
  onOpenDatabase,
  onCreateTable,
  onDropDatabase,
  onAlterCharset
}: {
  connectionId: string
  connectionName: string
  databases: DatabaseInfo[]
  isActive: boolean
  activeDatabase: string | null
  onToggleDatabase: (connectionId: string, database: string) => void
  databaseFilter: string
  onCollapse: (connectionId: string) => void
  onCreateDatabase: (connectionId: string) => void
  onOpenDatabase: (connectionId: string, database: string) => void
  onCreateTable: (connectionId: string, database: string) => void
  onDropDatabase: (connectionId: string, database: string) => void
  onAlterCharset: (connectionId: string, database: string) => void
}): JSX.Element {
  const requestKey = schemaRequestKey(connectionId)
  const t = useT()
  const disconnect = useConnectionStore(state => state.disconnect)
  const loading = useQueryStore(state => state.schemaLoading[requestKey])
  const loadError = useQueryStore(state => state.schemaErrors[requestKey])
  const loadSchema = useQueryStore(state => state.loadSchema)
  const [expanded, setExpanded] = useState(true)
  const visibleDatabases = databases.filter(database => matchesSchemaName(database.name, databaseFilter))
  const searching = databaseFilter.trim().length > 0
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menu) return
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        trigger.current?.focus()
      }
    }
    const dismiss = (): void => setMenu(null)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', dismiss)
    }
  }, [menu])

  const closeConnection = async (): Promise<void> => {
    if (closing) return
    setClosing(true)
    setCloseError(null)
    try {
      await disconnect(connectionId)
      setMenu(null)
    } catch (error) {
      setCloseError(`${t('conn.closeConnectionFailed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setClosing(false)
    }
  }

  return (
    <div>
      <button
        ref={trigger}
        onClick={() => {
          if (expanded) onCollapse(connectionId)
          setExpanded(value => !value)
        }}
        aria-expanded={expanded}
        aria-haspopup="menu"
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setCloseError(null)
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            setCloseError(null)
            setMenu({ x: rect.left + 12, y: rect.bottom })
          }
        }}
        className={clsx(
          'w-full flex items-center gap-1 px-3 py-1 text-xs hover:bg-app-hover transition-colors',
          isActive ? 'text-text-primary' : 'text-text-secondary'
        )}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate font-medium">{connectionName}</span>
        {searching && <span className="text-2xs text-text-muted tabular-nums shrink-0">{visibleDatabases.length}/{databases.length}</span>}
        <span
          className="ml-auto p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-app-hover"
          title="新建数据库"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onCreateDatabase(connectionId)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onCreateDatabase(connectionId)
            }
          }}
        >
          <Plus size={11} />
        </span>
      </button>
      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null) }} />
          <div role="menu" aria-label={t('conn.actions')} className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 w-[220px] text-xs"
            style={{ top: Math.max(8, Math.min(menu.y, window.innerHeight - 180)), left: Math.max(8, Math.min(menu.x, window.innerWidth - 228)) }}>
            <div className="px-3 py-1 text-text-muted text-2xs border-b border-app-border mb-1 truncate" title={connectionName}>{connectionName}</div>
            <button ref={closeButton} role="menuitem" disabled={closing} onClick={() => void closeConnection()}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors disabled:opacity-50">
              <Power size={12} className="shrink-0" />{t(closing ? 'conn.closingConnection' : 'conn.closeConnection')}
            </button>
            {closeError && <p role="alert" className="px-3 py-2 text-2xs text-accent-red break-words">{closeError}</p>}
          </div>
        </>, document.body
      )}
      {expanded && loading && !databases.length && <div role="status" className="px-6 py-2 text-xs text-text-muted">正在加载数据库列表…</div>}
      {expanded && loadError && <div role="alert" className="px-5 py-2 text-xs text-accent-red">{loadError}<button className="ml-2 underline" onClick={() => void loadSchema(connectionId)}>重试</button></div>}
      {expanded && !loading && !loadError && visibleDatabases.length === 0 && <div className="px-6 py-2 text-xs text-text-muted">{t(searching ? 'sidebar.noDatabaseMatches' : 'sidebar.noDatabases')}</div>}
      {expanded && visibleDatabases.map((db) => (
        <DatabaseNode
          key={db.name}
          db={db}
          depth={1}
          connectionId={connectionId}
          expanded={activeDatabase === db.name}
          onToggle={() => onToggleDatabase(connectionId, db.name)}
          onOpenDatabase={onOpenDatabase}
          onDropDatabase={onDropDatabase}
          onCreateTable={onCreateTable}
          onAlterCharset={onAlterCharset}
        />
      ))}
    </div>
  )
}

// ──────────────────── SchemaTree (root) ────────────────────
export function SchemaTree(): JSX.Element {
  const t = useT()
  const { connections, statuses, activeConnectionId } = useConnectionStore()
  const schema = useQueryStore(state => state.schema)
  const loadSchema = useQueryStore(state => state.loadSchema)
  const openDatabaseTab = useQueryStore(state => state.openDatabaseTab)
  const [expandedDatabase, setExpandedDatabase] = useState<{ connectionId: string; database: string } | null>(null)
  const [databaseFilter, setDatabaseFilter] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [dialog, setDialog] = useState<SchemaDialog>({ type: 'none' })
  const [submitting, setSubmitting] = useState(false)

  const connectedConnections = connections.filter(
    (c) => c.type !== 'redis' && (statuses[c.id] ?? 'disconnected') === 'connected'
  )

  useEffect(() => {
    if (expandedDatabase && (statuses[expandedDatabase.connectionId] !== 'connected' ||
        !matchesSchemaName(expandedDatabase.database, databaseFilter) ||
        (schema[expandedDatabase.connectionId] && !schema[expandedDatabase.connectionId].databases.some(db => db.name === expandedDatabase.database)))) {
      setExpandedDatabase(null)
    }
  }, [statuses, schema, expandedDatabase, databaseFilter])

  const selectDatabase = (connectionId: string, database: string): void => {
    setExpandedDatabase({connectionId, database})
    void loadSchema(connectionId, database, false)
  }
  const toggleDatabase = (connectionId: string, database: string): void => {
    if (expandedDatabase?.connectionId === connectionId && expandedDatabase.database === database) {
      setExpandedDatabase(null)
    } else selectDatabase(connectionId, database)
  }

  const handleRefreshAll = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all(connectedConnections.map((c) => loadSchema(c.id)))
      if (expandedDatabase && useQueryStore.getState().getSchema(expandedDatabase.connectionId)?.databases.some(db => db.name === expandedDatabase.database))
        await loadSchema(expandedDatabase.connectionId, expandedDatabase.database)
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateDatabase = async (connectionId: string): Promise<void> => {
    setDialog({
      type: 'create',
      connectionId,
      name: '',
      charset: 'utf8mb4',
      collation: 'utf8mb4_general_ci'
    })
  }

  const handleDropDatabase = async (connectionId: string, database: string): Promise<void> => {
    setDialog({ type: 'drop', connectionId, database, confirmName: '' })
  }

  const handleAlterDatabaseCharset = async (connectionId: string, database: string): Promise<void> => {
    setDialog({
      type: 'charset',
      connectionId,
      database,
      charset: 'utf8mb4',
      collation: 'utf8mb4_general_ci',
      applyToAllTables: true
    })
  }

  const handleCreateTable = async (connectionId: string, database: string): Promise<void> => {
    setDialog({
      type: 'createTable',
      connectionId,
      database,
      tableName: ''
    })
  }

  const handleOpenDatabase = (connectionId: string, database: string): void => {
    selectDatabase(connectionId, database)
    openDatabaseTab(connectionId, database)
  }

  const handleDialogChange = (patch: Record<string, string | boolean>): void => {
    setDialog((prev) => {
      if (prev.type === 'none' || prev.type === 'message') return prev
      return { ...prev, ...patch }
    })
  }

  const handleDialogSubmit = async (): Promise<void> => {
    if (!window.db || dialog.type === 'none' || dialog.type === 'message') return

    setSubmitting(true)
    try {
      if (dialog.type === 'create') {
        await window.db.createDatabase(
          dialog.connectionId,
          dialog.name.trim(),
          dialog.charset.trim() || undefined,
          dialog.collation.trim() || undefined
        )
        await loadSchema(dialog.connectionId)
      }

      if (dialog.type === 'drop') {
        await window.db.dropDatabase(dialog.connectionId, dialog.database)
        await loadSchema(dialog.connectionId)
      }

      if (dialog.type === 'charset') {
        await window.db.alterDatabaseCharset(
          dialog.connectionId,
          dialog.database,
          dialog.charset.trim(),
          dialog.collation.trim() || undefined,
          dialog.applyToAllTables
        )
        await loadSchema(dialog.connectionId)
      }

      if (dialog.type === 'createTable') {
        const conn = connections.find((c) => c.id === dialog.connectionId)
        const dbType = conn?.type ?? 'mysql'
        const sql = buildCreateTableSQL(dialog.tableName.trim(), dbType)
        await window.db.executeQuery(dialog.connectionId, sql, dialog.database)
        await loadSchema(dialog.connectionId)
      }

      setDialog({ type: 'none' })
    } catch (err) {
      setDialog({
        type: 'message',
        title: '操作失败',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSubmitting(false)
    }
  }


  return (
    <section className="h-full min-h-0 flex flex-col" aria-label={t('sidebar.schema')}>
      {/* Header row: title + refresh */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1.5 shrink-0">
        <span className="text-2xs text-text-muted uppercase tracking-wider font-semibold">{t('sidebar.schema')}</span>
        <button
          onClick={handleRefreshAll}
          disabled={refreshing || connectedConnections.length === 0}
          title="刷新数据库列表和当前展开的库"
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search box */}
      <div className="px-2 pb-2 shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={databaseFilter}
            onChange={(event) => setDatabaseFilter(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setDatabaseFilter('') }}
            disabled={connectedConnections.length === 0}
            aria-label={t('sidebar.searchDatabasesLabel')}
            placeholder={t('sidebar.searchDatabases')}
            className="w-full bg-app-input border border-app-border rounded-md pl-6 pr-6 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
          />
          {databaseFilter && (
            <button
              onClick={() => setDatabaseFilter('')}
              aria-label={t('sidebar.clearDatabaseSearch')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-1" data-testid="schema-tree-scroll">
      {connectedConnections.length === 0 && <div className="px-4 py-6 text-center text-xs text-text-muted">{t('sidebar.connectForSchema')}</div>}
        {connectedConnections.map((conn) => {
          const s = schema[conn.id]
          return (
            <SchemaConnectionNode
              key={conn.id}
              connectionId={conn.id}
              connectionName={conn.name}
              databases={s?.databases ?? []}
              isActive={activeConnectionId === conn.id}
              activeDatabase={expandedDatabase?.connectionId === conn.id ? expandedDatabase.database : null}
              onToggleDatabase={toggleDatabase}
              databaseFilter={databaseFilter}
              onCollapse={(connectionId) => {
                if (expandedDatabase?.connectionId === connectionId) setExpandedDatabase(null)
              }}
              onCreateDatabase={handleCreateDatabase}
              onOpenDatabase={handleOpenDatabase}
              onCreateTable={handleCreateTable}
              onDropDatabase={handleDropDatabase}
              onAlterCharset={handleAlterDatabaseCharset}
            />
          )
        })}

      </div>
      <SchemaActionDialog
        dialog={dialog}
        submitting={submitting}
        onClose={() => !submitting && setDialog({ type: 'none' })}
        onChange={handleDialogChange}
        onSubmit={handleDialogSubmit}
      />
    </section>
  )
}
