import { Database, History, Plus, Settings } from 'lucide-react'
import { ConnectionList } from './ConnectionList'
import { SchemaTree } from './SchemaTree'
import { useUIStore } from '@renderer/stores/uiStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useI18nStore } from '@renderer/stores/i18nStore'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle
} from 'react-resizable-panels'
import type { QueryHistoryEntry } from '@shared/types/query'

export function Sidebar(): JSX.Element {
  const { sidebarTab, setSidebarTab, openConnectionDialog, setShowAppSettings } = useUIStore()
  const { history, loadHistory } = useQueryStore()
  const { t } = useI18nStore()

  const handleHistoryClick = (): void => {
    setSidebarTab('history')
    loadHistory()
  }

  return (
    <div className="flex flex-col h-full bg-app-sidebar border-r border-app-border">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => setSidebarTab('connections')}
            className={clsx(
              'p-1.5 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0',
              sidebarTab === 'connections'
                ? 'bg-app-active text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-app-hover'
            )}
            title={t('sidebar.connections')}
          >
            <Database size={14} />
            <span>连接</span>
          </button>
          <button
            onClick={handleHistoryClick}
            className={clsx(
              'p-1.5 rounded text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0',
              sidebarTab === 'history'
                ? 'bg-app-active text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-app-hover'
            )}
            title={t('sidebar.history')}
          >
            <History size={14} />
            <span>历史</span>
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => openConnectionDialog()}
            className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors"
            title={t('conn.newConn')}
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setShowAppSettings(true)}
            className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors"
            title={t('settings.title')}
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {sidebarTab === 'connections' ? (
          <ConnectionPanels />
        ) : (
          <div className="h-full overflow-y-auto overflow-x-hidden">
            <HistoryList history={history} />
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectionPanels(): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const connectionsPanel = useRef<ImperativePanelHandle>(null)
  const [height, setHeight] = useState(540)
  const { t } = useI18nStore()
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setHeight(Math.max(1, entry.contentRect.height))
    )
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={root} className="h-full min-h-0" data-testid="sidebar-panels">
      <PanelGroup
        direction="vertical"
        autoSaveId="nexsql-sidebar-layout"
        id="sidebar-connections-layout"
      >
        <Panel
          ref={connectionsPanel}
          id="connection-list-panel"
          order={1}
          defaultSize={35}
          minSize={Math.min(45, (140 / height) * 100)}
        >
          <ConnectionList />
        </Panel>
        <PanelResizeHandle
          className="sidebar-resize-handle"
          aria-label={t('sidebar.resize')}
          title={t('sidebar.resizeHint')}
          onDoubleClick={() => connectionsPanel.current?.resize(35)}
        />
        <Panel
          id="database-tree-panel"
          order={2}
          defaultSize={65}
          minSize={Math.min(45, (180 / height) * 100)}
        >
          <SchemaTree />
        </Panel>
      </PanelGroup>
    </div>
  )
}

function HistoryList({ history }: { history: QueryHistoryEntry[] }): JSX.Element {
  const { newTab, updateTabSQL, updateTabDatabase } = useQueryStore()

  const handleClick = (entry: QueryHistoryEntry): void => {
    const tabId = newTab(entry.connectionId)
    updateTabSQL(tabId, entry.sql)
    updateTabDatabase(tabId, entry.database ?? null)
  }

  if (history.length === 0) {
    return <div className="p-4 text-text-muted text-xs text-center">暂无查询记录</div>
  }

  return (
    <div className="py-1">
      <div className="px-3 py-1 text-2xs text-text-muted uppercase tracking-wider font-semibold">
        历史记录
      </div>
      {history.map((entry) => (
        <button
          key={entry.id}
          onClick={() => handleClick(entry)}
          className="w-full text-left px-3 py-1.5 hover:bg-app-hover transition-colors group"
        >
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full shrink-0',
                entry.success ? 'bg-accent-green' : 'bg-accent-red'
              )}
            />
            <span className="text-xs text-text-primary truncate font-mono">
              {entry.sql.replace(/\s+/g, ' ').substring(0, 60)}
            </span>
          </div>
          <div className="flex gap-3 mt-0.5 pl-3.5 text-2xs text-text-muted">
            <span>{entry.durationMs}ms</span>
            <span>{entry.rowCount} 行</span>
            <span>{new Date(entry.executedAt).toLocaleTimeString()}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
