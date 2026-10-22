import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionImportDialog } from '../connection/ConnectionImportDialog'
import {
  Circle,
  Plug,
  Trash2,
  Edit2,
  Copy,
  Download,
  Upload,
  Search,
  X,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { clsx } from 'clsx'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useUIStore } from '@renderer/stores/uiStore'
import { useT } from '@renderer/stores/i18nStore'
import { useSidebarStore } from '@renderer/stores/sidebarStore'
import { matchingConnections, connectionAddress } from './connectionSearch'
import type { ConnectionConfig, ConnectionStatus } from '@shared/types/connection'

const DB_ICONS: Record<string, string> = {
  mysql: 'M',
  postgresql: 'P',
  mssql: 'S',
  sqlite: 'L',
  redis: 'R'
}
const DB_COLORS: Record<string, string> = {
  mysql: 'text-orange-400',
  postgresql: 'text-blue-400',
  mssql: 'text-red-400',
  sqlite: 'text-green-400',
  redis: 'text-rose-400'
}

function StatusDot({ status }: { status: ConnectionStatus }): JSX.Element {
  return (
    <Circle
      size={7}
      className={clsx('shrink-0 fill-current', {
        'text-accent-green': status === 'connected',
        'text-accent-red': status === 'error',
        'text-accent-yellow animate-pulse': status === 'connecting',
        'text-text-muted': status === 'disconnected'
      })}
    />
  )
}

interface CtxMenu {
  x: number
  y: number
  conn: ConnectionConfig
}

function ConnContextMenu({
  menu,
  onClose,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenRedisConsole,
  onOpenRedisBrowser
}: {
  menu: CtxMenu
  onClose: () => void
  onConnect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenRedisConsole: () => void
  onOpenRedisBrowser: () => void
}): JSX.Element {
  const t = useT()
  const items =
    menu.conn.type === 'redis'
      ? [
          { label: t('conn.connectBtn'), action: onConnect },
          { label: t('redis.openConsole'), action: onOpenRedisConsole },
          { label: t('redis.openBrowser'), action: onOpenRedisBrowser },
          { divider: true },
          { label: t('conn.editConnMenu'), action: onEdit },
          { label: t('conn.copyConn'), action: onDuplicate },
          { divider: true },
          { label: t('conn.deleteConn'), action: onDelete, danger: true }
        ]
      : [
          { label: t('conn.connectBtn'), action: onConnect },
          { label: t('conn.editConnMenu'), action: onEdit },
          { label: t('conn.copyConn'), action: onDuplicate },
          { divider: true },
          { label: t('conn.deleteConn'), action: onDelete, danger: true }
        ]

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[180px] text-xs"
        style={{ top: menu.y, left: menu.x }}
      >
        <div className="px-3 py-1 text-text-muted text-2xs border-b border-app-border mb-1 truncate font-medium">
          {menu.conn.name}
        </div>
        {items.map((item, i) =>
          'divider' in item ? (
            <div key={i} className="border-t border-app-border my-1" />
          ) : (
            <button
              key={i}
              onClick={() => {
                item.action()
                onClose()
              }}
              className={clsx(
                'w-full text-left px-3 py-1.5 hover:bg-app-active transition-colors',
                'danger' in item && item.danger
                  ? 'text-accent-red hover:text-accent-red'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </>,
    document.body
  )
}

export function ConnectionList(): JSX.Element {
  const t = useT()
  const {
    connections,
    statuses,
    activeConnectionId,
    connect,
    disconnect,
    deleteConnection,
    duplicateConnection,
    loadConnections
  } = useConnectionStore()
  const { loadSchema, openRedisConsoleTab, openRedisBrowserTab } = useQueryStore()
  const { openConnectionDialog } = useUIStore()
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [showImport, setShowImport] = useState(false)
  const { connectionSearch, collapsedGroups, setConnectionSearch, toggleGroup } = useSidebarStore()
  const searchInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const filtered = useMemo(
    () => matchingConnections(connections, connectionSearch),
    [connections, connectionSearch]
  )
  const searching = !!connectionSearch.trim()
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [connectionSearch])

  const openRedisWorkspace = (conn: ConnectionConfig, mode: 'console' | 'browser'): void => {
    const database = conn.database ?? '0'
    if (mode === 'console') {
      openRedisConsoleTab(conn.id, database)
      return
    }
    openRedisBrowserTab(conn.id, database)
  }

  const showConnectError = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err)
    alert(`${t('conn.connectFailed')}\n${message}`)
  }

  const handleConnect = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const status = statuses[id] ?? 'disconnected'
    const conn = connections.find((item) => item.id === id)
    if (status === 'connected') {
      await disconnect(id)
    } else {
      try {
        await connect(id)
        if (conn?.type !== 'redis') {
          await loadSchema(id)
        }
      } catch (err) {
        console.error('Connection failed:', err)
        showConnectError(err)
      }
    }
  }

  const handleDoubleClick = async (conn: ConnectionConfig): Promise<void> => {
    const status = statuses[conn.id] ?? 'disconnected'
    if (status !== 'connected') {
      try {
        await connect(conn.id)
      } catch (err) {
        showConnectError(err)
        return
      }
    }

    useConnectionStore.getState().setActiveConnection(conn.id)

    if (conn.type === 'redis') {
      openRedisWorkspace(conn, 'browser')
      return
    }

    // 不自动绑定当前查询标签页的连接：避免双击连接时静默改写正在编辑的标签页
    await loadSchema(conn.id)
  }

  const handleContextMenu = (e: React.MouseEvent, conn: ConnectionConfig): void => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, conn })
  }

  const handleDuplicate = async (id: string, e?: React.MouseEvent): Promise<void> => {
    e?.stopPropagation()
    try {
      await duplicateConnection(id)
      await loadConnections()
    } catch (err) {
      console.error('复制连接失败:', err)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (confirm('确定要删除这个连接吗？')) await deleteConnection(id)
  }

  const handleExportConnections = async (): Promise<void> => {
    if (!window.db) return
    const json = await window.db.exportConnections()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'nexsql-connections.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportConnections = (): void => {
    setShowImport(true)
  }

  const grouped = filtered.reduce<Map<string, ConnectionConfig[]>>((acc, conn) => {
    const group = conn.group || ''
    const members = acc.get(group) ?? []
    members.push(conn)
    acc.set(group, members)
    return acc
  }, new Map())
  const groupNames = [...grouped.keys()].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)
  )
  const visible = groupNames.flatMap((group) =>
    searching || !collapsedGroups.includes(group) ? grouped.get(group)! : []
  )
  const focusRow = (id: string): void => {
    const row = rowRefs.current.get(id)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <section
      className="connection-pane h-full min-h-0 flex flex-col"
      aria-label={t('sidebar.connections')}
    >
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between shrink-0">
        <span className="text-2xs text-text-muted uppercase tracking-wider font-semibold">
          {t('sidebar.connections')}{' '}
          <span className="font-normal tabular-nums" aria-live="polite">
            {searching ? `${filtered.length} / ${connections.length}` : connections.length}
          </span>
        </span>
        <div className="flex gap-1">
          <button
            onClick={handleImportConnections}
            title={t('export.importConnections')}
            className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-app-hover transition-colors"
          >
            <Upload size={12} />
          </button>
          <button
            onClick={handleExportConnections}
            title={t('export.exportConnections')}
            className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-app-hover transition-colors"
          >
            <Download size={12} />
          </button>
        </div>
      </div>
      <div className="px-2 pb-2 shrink-0">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            ref={searchInput}
            type="text"
            value={connectionSearch}
            aria-label={t('sidebar.searchConnections')}
            placeholder={t('sidebar.searchConnections')}
            aria-describedby="connection-search-hint"
            onChange={(e) => setConnectionSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Escape') {
                e.preventDefault()
                setConnectionSearch('')
              }
              if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && visible.length) {
                e.preventDefault()
                focusRow((e.key === 'ArrowDown' ? visible[0] : visible.at(-1)!).id)
              }
              if (e.key === 'Enter' && visible.length) {
                e.preventDefault()
                useConnectionStore.getState().setActiveConnection(visible[0].id)
                focusRow(visible[0].id)
              }
            }}
            className="w-full bg-app-input border border-app-border rounded-md pl-7 pr-7 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
          />
          {connectionSearch && (
            <button
              aria-label={t('sidebar.clearConnectionSearch')}
              onClick={() => {
                setConnectionSearch('')
                searchInput.current?.focus()
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <span id="connection-search-hint" className="sr-only">
          {t('sidebar.searchHint')}
        </span>
      </div>
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-1"
        data-testid="connection-list-scroll"
      >
        {!connections.length ? (
          <div className="p-4 text-center">
            <p className="text-text-muted text-xs">{t('sidebar.noConnections')}</p>
            <button
              onClick={() => openConnectionDialog()}
              className="mt-2 text-xs text-accent-blue hover:underline"
            >
              {t('conn.newConn')}
            </button>
          </div>
        ) : !filtered.length ? (
          <div className="px-4 py-5 text-center">
            <p className="text-xs text-text-secondary">{t('sidebar.noConnectionMatches')}</p>
            <p className="mt-1 text-2xs text-text-muted">{t('sidebar.searchHint')}</p>
            <button
              onClick={() => {
                setConnectionSearch('')
                searchInput.current?.focus()
              }}
              className="mt-2 text-xs text-accent-blue hover:underline"
            >
              {t('sidebar.clearConnectionSearch')}
            </button>
          </div>
        ) : (
          groupNames.map((group) => {
            const expanded = searching || !collapsedGroups.includes(group)
            const groupConnections = grouped.get(group)!
            return (
              <div key={group}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  disabled={searching}
                  onClick={() => toggleGroup(group)}
                  className="connection-group w-full flex items-center gap-1.5 px-3 py-1.5 text-2xs text-text-muted font-semibold hover:bg-app-hover disabled:hover:bg-transparent"
                >
                  {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span className="truncate">{group || t('sidebar.ungrouped')}</span>
                  <span className="ml-auto font-normal tabular-nums">
                    {groupConnections.length}
                  </span>
                </button>
                {expanded &&
                  groupConnections.map((conn) => {
                    const status = statuses[conn.id] ?? 'disconnected'
                    const isActive = activeConnectionId === conn.id
                    const address = connectionAddress(conn)
                    return (
                      <div
                        key={conn.id}
                        onDoubleClick={() => void handleDoubleClick(conn)}
                        onContextMenu={(e) => handleContextMenu(e, conn)}
                        className={clsx(
                          'connection-row relative group',
                          isActive ? 'bg-app-active' : 'hover:bg-app-hover'
                        )}
                      >
                        <button
                          ref={(node) => {
                            if (node) rowRefs.current.set(conn.id, node)
                            else rowRefs.current.delete(conn.id)
                          }}
                          type="button"
                          aria-label={`${conn.name} · ${address}`}
                          aria-pressed={isActive}
                          onClick={() => useConnectionStore.getState().setActiveConnection(conn.id)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing) return
                            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                              e.preventDefault()
                              const index = visible.findIndex((item) => item.id === conn.id)
                              focusRow(
                                visible[
                                  Math.max(
                                    0,
                                    Math.min(
                                      visible.length - 1,
                                      index + (e.key === 'ArrowDown' ? 1 : -1)
                                    )
                                  )
                                ].id
                              )
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              setConnectionSearch('')
                              searchInput.current?.focus()
                            }
                          }}
                          className="connection-select w-full text-left flex items-start gap-2 px-3 py-2 pr-8 min-w-0"
                          title={`${conn.name} · ${address}\n${conn.type === 'redis' ? t('redis.connectionHint') : t('sidebar.connectionHint')}`}
                        >
                          <span
                            className={clsx(
                              'text-2xs font-bold font-mono w-4 text-center shrink-0 mt-0.5',
                              DB_COLORS[conn.type] ?? 'text-text-muted'
                            )}
                          >
                            {DB_ICONS[conn.type] ?? '?'}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs truncate text-text-primary">
                              {conn.name}
                            </span>
                            <span className="block text-2xs truncate text-text-muted mt-0.5 font-mono">
                              {address}
                            </span>
                            {!!conn.tags?.length && (
                              <span className="flex gap-1 mt-1 overflow-hidden">
                                {conn.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-2xs bg-accent-blue/20 text-accent-blue px-1 rounded truncate shrink-0 max-w-[90px]"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        </button>
                        <span className="absolute right-3 top-3 pointer-events-none">
                          <StatusDot status={status} />
                        </span>
                        <div
                          className="connection-actions absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded border border-app-border bg-app-sidebar p-0.5 shadow-sm opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          {conn.type === 'redis' && status === 'connected' && (
                            <>
                              <button
                                onClick={() => openRedisWorkspace(conn, 'console')}
                                title={t('redis.openConsole')}
                                className="p-1 text-text-muted hover:text-text-primary"
                              >
                                Console
                              </button>
                              <button
                                onClick={() => openRedisWorkspace(conn, 'browser')}
                                title={t('redis.openBrowser')}
                                className="p-1 text-text-muted hover:text-text-primary"
                              >
                                Keys
                              </button>
                            </>
                          )}
                          <button
                            onClick={(e) => void handleConnect(conn.id, e)}
                            title={
                              status === 'connected'
                                ? t('conn.disconnectBtn')
                                : t('conn.connectBtn')
                            }
                            className="p-1 rounded text-text-muted hover:text-text-primary"
                          >
                            <Plug size={12} />
                          </button>
                          <button
                            onClick={() => openConnectionDialog(conn.id)}
                            title={t('conn.editConnMenu')}
                            className="p-1 rounded text-text-muted hover:text-text-primary"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={(e) => void handleDuplicate(conn.id, e)}
                            title={t('conn.copyConn')}
                            className="p-1 rounded text-text-muted hover:text-text-primary"
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            onClick={() => void handleDelete(conn.id)}
                            title={t('conn.deleteConn')}
                            className="p-1 rounded text-text-muted hover:text-accent-red"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>
      {showImport && (
        <ConnectionImportDialog onClose={() => setShowImport(false)} onImported={loadConnections} />
      )}
      {ctxMenu && (
        <ConnContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onConnect={() => {
            const e = { stopPropagation: () => {} } as React.MouseEvent
            void handleConnect(ctxMenu.conn.id, e)
          }}
          onEdit={() => openConnectionDialog(ctxMenu.conn.id)}
          onDuplicate={() => void handleDuplicate(ctxMenu.conn.id)}
          onDelete={() => void handleDelete(ctxMenu.conn.id)}
          onOpenRedisConsole={() => openRedisWorkspace(ctxMenu.conn, 'console')}
          onOpenRedisBrowser={() => openRedisWorkspace(ctxMenu.conn, 'browser')}
        />
      )}
    </section>
  )
}
