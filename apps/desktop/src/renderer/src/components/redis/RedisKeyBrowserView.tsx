import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Save, Search, Trash2 } from 'lucide-react'
import type { RedisKeyDetail, RedisKeySummary } from '@shared/types/redis'
import { clsx } from 'clsx'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useT } from '@renderer/stores/i18nStore'
import { useQueryStore, type QueryTab } from '@renderer/stores/queryStore'

interface RedisKeyBrowserViewProps {
  tab: QueryTab
}

const DEFAULT_REDIS_KEY_PAGE_SIZE = 100

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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [currentCursor, setCurrentCursor] = useState('0')
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [nextCursor, setNextCursor] = useState('0')
  const [hasMore, setHasMore] = useState(false)
  const [valueDraft, setValueDraft] = useState('')
  const [ttlDraft, setTtlDraft] = useState('')
  const [pageSizeInput, setPageSizeInput] = useState(String(tab.redisPageSize ?? DEFAULT_REDIS_KEY_PAGE_SIZE))

  const selectedDatabase = tab.selectedDatabase ?? connection?.database ?? '0'
  const pattern = tab.redisSearchPattern ?? '*'
  const pageSize = tab.redisPageSize ?? DEFAULT_REDIS_KEY_PAGE_SIZE
  const currentPage = cursorHistory.length + 1

  const loadDatabases = useCallback(async (): Promise<void> => {
    if (!tab.connectionId || !window.db) return
    const dbs = await window.db.getDatabases(tab.connectionId)
    setAvailableDbs(dbs)
    if (!tab.selectedDatabase && dbs[0]) {
      updateTabDatabase(tab.id, dbs[0])
    }
  }, [tab.connectionId, tab.id, tab.selectedDatabase, updateTabDatabase])

  const loadKeys = useCallback(async (cursor = '0', history: string[] = []): Promise<void> => {
    if (!tab.connectionId || !window.db) return
    setLoadingKeys(true)
    setError(null)
    try {
      const page = await window.db.getRedisKeys(tab.connectionId, pattern || '*', selectedDatabase, cursor, pageSize)
      const nextKeys = page.items
      setKeys(nextKeys)
      setCurrentCursor(cursor)
      setCursorHistory(history)
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setKeys([])
      setNextCursor('0')
      setHasMore(false)
    } finally {
      setLoadingKeys(false)
    }
  }, [pageSize, pattern, selectedDatabase, tab.connectionId])

  const loadDetail = useCallback(async (key: string): Promise<void> => {
    if (!tab.connectionId || !window.db) return
    setLoadingDetail(true)
    setDetailError(null)
    try {
      const nextDetail = await window.db.getRedisKeyDetail(tab.connectionId, key, selectedDatabase)
      setDetail(nextDetail)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err))
      setDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [selectedDatabase, tab.connectionId])

  useEffect(() => {
    void loadDatabases()
  }, [loadDatabases])

  useEffect(() => {
    void loadKeys('0', [])
  }, [loadKeys])

  useEffect(() => {
    setCurrentCursor('0')
    setCursorHistory([])
    setNextCursor('0')
    setHasMore(false)
  }, [pageSize, selectedDatabase, pattern, tab.connectionId])

  useEffect(() => {
    setPageSizeInput(String(pageSize))
  }, [pageSize])

  useEffect(() => {
    if (!tab.redisSelectedKey) {
      setDetail(null)
      return
    }
    const stillExists = keys.some((item) => item.key === tab.redisSelectedKey)
    if (!stillExists && keys.length > 0) {
      patchTab(tab.id, { redisSelectedKey: null })
      setDetail(null)
    }
  }, [keys, patchTab, tab.id, tab.redisSelectedKey])

  useEffect(() => {
    if (!tab.redisSelectedKey) {
      setDetail(null)
      return
    }
    void loadDetail(tab.redisSelectedKey)
  }, [loadDetail, tab.redisSelectedKey])

  useEffect(() => {
    if (!detail) {
      setValueDraft('')
      setTtlDraft('')
      setSaveError(null)
      return
    }
    setValueDraft(formatRedisEditorValue(detail))
    setTtlDraft(String(detail.ttl))
    setSaveError(null)
  }, [detail])

  const handleDelete = async (): Promise<void> => {
    if (!tab.connectionId || !tab.redisSelectedKey || !window.db) return
    const confirmed = confirm(t('redis.keyBrowser.deleteConfirm').replace('{{key}}', tab.redisSelectedKey))
    if (!confirmed) return
    await window.db.deleteRedisKey(tab.connectionId, tab.redisSelectedKey, selectedDatabase)
    patchTab(tab.id, { redisSelectedKey: null })
    setDetail(null)
    await loadKeys(currentCursor, cursorHistory)
  }

  const handleSelectKey = (key: string): void => {
    setDetailError(null)
    patchTab(tab.id, { redisSelectedKey: key })
  }

  const handlePrevPage = (): void => {
    if (cursorHistory.length === 0) return
    const previousCursor = cursorHistory[cursorHistory.length - 1]
    const nextHistory = cursorHistory.slice(0, -1)
    void loadKeys(previousCursor, nextHistory)
  }

  const handleNextPage = (): void => {
    if (!hasMore) return
    void loadKeys(nextCursor, [...cursorHistory, currentCursor])
  }

  const handleApplyPageSize = (): void => {
    const parsed = Number(pageSizeInput.trim())
    if (!Number.isInteger(parsed) || parsed < 10 || parsed > 1000) {
      setError(t('redis.keyBrowser.pageSizeError'))
      return
    }
    setError(null)
    patchTab(tab.id, { redisPageSize: parsed })
  }

  const handleSave = async (): Promise<void> => {
    if (!tab.connectionId || !detail || !window.db) return
    if (!isRedisValueEditable(detail.type)) {
      setSaveError(t('redis.keyBrowser.editUnsupported'))
      return
    }

    const ttl = parseRedisTTL(ttlDraft)
    if (ttl == null) {
      setSaveError(t('redis.keyBrowser.ttlError'))
      return
    }

    let parsedValue: unknown
    try {
      parsedValue = parseRedisEditorValue(detail.type, valueDraft)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const updated = await window.db.updateRedisKey({
        connectionId: tab.connectionId,
        key: detail.key,
        database: selectedDatabase,
        type: detail.type,
        value: parsedValue,
        ttl
      })
      setDetail(updated)
      await loadKeys(currentCursor, cursorHistory)
      patchTab(tab.id, { redisSelectedKey: detail.key })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
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
          onClick={() => void loadKeys('0', [])}
          className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary"
        >
          <RefreshCw size={12} className={clsx(loadingKeys && 'animate-spin')} />
          {t('redis.keyBrowser.refresh')}
        </button>
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted">{t('redis.keyBrowser.pageSize')}</span>
          <input
            type="number"
            min={10}
            max={1000}
            value={pageSizeInput}
            onChange={(event) => setPageSizeInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleApplyPageSize()
              }
            }}
            className="w-20 rounded border border-app-border bg-app-input px-2 py-1 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
          />
          <button
            onClick={handleApplyPageSize}
            className="rounded border border-app-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary"
          >
            {t('redis.keyBrowser.applyPageSize')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 w-[320px] flex-col border-r border-app-border bg-app-panel">
          <div className="border-b border-app-border px-3 py-2 text-xs text-text-muted">
            {loadingKeys
              ? t('redis.keyBrowser.loadingKeys')
              : t('redis.keyBrowser.pageInfo')
                  .replace('{{page}}', String(currentPage))
                  .replace('{{count}}', String(keys.length))
                  .replace('{{pageSize}}', String(pageSize))}
            {!loadingKeys && hasMore ? <span className="ml-1">{t('redis.keyBrowser.more')}</span> : null}
          </div>
          <div className="flex items-center justify-between border-b border-app-border px-3 py-2">
            <button
              onClick={handlePrevPage}
              disabled={loadingKeys || cursorHistory.length === 0}
              className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={12} />
              {t('redis.keyBrowser.prevPage')}
            </button>
            <button
              onClick={handleNextPage}
              disabled={loadingKeys || !hasMore}
              className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('redis.keyBrowser.nextPage')}
              <ChevronRight size={12} />
            </button>
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
                  onClick={() => handleSelectKey(item.key)}
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving || !isRedisValueEditable(detail.type)}
                    className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving ? t('redis.keyBrowser.saving') : t('redis.keyBrowser.save')}
                  </button>
                  <button
                    onClick={() => void handleDelete()}
                    className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-accent-red transition-colors hover:bg-red-900/20"
                  >
                    <Trash2 size={12} />
                    {t('redis.keyBrowser.delete')}
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)] md:items-center">
                <label className="text-xs text-text-muted">{t('redis.keyBrowser.ttlEdit')}</label>
                <input
                  type="number"
                  value={ttlDraft}
                  onChange={(event) => setTtlDraft(event.target.value)}
                  className="rounded border border-app-border bg-app-input px-2 py-1 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
                />
              </div>
              <div className="text-2xs text-text-muted">{t('redis.keyBrowser.ttlHint')}</div>
              {isRedisValueEditable(detail.type) ? (
                <>
                  <div className="text-2xs text-text-muted">{getRedisEditorHint(detail.type, t)}</div>
                  <textarea
                    value={valueDraft}
                    onChange={(event) => setValueDraft(event.target.value)}
                    spellCheck={false}
                    className="min-h-[320px] w-full rounded border border-app-border bg-app-panel p-3 font-mono text-xs text-text-secondary focus:border-accent-blue focus:outline-none"
                  />
                </>
              ) : (
                <>
                  <div className="text-2xs text-text-muted">{t('redis.keyBrowser.editUnsupported')}</div>
                  <pre className="overflow-auto rounded border border-app-border bg-app-panel p-3 text-xs text-text-secondary whitespace-pre-wrap break-all">{formatRedisValue(detail.value)}</pre>
                </>
              )}
              {saveError && <div className="rounded border border-red-500/30 bg-red-900/20 p-3 text-xs text-accent-red">{saveError}</div>}
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

function formatRedisEditorValue(detail: RedisKeyDetail): string {
  if (detail.type === 'string') {
    return typeof detail.value === 'string' ? detail.value : String(detail.value ?? '')
  }
  return formatRedisValue(detail.value)
}

function isRedisValueEditable(type: string): boolean {
  return type === 'string' || type === 'list' || type === 'set' || type === 'hash' || type === 'zset'
}

function parseRedisTTL(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return null
  if (parsed === -1) return parsed
  return parsed >= 1 ? parsed : null
}

function parseRedisEditorValue(type: string, value: string): unknown {
  if (type === 'string') return value

  try {
    const parsed = JSON.parse(value)
    if (type === 'list' || type === 'set' || type === 'zset') {
      if (!Array.isArray(parsed)) {
        throw new Error('当前类型要求输入 JSON 数组。')
      }
    }
    if (type === 'hash' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
      throw new Error('Hash 需要输入 JSON 对象。')
    }
    return parsed
  } catch (err) {
    if (err instanceof Error) {
      throw err
    }
    throw new Error(String(err))
  }
}

function getRedisEditorHint(type: string, t: (key: string) => string): string {
  if (type === 'string') return t('redis.keyBrowser.editorHintString')
  if (type === 'hash') return t('redis.keyBrowser.editorHintHash')
  if (type === 'zset') return t('redis.keyBrowser.editorHintZSet')
  return t('redis.keyBrowser.editorHintArray')
}
