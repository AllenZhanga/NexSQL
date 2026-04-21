import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { QueryTab } from '@renderer/stores/queryStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'

interface TabContextMenuState {
  x: number
  y: number
  tabId: string
}

export function TabBar(): JSX.Element {
  const { tabs, activeTabId, newTab, closeTab, setActiveTab, openRedisConsoleTab } = useQueryStore()
  const { activeConnectionId, connections } = useConnectionStore()
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)

  const handleNewTab = (): void => {
    const activeConnection = activeConnectionId
      ? connections.find((item) => item.id === activeConnectionId)
      : null

    if (activeConnection?.type === 'redis') {
      openRedisConsoleTab(activeConnection.id, activeConnection.database ?? '0')
      return
    }

    newTab(activeConnectionId ?? undefined)
  }

  const handleCloseTab = (tabId: string): void => {
    const tab = tabs.find((item) => item.id === tabId)
    if (tab?.hasPendingChanges) {
      const confirmed = confirm('当前数据表页有未提交的修改，确认直接关闭吗？')
      if (!confirmed) return
    }
    closeTab(tabId)
  }

  const confirmCloseTabs = (targetTabs: QueryTab[]): boolean => {
    if (targetTabs.length === 0) return false

    const pendingCount = targetTabs.filter((tab) => tab.hasPendingChanges).length
    if (pendingCount === 0) return true

    const message = pendingCount === 1
      ? '即将关闭的标签中有 1 个数据表页存在未提交修改，确认继续关闭吗？'
      : `即将关闭的标签中有 ${pendingCount} 个数据表页存在未提交修改，确认继续关闭吗？`

    return confirm(message)
  }

  const closeTabs = (targetTabs: QueryTab[]): void => {
    if (!confirmCloseTabs(targetTabs)) return
    targetTabs.forEach((tab) => closeTab(tab.id))
  }

  const handleCloseCurrent = (tabId: string): void => {
    handleCloseTab(tabId)
    setContextMenu(null)
  }

  const handleCloseOthers = (tabId: string): void => {
    closeTabs(tabs.filter((tab) => tab.id !== tabId))
    setContextMenu(null)
  }

  const handleCloseRight = (tabId: string): void => {
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId)
    if (currentIndex === -1) return
    closeTabs(tabs.slice(currentIndex + 1))
    setContextMenu(null)
  }

  const handleCloseAll = (): void => {
    closeTabs(tabs)
    setContextMenu(null)
  }

  useEffect(() => {
    if (!contextMenu) return undefined

    const handleWindowClick = (): void => setContextMenu(null)
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }

    window.addEventListener('click', handleWindowClick)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('click', handleWindowClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  const menuTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) ?? null : null
  const menuTabIndex = menuTab ? tabs.findIndex((tab) => tab.id === menuTab.id) : -1
  const hasRightTabs = menuTabIndex >= 0 && menuTabIndex < tabs.length - 1
  const hasOtherTabs = tabs.length > 1

  return (
    <div className="flex items-center bg-app-header border-b border-app-border shrink-0 overflow-x-auto">
      <div className="flex items-center min-w-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault()
              setActiveTab(tab.id)
              setContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id })
            }}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-app-border shrink-0 group transition-colors max-w-[160px]',
              tab.id === activeTabId
                ? 'bg-app-bg text-text-primary border-t-2 border-t-accent-blue'
                : 'bg-app-header text-text-secondary hover:bg-app-hover hover:text-text-primary'
            )}
          >
            {tab.isLoading && (
              <span className="w-2 h-2 rounded-full bg-accent-blue animate-pulse shrink-0" />
            )}
            {tab.hasPendingChanges && !tab.isLoading && (
              <span className="w-2 h-2 rounded-full bg-accent-yellow shrink-0" title="有未提交的修改" />
            )}
            <span className="truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleCloseTab(tab.id)
              }}
              className="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-app-hover transition-all"
              title="Close tab"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleNewTab}
        className="flex items-center justify-center w-7 h-7 ml-1 shrink-0 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
        title="新建查询"
      >
        <Plus size={14} />
      </button>

      {contextMenu && menuTab && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(event) => {
            event.preventDefault()
            setContextMenu(null)
          }} />
          <div
            className="fixed z-50 min-w-[180px] rounded border border-app-border bg-app-sidebar py-1 text-xs shadow-2xl"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <div className="border-b border-app-border px-3 py-1.5 text-text-muted">
              {menuTab.title}
            </div>
            <button
              onClick={() => handleCloseCurrent(menuTab.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary transition-colors hover:bg-app-active hover:text-text-primary"
            >
              <X size={12} />
              关闭当前页
            </button>
            <button
              onClick={() => handleCloseOthers(menuTab.id)}
              disabled={!hasOtherTabs}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary transition-colors hover:bg-app-active hover:text-text-primary disabled:opacity-40"
            >
              <X size={12} />
              关闭其他页面
            </button>
            <button
              onClick={() => handleCloseRight(menuTab.id)}
              disabled={!hasRightTabs}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary transition-colors hover:bg-app-active hover:text-text-primary disabled:opacity-40"
            >
              <X size={12} />
              关闭右侧页面
            </button>
            <div className="my-1 border-t border-app-border" />
            <button
              onClick={handleCloseAll}
              disabled={tabs.length === 0}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary transition-colors hover:bg-app-active hover:text-text-primary disabled:opacity-40"
            >
              <X size={12} />
              关闭所有页面
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
