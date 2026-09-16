import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useState, useEffect } from 'react'
import { ResultGrid } from './ResultGrid'
import { AlertCircle, CheckCircle2, Clock, Maximize2, Minimize2 } from 'lucide-react'
import type { QueryResult } from '@shared/types/query'
import { clsx } from 'clsx'
import { useQueryStore } from '@renderer/stores/queryStore'

interface ResultsPanelProps {
  result: QueryResult | null
  isLoading: boolean
  maximized?: boolean
  onToggleMaximize?: () => void
}
export function ResultsPanel({
  result: fallbackResult,
  isLoading,
  maximized,
  onToggleMaximize
}: ResultsPanelProps): JSX.Element {
  const tab = useQueryStore((state) => state.tabs.find((t) => t.id === state.activeTabId))
  const connectionType = useConnectionStore(
    (state) => state.connections.find((c) => c.id === tab?.connectionId)?.type
  )
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
        {onToggleMaximize && (
          <button
            className="grid-maximize"
            onClick={onToggleMaximize}
            title={maximized ? '恢复编辑器布局' : '最大化结果'}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {maximized ? '恢复布局' : '最大化'}
          </button>
        )}
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
      <div className="flex-1 min-h-0 overflow-hidden selectable relative">
        <div
          className="absolute inset-0"
          style={{
            visibility: !messages && result?.columns.length && !result.error ? 'visible' : 'hidden'
          }}
          key={`${tab?.id}-${tab?.executionId}`}
        >
          {results.map(
            (entry, index) =>
              entry.columns.length > 0 &&
              !entry.error && (
                <div
                  key={index}
                  className="absolute inset-0"
                  style={{
                    visibility:
                      !messages && index === selected && !entry.error ? 'visible' : 'hidden'
                  }}
                >
                  <ResultGrid
                    dialect={connectionType === 'redis' ? undefined : connectionType}
                    result={entry}
                    active={!messages && index === selected}
                  />
                </div>
              )
          )}
        </div>
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
          ) : result.columns.length ? null : (
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
