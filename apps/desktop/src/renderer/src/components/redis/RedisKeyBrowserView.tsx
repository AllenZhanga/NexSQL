import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { RedisKeyDetail, RedisKeySummary } from '@shared/types/redis'
import { clsx } from 'clsx'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useT } from '@renderer/stores/i18nStore'
import { useQueryStore, type QueryTab } from '@renderer/stores/queryStore'

interface RedisKeyBrowserViewProps {
  tab: QueryTab
}

export function RedisKeyBrowserView({ tab }: RedisKeyBrowserViewProps): JSX.Element {
  const { connections } = useConnectionStore()
  const t = useT()
  const { patchTab, updateTabDatabase } = useQueryStore()
  const connection = useMemo(
    () => connections.find((item) => item.id === tab.connectionId) ?? null,
    [connections, tab.connectionId]
  )
  const [availableDbs, setAvailableDbs] = useState<string[]>([])
  const [keys, setKeys] = useState<RedisKeySummary[]>([])
  const [detail, setDetail] = useState<RedisKeyDetail | null>(null)
  const [loadingKeys, setLoadingKeys] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const selectedDatabase = tab.selectedDatabase ?? connection?.database ?? '0'
  const pattern = tab.redisSearchPattern ?? '*'

  const loadDatabases = useCallback(async (): Promise<void> => {
    if (!tab.connectionId || !window.db) return
    const dbs = await window.db.getDatabases(tab.connectionId)
    setAvailableDbs(dbs)
    if (!tab.selectedDatabase && dbs[0]) {
      updateTabDatabase(tab.id, dbs[0])
    }
  }, [tab.connectionId, tab.id, tab.selectedDatabase, updateTabDatabase])

  const loadKeys = useCallback(async (): Promise<void> => {
    if (!tab.connectionId || !window.db) return
    setLoadingKeys(true)
    setError(null)
    try {
      const nextKeys = await window.db.getRedisKeys(tab.connectionId, pattern || '*', selectedDatabase)
      setKeys(nextKeys)
      if (tab.redisSelectedKey) {
        const stillExists = nextKeys.some((item) => item.key === tab.redisSelectedKey)
        if (!stillExists) {
          patchTab(tab.id, { redisSelectedKey: null })
          setDetail(null)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setKeys([])
    } finally {
      setLoadingKeys(false)
    }
  }, [patchTab, pattern, selectedDatabase, tab.connectionId, tab.id, tab.redisSelectedKey])

  const loadDetail = useCallback(async (key: string): Promise<void> => {
    if (!tab.connectionId || !window.db) return
    setLoadingDetail(true)
    setDetailError(null)
    try {
      const nextDetail = await window.db.getRedisKeyDetail(tab.connectionId, key, selectedDatabase)
      setDetail(nextDetail)
      patchTab(tab.id, { redisSelectedKey: key })
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err))
      setDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [patchTab, selectedDatabase, tab.connectionId, tab.id])

  useEffect(() => {
    void loadDatabases()
  }, [loadDatabases])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  useEffect(() => {
    if (!tab.redisSelectedKey) {
      setDetail(null)
      return
    }
    void loadDetail(tab.redisSelectedKey)
  }, [loadDetail, tab.redisSelectedKey])

  const handleDelete = async (): Promise<void> => {
    if (!tab.connectionId || !tab.redisSelectedKey || !window.db) return
    const confirmed = confirm(t('redis.keyBrowser.deleteConfirm').replace('{{key}}', tab.redisSelectedKey))
    if (!confirmed) return
    await window.db.deleteRedisKey(tab.connectionId, tab.redisSelectedKey, selectedDatabase)
    patchTab(tab.id, { redisSelectedKey: null })
    setDetail(null)
    await loadKeys()
  }

  if (!connection) {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">{t('redis.keyBrowser.connectionMissing')}</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="flex flex-wrap items-center gap-2 border-b border-app-border bg-app-sidebar px-3 py-2">
        <select
          value={selectedDatabase}
          onChange={(event) => updateTabDatabase(tab.id, event.target.value)}
          className="rounded border border-app-border bg-app-input px-2 py-1 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
        >
          {(availableDbs.length > 0 ? availableDbs : [selectedDatabase]).map((db) => (
            <option key={db} value={db}>
              DB {db}
            </option>
          ))}
        </select>
        <div className="relative min-w-[220px] flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={pattern}
            onChange={(event) => patchTab(tab.id, { redisSearchPattern: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void loadKeys()
              }
            }}
            placeholder={t('redis.keyBrowser.patternPlaceholder')}
            className="w-full rounded border border-app-border bg-app-input py-1 pl-7 pr-2 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
          />
        </div>
        <button
          onClick={() => void loadKeys()}
          className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary"
        >
          <RefreshCw size={12} className={clsx(loadingKeys && 'animate-spin')} />
          {t('redis.keyBrowser.refresh')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 w-[320px] flex-col border-r border-app-border bg-app-panel">
          <div className="border-b border-app-border px-3 py-2 text-xs text-text-muted">
            {loadingKeys ? t('redis.keyBrowser.loadingKeys') : t('redis.keyBrowser.totalKeys').replace('{{count}}', String(keys.length))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {error ? (
              <div className="p-3 text-xs text-accent-red">{error}</div>
            ) : loadingKeys ? (
              <div className="flex items-center gap-2 p-3 text-xs text-text-muted"><Loader2 size={12} className="animate-spin" /> {t('redis.keyBrowser.loading')}</div>
            ) : keys.length === 0 ? (
              <div className="p-3 text-xs text-text-muted">{t('redis.keyBrowser.empty')}</div>
            ) : (
              keys.map((item) => (
                <button
                  key={item.key}
                  onClick={() => void loadDetail(item.key)}
                  className={clsx(
                    'w-full border-b border-app-border px-3 py-2 text-left transition-colors hover:bg-app-hover',
                    tab.redisSelectedKey === item.key ? 'bg-app-active/60' : 'bg-transparent'
                  )}
                >
                  <div className="truncate text-xs text-text-primary">{item.key}</div>
                  <div className="mt-1 flex items-center gap-2 text-2xs text-text-muted">
                    <span>{item.type}</span>
                    <span>TTL: {item.ttl}</span>
                    {item.size !== undefined && <span>{item.size} B</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {detailError ? (
            <div className="p-4 text-sm text-accent-red">{detailError}</div>
          ) : loadingDetail ? (
            <div className="flex items-center gap-2 p-4 text-sm text-text-muted"><Loader2 size={14} className="animate-spin" /> {t('redis.keyBrowser.loadingDetail')}</div>
          ) : detail ? (
            <div className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">{detail.key}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-text-muted">
                    <span>{t('redis.keyBrowser.type')}：{detail.type}</span>
                    <span>{t('redis.keyBrowser.ttl')}：{detail.ttl}</span>
                    {detail.size !== undefined && <span>{t('redis.keyBrowser.size')}：{detail.size} B</span>}
                  </div>
                </div>
                <button
                  onClick={() => void handleDelete()}
                  className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-accent-red transition-colors hover:bg-red-900/20"
                >
                  <Trash2 size={12} />
                  {t('redis.keyBrowser.delete')}
                </button>
              </div>
              <pre className="overflow-auto rounded border border-app-border bg-app-panel p-3 text-xs text-text-secondary whitespace-pre-wrap break-all">{formatRedisValue(detail.value)}</pre>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-sm text-text-muted">{t('redis.keyBrowser.selectKey')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatRedisValue(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
