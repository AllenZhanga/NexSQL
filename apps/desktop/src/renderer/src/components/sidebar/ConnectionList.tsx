import { createPortal } from 'react-dom'
import { useState, useRef } from 'react'
import { Circle, Plug, Trash2, Edit2, Copy, Download, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useUIStore } from '@renderer/stores/uiStore'
import { useT } from '@renderer/stores/i18nStore'
import type { ConnectionConfig, ConnectionStatus } from '@shared/types/connection'

const DB_ICONS: Record<string, string> = { mysql: 'M', postgresql: 'P', mssql: 'S', sqlite: 'L', redis: 'R' }
const DB_COLORS: Record<string, string> = {
  mysql: 'text-orange-400',
  postgresql: 'text-blue-400',
  mssql: 'text-red-400',
  sqlite: 'text-green-400',
  redis: 'text-rose-400'
}

function StatusDot({ status }: { status: ConnectionStatus }): JSX.Element {
  return (
    <Circle size={7} className={clsx('shrink-0 fill-current', {
      'text-accent-green': status === 'connected',
      'text-accent-red': status === 'error',
      'text-accent-yellow animate-pulse': status === 'connecting',
      'text-text-muted': status === 'disconnected'
    })} />
  )
}

interface CtxMenu { x: number; y: number; conn: ConnectionConfig }

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
  const items = menu.conn.type === 'redis'
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
      <div className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[180px] text-xs"
        style={{ top: menu.y, left: menu.x }}>
        <div className="px-3 py-1 text-text-muted text-2xs border-b border-app-border mb-1 truncate font-medium">{menu.conn.name}</div>
        {items.map((item, i) =>
          'divider' in item ? (
            <div key={i} className="border-t border-app-border my-1" />
          ) : (
            <button key={i} onClick={() => { item.action(); onClose() }}
              className={clsx('w-full text-left px-3 py-1.5 hover:bg-app-active transition-colors',
                'danger' in item && item.danger ? 'text-accent-red hover:text-accent-red' : 'text-text-secondary hover:text-text-primary'
              )}>
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
  const { connections, statuses, activeConnectionId, connect, disconnect, deleteConnection, duplicateConnection, loadConnections } = useConnectionStore()
  const { loadSchema, updateTabConnection, openRedisConsoleTab, openRedisBrowserTab } = useQueryStore()
  const { openConnectionDialog } = useUIStore()
  const { activeTabId } = useQueryStore()
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

    await loadSchema(conn.id)
    if (activeTabId) updateTabConnection(activeTabId, conn.id)
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
    a.href = url; a.download = 'nexsql-connections.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportConnections = (): void => { fileInputRef.current?.click() }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file || !window.db) return
    const text = await file.text()
    try {
      const count = await window.db.importConnections(text)
      await loadConnections()
      alert(`已成功导入 ${count} 个连接`)
    } catch (err) {
      alert('导入失败: ' + String(err))
    }
    e.target.value = ''
  }

  const grouped = connections.reduce<Record<string, ConnectionConfig[]>>((acc, conn) => {
    const grp = conn.group || ''
    ;(acc[grp] = acc[grp] || []).push(conn)
    return acc
  }, {})
  const groupNames = Object.keys(grouped).sort((a, b) => a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))

  return (
    <div className="py-1">
      <div className="px-3 py-1 flex items-center justify-between">
        <span className="text-2xs text-text-muted uppercase tracking-wider font-semibold">{t('sidebar.connections')}</span>
        <div className="flex gap-1">
          <button onClick={handleImportConnections} title={t('export.importConnections')} className="p-0.5 text-text-muted hover:text-text-primary rounded hover:bg-app-hover transition-colors">
            <Upload size={10} />
          </button>
          <button onClick={handleExportConnections} title={t('export.exportConnections')} className="p-0.5 text-text-muted hover:text-text-primary rounded hover:bg-app-hover transition-colors">
            <Download size={10} />
          </button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileImport} />

      {connections.length === 0 ? (
        <div className="p-4 text-center">
          <p className="text-text-muted text-xs">暂无连接</p>
          <button onClick={() => openConnectionDialog()} className="mt-2 text-xs text-accent-blue hover:underline">添加连接</button>
        </div>
      ) : (
        groupNames.map((grpName) => (
          <div key={grpName}>
            {grpName && (
              <div className="px-3 py-0.5 text-2xs text-text-muted uppercase tracking-wide font-semibold mt-1 border-b border-app-border/40">
                {grpName}
              </div>
            )}
            {grouped[grpName].map((conn) => {
              const status = statuses[conn.id] ?? 'disconnected'
              const isActive = activeConnectionId === conn.id
              return (
                <div
                  key={conn.id}
                  onClick={() => useConnectionStore.getState().setActiveConnection(conn.id)}
                  onDoubleClick={() => void handleDoubleClick(conn)}
                  onContextMenu={(e) => handleContextMenu(e, conn)}
                  className={clsx('flex items-center gap-2 px-3 py-1.5 cursor-pointer group transition-colors',
                    isActive ? 'bg-app-active' : 'hover:bg-app-hover'
                  )}
                  title={conn.type === 'redis' ? t('redis.connectionHint') : '双击连接并展开 Schema / 右键更多选项'}
                >
                  <span className={clsx('text-2xs font-bold font-mono w-4 text-center shrink-0', DB_COLORS[conn.type] ?? 'text-text-muted')}>
                    {DB_ICONS[conn.type] ?? '?'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate text-text-primary">{conn.name}</div>
                    {conn.tags && conn.tags.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5 flex-wrap">
                        {conn.tags.map((tag) => (
                          <span key={tag} className="text-2xs bg-accent-blue/20 text-accent-blue px-1 rounded">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <StatusDot status={status} />
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    {conn.type === 'redis' && status === 'connected' && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); openRedisWorkspace(conn, 'console') }} title={t('redis.openConsole')} className="p-0.5 rounded text-text-muted hover:text-text-primary">
                          <span className="px-1 text-[10px] font-medium">Console</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); openRedisWorkspace(conn, 'browser') }} title={t('redis.openBrowser')} className="p-0.5 rounded text-text-muted hover:text-text-primary">
                          <span className="px-1 text-[10px] font-medium">Keys</span>
                        </button>
                      </>
                    )}
                    <button onClick={(e) => void handleConnect(conn.id, e)} title={status === 'connected' ? t('conn.disconnectBtn') : t('conn.connectBtn')} className="p-0.5 rounded text-text-muted hover:text-text-primary">
                      <Plug size={11} />
                    </button>
                    <button onClick={() => openConnectionDialog(conn.id)} title={t('conn.editConnMenu')} className="p-0.5 rounded text-text-muted hover:text-text-primary">
                      <Edit2 size={11} />
                    </button>
                    <button onClick={(e) => void handleDuplicate(conn.id, e)} title={t('conn.copyConn')} className="p-0.5 rounded text-text-muted hover:text-text-primary">
                      <Copy size={11} />
                    </button>
                    <button onClick={() => void handleDelete(conn.id)} title={t('conn.deleteConn')} className="p-0.5 rounded text-text-muted hover:text-accent-red">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ))
      )}
      {ctxMenu && (
        <ConnContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onConnect={() => { const e = { stopPropagation: () => {} } as React.MouseEvent; void handleConnect(ctxMenu.conn.id, e) }}
          onEdit={() => openConnectionDialog(ctxMenu.conn.id)}
          onDuplicate={() => void handleDuplicate(ctxMenu.conn.id)}
          onDelete={() => void handleDelete(ctxMenu.conn.id)}
          onOpenRedisConsole={() => openRedisWorkspace(ctxMenu.conn, 'console')}
          onOpenRedisBrowser={() => openRedisWorkspace(ctxMenu.conn, 'browser')}
        />
      )}
    </div>
  )
}
