import { Database, Wrench, TerminalSquare } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle
} from 'react-resizable-panels'
import { Sidebar } from '../sidebar/Sidebar'
import { TabBar } from '../editor/TabBar'
import { QueryEditor } from '../editor/QueryEditor'
import { ResultsPanel } from '../results/ResultsPanel'
import { AIInputBar } from '../ai/AIInputBar'
import { TableDataView } from '../table/TableDataView'
import { DatabaseOverview } from '../database/DatabaseOverview'
import { RedisConsoleView } from '../redis/RedisConsoleView'
import { RedisKeyBrowserView } from '../redis/RedisKeyBrowserView'
import { ConnectionDialog } from '../connection/ConnectionDialog'
import { SettingsDialog } from '../settings/SettingsDialog'
import { AppSettingsDialog } from '../settings/AppSettingsDialog'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useUIStore } from '@renderer/stores/uiStore'
import { usePrefsStore, applyFontSize, applyTheme } from '@renderer/stores/prefsStore'
import { DevWorkbench } from '../ai/DevWorkbench'
import { clsx } from 'clsx'

export function AppLayout(): JSX.Element {
  const editorPanel = useRef<ImperativePanelHandle>(null)
  const [resultsMaximized, setResultsMaximized] = useState(false)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const { loadConnections } = useConnectionStore()
  const { tabs, activeTabId, newTab } = useQueryStore()
  const { showConnectionDialog, showSettings, showAppSettings, windowTab, setWindowTab } =
    useUIStore()
  const { fontSize, theme } = usePrefsStore()

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  // Apply persisted font size on first render
  useEffect(() => {
    applyFontSize(fontSize)
  }, [fontSize])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Ensure at least one tab
  useEffect(() => {
    if (tabs.length === 0) {
      newTab()
    }
  }, [tabs.length, newTab])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!tabs.some((tab) => tab.hasPendingChanges || tab.isLoading)) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [tabs])

  return (
    <div className="flex flex-col h-full bg-app-bg text-text-primary">
      {/* macOS traffic-light spacer – only rendered on darwin.
          hiddenInset keeps the red/yellow/green buttons but merges the titlebar
          into the window content, so we need to reserve ~28 px at the top and
          make it draggable so users can still move the window. */}
      {window.platform === 'darwin' && (
        <div
          className="shrink-0 bg-app-sidebar"
          style={{ height: 28, WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      {/* Main layout */}
      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Sidebar */}
        <Panel defaultSize={22} minSize={Math.min(35, (208 / windowWidth) * 100)} maxSize={35}>
          <Sidebar />
        </Panel>

        <PanelResizeHandle className="w-px bg-app-border hover:bg-accent-blue transition-colors" />

        {/* Main content */}
        <Panel defaultSize={78} minSize={50}>
          <div className="flex flex-col h-full">
            <div className="workspace-navigation">
              <div className="workspace-brand">
                <TerminalSquare size={18} />
                <span>NexSQL</span>
              </div>
              <div className="workspace-switcher">
                <button
                  onClick={() => setWindowTab('workspace')}
                  className={clsx(
                    'rounded px-2 py-1 text-xs transition-colors',
                    windowTab === 'workspace'
                      ? 'bg-app-active text-white'
                      : 'text-text-secondary hover:bg-app-hover hover:text-text-primary'
                  )}
                >
                  <Database size={14} /> SQL 工作区
                </button>
                <button
                  onClick={() => setWindowTab('dev-workbench')}
                  className={clsx(
                    'rounded px-2 py-1 text-xs transition-colors',
                    windowTab === 'dev-workbench'
                      ? 'bg-app-active text-white'
                      : 'text-text-secondary hover:bg-app-hover hover:text-text-primary'
                  )}
                >
                  <Wrench size={14} /> 开发工作台
                </button>
              </div>
              <span className="workspace-caption">本地工作空间</span>
            </div>

            <div
              className={clsx(
                'flex-1 overflow-hidden p-5',
                windowTab !== 'dev-workbench' && 'hidden'
              )}
            >
              <DevWorkbench />
            </div>
            <div
              className={clsx(
                'flex flex-col flex-1 min-h-0',
                windowTab !== 'workspace' && 'hidden'
              )}
            >
              {/* Tab bar */}
              <TabBar />

              {activeTab?.type === 'table' ? (
                <div className="flex-1 overflow-hidden">
                  <TableDataView tab={activeTab} />
                </div>
              ) : activeTab?.type === 'database' ? (
                <div className="flex-1 overflow-hidden">
                  <DatabaseOverview tab={activeTab} />
                </div>
              ) : activeTab?.type === 'redis-console' ? (
                <div className="flex-1 overflow-hidden">
                  <RedisConsoleView tab={activeTab} />
                </div>
              ) : activeTab?.type === 'redis-browser' ? (
                <div className="flex-1 overflow-hidden">
                  <RedisKeyBrowserView tab={activeTab} />
                </div>
              ) : (
                <PanelGroup direction="vertical" className="flex-1 overflow-hidden">
                  <Panel
                    ref={editorPanel}
                    defaultSize={55}
                    minSize={20}
                    collapsible
                    collapsedSize={0}
                    onCollapse={() => setResultsMaximized(true)}
                    onExpand={() => setResultsMaximized(false)}
                  >
                    <div className="flex flex-col h-full">
                      {/* AI input bar */}
                      <AIInputBar />
                      {/* SQL editor */}
                      <div className="flex-1 overflow-hidden">
                        <QueryEditor />
                      </div>
                    </div>
                  </Panel>

                  <PanelResizeHandle className="h-px bg-app-border hover:bg-accent-blue transition-colors" />

                  <Panel defaultSize={45} minSize={15}>
                    <ResultsPanel
                      maximized={resultsMaximized}
                      onToggleMaximize={() => {
                        if (editorPanel.current?.isCollapsed()) editorPanel.current.expand()
                        else editorPanel.current?.collapse()
                      }}
                      result={activeTab?.result ?? null}
                      isLoading={activeTab?.isLoading ?? false}
                    />
                  </Panel>
                </PanelGroup>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>

      {/* Dialogs */}
      {showConnectionDialog && <ConnectionDialog />}
      {showSettings && <SettingsDialog />}
      {showAppSettings && <AppSettingsDialog />}
    </div>
  )
}
