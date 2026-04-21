import { useEffect, useMemo, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { clsx } from 'clsx'
import { ResultsPanel } from '@renderer/components/results/ResultsPanel'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore, type QueryTab } from '@renderer/stores/queryStore'

interface RedisConsoleViewProps {
  tab: QueryTab
}

export function RedisConsoleView({ tab }: RedisConsoleViewProps): JSX.Element {
  const { connections, statuses } = useConnectionStore()
  const { updateTabSQL, updateTabDatabase, executeQuery } = useQueryStore()
  const connection = useMemo(
    () => connections.find((item) => item.id === tab.connectionId) ?? null,
    [connections, tab.connectionId]
  )
  const isConnected = connection ? (statuses[connection.id] ?? 'disconnected') === 'connected' : false
  const [availableDbs, setAvailableDbs] = useState<string[]>([])
  const [loadingDbs, setLoadingDbs] = useState(false)

  useEffect(() => {
    const loadDatabases = async (): Promise<void> => {
      if (!tab.connectionId || !window.db) return
      setLoadingDbs(true)
      try {
        const dbs = await window.db.getDatabases(tab.connectionId)
        setAvailableDbs(dbs)
        if (!tab.selectedDatabase && dbs[0]) {
          updateTabDatabase(tab.id, dbs[0])
        }
      } finally {
        setLoadingDbs(false)
      }
    }

    void loadDatabases()
  }, [tab.connectionId, tab.id, tab.selectedDatabase, updateTabDatabase])

  const handleRun = async (): Promise<void> => {
    if (!tab.sql.trim()) return
    await executeQuery(tab.id)
  }

  if (!connection) {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">未找到 Redis 连接。</div>
  }

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <div className="flex items-center gap-2 border-b border-app-border bg-app-sidebar px-3 py-2">
        <div className="text-xs text-text-secondary">
          <span className={clsx('mr-2 inline-block h-2 w-2 rounded-full', isConnected ? 'bg-accent-green' : 'bg-text-muted')} />
          {connection.name}
        </div>
        <select
          value={tab.selectedDatabase ?? connection.database ?? '0'}
          onChange={(event) => updateTabDatabase(tab.id, event.target.value)}
          className="rounded border border-app-border bg-app-input px-2 py-1 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
          disabled={loadingDbs || availableDbs.length === 0}
        >
          {(availableDbs.length > 0 ? availableDbs : [connection.database ?? '0']).map((db) => (
            <option key={db} value={db}>
              DB {db}
            </option>
          ))}
        </select>
        <button
          onClick={() => void handleRun()}
          disabled={!isConnected || !tab.sql.trim() || tab.isLoading}
          className="inline-flex items-center gap-1 rounded bg-accent-blue px-2 py-1 text-xs text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tab.isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          执行命令
        </button>
      </div>

      <div className="border-b border-app-border bg-app-panel p-3">
        <textarea
          value={tab.sql}
          onChange={(event) => updateTabSQL(tab.id, event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void handleRun()
            }
          }}
          placeholder={'例如：PING\nGET my:key\nHGETALL user:1'}
          className="min-h-[120px] w-full resize-none rounded border border-app-border bg-app-input px-3 py-2 font-mono text-xs text-text-primary focus:border-accent-blue focus:outline-none"
        />
        <div className="mt-2 text-2xs text-text-muted">支持 Ctrl/Cmd + Enter 执行当前 Redis 命令。</div>
      </div>

      <div className="min-h-0 flex-1">
        <ResultsPanel result={tab.result} isLoading={tab.isLoading} />
      </div>
    </div>
  )
}
