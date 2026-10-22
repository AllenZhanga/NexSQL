import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QueryBatchResult } from '@shared/types/query'
import type {
  QueryResult,
  QueryHistoryEntry,
  DatabaseSchema,
  SchemaColumn
} from '@shared/types/query'
import { useConnectionStore } from './connectionStore'

export type QueryTabType = 'query' | 'table' | 'database' | 'redis-console' | 'redis-browser'
export type TableSortDirection = 'asc' | 'desc'

export interface TableSortRule {
  column: string
  direction: TableSortDirection
}

export interface TableColumnFilterRule {
  id: string
  column: string
  value: string
}

export interface TablePendingEdit {
  originalRow: Record<string, unknown>
  values: Record<string, string>
}

export interface TableDraftInsert {
  id: string
  values: Record<string, string>
}

export interface TableViewState {
  page: number
  pageSize: number
  totalRows: number
  sortColumn: string | null
  sortDirection: TableSortDirection
  sortRules: TableSortRule[]
  filterText: string
  columnFilters: TableColumnFilterRule[]
  columns: SchemaColumn[]
  rows: Record<string, unknown>[]
  pendingEdits: Record<string, TablePendingEdit>
  pendingInserts: TableDraftInsert[]
  pendingDeletes: Record<string, Record<string, unknown>>
}

export interface QueryTab {
  id: string
  title: string
  type: QueryTabType
  connectionId: string | null
  sql: string
  result: QueryResult | null
  isLoading: boolean
  error: string | null
  batch?: QueryBatchResult
  executionId?: string
  isCancelling?: boolean
  startedAt?: number
  timeoutMs?: number
  selectedDatabase: string | null
  tableName?: string
  tableView?: TableViewState
  hasPendingChanges?: boolean
  redisSearchPattern?: string
  redisSelectedKey?: string | null
  redisPageSize?: number
}

export const schemaRequestKey = (connectionId: string, database?: string): string =>
  JSON.stringify([connectionId, database ?? null])
const schemaRequests = new Map<string, { connectionId: string; promise: Promise<void> }>()
const schemaGenerations = new Map<string, number>()

interface QueryState {
  tabs: QueryTab[]
  activeTabId: string | null
  history: QueryHistoryEntry[]
  schema: Record<string, DatabaseSchema> // keyed by connectionId
  schemaLoading: Record<string, boolean>
  schemaErrors: Record<string, string | undefined>

  // Tab actions
  newTab: (connectionId?: string) => string
  openTableTab: (connectionId: string, tableName: string, database?: string) => string
  openDatabaseTab: (connectionId: string, database: string) => string
  openRedisConsoleTab: (connectionId: string, database?: string) => string
  openRedisBrowserTab: (connectionId: string, database?: string) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTabSQL: (tabId: string, sql: string) => void
  updateTabConnection: (tabId: string, connectionId: string | null) => void
  updateTabDatabase: (tabId: string, database: string | null) => void
  patchTab: (tabId: string, patch: Partial<QueryTab>) => void
  updateTableView: (tabId: string, updater: (view: TableViewState) => TableViewState) => void

  // Query actions
  executeQuery: (tabId: string, sqlOverride?: string) => Promise<void>

  // Schema actions
  loadSchema: (connectionId: string, database?: string, force?: boolean) => Promise<void>
  clearSchema: (connectionId: string) => void
  getSchema: (connectionId: string) => DatabaseSchema | null

  cancelQuery: (tabId: string) => Promise<void>

  // History actions
  loadHistory: (connectionId?: string) => Promise<void>
}

export const useQueryStore = create<QueryState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      history: [],
      schema: {},
      schemaLoading: {},
      schemaErrors: {},

      newTab: (connectionId) => {
        const id = crypto.randomUUID()
        const tabCount = get().tabs.length + 1
        const tab: QueryTab = {
          id,
          title: `Query ${tabCount}`,
          type: 'query',
          connectionId: connectionId ?? null,
          sql: '',
          result: null,
          isLoading: false,
          error: null,
          selectedDatabase: null
        }
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
        return id
      },

      openTableTab: (connectionId, tableName, database) => {
        const existing = get().tabs.find(
          (tab) =>
            tab.type === 'table' &&
            tab.connectionId === connectionId &&
            tab.tableName === tableName &&
            (tab.selectedDatabase ?? null) === (database ?? null)
        )

        if (existing) {
          set({ activeTabId: existing.id })
          return existing.id
        }

        const id = crypto.randomUUID()
        const tab: QueryTab = {
          id,
          title: tableName,
          type: 'table',
          connectionId,
          sql: '',
          result: null,
          isLoading: false,
          error: null,
          selectedDatabase: database ?? null,
          tableName,
          hasPendingChanges: false,
          tableView: {
            page: 1,
            pageSize: 100,
            totalRows: 0,
            sortColumn: null,
            sortDirection: 'asc',
            sortRules: [],
            filterText: '',
            columnFilters: [],
            columns: [],
            rows: [],
            pendingEdits: {},
            pendingInserts: [],
            pendingDeletes: {}
          }
        }
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
        return id
      },

      openRedisConsoleTab: (connectionId, database) => {
        const existing = get().tabs.find(
          (tab) =>
            tab.type === 'redis-console' &&
            tab.connectionId === connectionId &&
            (tab.selectedDatabase ?? null) === (database ?? null)
        )

        if (existing) {
          set({ activeTabId: existing.id })
          return existing.id
        }

        const id = crypto.randomUUID()
        const tab: QueryTab = {
          id,
          title: `Redis Console ${database ? `DB ${database}` : ''}`.trim(),
          type: 'redis-console',
          connectionId,
          sql: '',
          result: null,
          isLoading: false,
          error: null,
          selectedDatabase: database ?? null
        }
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
        return id
      },

      openRedisBrowserTab: (connectionId, database) => {
        const existing = get().tabs.find(
          (tab) =>
            tab.type === 'redis-browser' &&
            tab.connectionId === connectionId &&
            (tab.selectedDatabase ?? null) === (database ?? null)
        )

        if (existing) {
          set({ activeTabId: existing.id })
          return existing.id
        }

        const id = crypto.randomUUID()
        const tab: QueryTab = {
          id,
          title: `Key Browser ${database ? `DB ${database}` : ''}`.trim(),
          type: 'redis-browser',
          connectionId,
          sql: '',
          result: null,
          isLoading: false,
          error: null,
          selectedDatabase: database ?? null,
          redisSearchPattern: '*',
          redisSelectedKey: null,
          redisPageSize: 100
        }
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
        return id
      },

      openDatabaseTab: (connectionId, database) => {
        const existing = get().tabs.find(
          (tab) =>
            tab.type === 'database' &&
            tab.connectionId === connectionId &&
            (tab.selectedDatabase ?? null) === database
        )

        if (existing) {
          set({ activeTabId: existing.id })
          return existing.id
        }

        const id = crypto.randomUUID()
        const tab: QueryTab = {
          id,
          title: database,
          type: 'database',
          connectionId,
          sql: '',
          result: null,
          isLoading: false,
          error: null,
          selectedDatabase: database
        }
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
        return id
      },

      closeTab: (tabId) => {
        if (get().tabs.find((t) => t.id === tabId)?.isLoading) return
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === tabId)
          const newTabs = state.tabs.filter((t) => t.id !== tabId)
          let newActiveId = state.activeTabId
          if (state.activeTabId === tabId) {
            if (newTabs.length > 0) {
              newActiveId = newTabs[Math.max(0, idx - 1)].id
            } else {
              newActiveId = null
            }
          }
          return { tabs: newTabs, activeTabId: newActiveId }
        })
      },

      setActiveTab: (tabId) => {
        set({ activeTabId: tabId })
      },

      updateTabSQL: (tabId, sql) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, sql } : t))
        }))
      },

      updateTabConnection: (tabId, connectionId) => {
        if (get().tabs.find((t) => t.id === tabId)?.isLoading) return
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, connectionId, selectedDatabase: null } : t
          )
        }))
      },

      updateTabDatabase: (tabId, database) => {
        if (get().tabs.find((t) => t.id === tabId)?.isLoading) return
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, selectedDatabase: database } : t))
        }))
      },

      patchTab: (tabId, patch) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
        }))
      },

      updateTableView: (tabId, updater) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId || !tab.tableView) return tab
            return { ...tab, tableView: updater(tab.tableView) }
          })
        }))
      },

      cancelQuery: async (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId)
        if (!tab?.executionId || !tab.isLoading || tab.isCancelling || !window.db) return
        get().patchTab(tabId, { isCancelling: true })
        try {
          await window.db.cancelQuery(tab.executionId)
        } catch (err) {
          get().patchTab(tabId, { isCancelling: false, error: String(err) })
        }
      },

      executeQuery: async (tabId, sqlOverride) => {
        const tab = get().tabs.find((t) => t.id === tabId)
        const sql = sqlOverride ?? tab?.sql ?? ''
        if (!tab || tab.isLoading || !tab.connectionId || !sql.trim()) return
        if (!window.db) {
          get().patchTab(tabId, { error: '数据库接口不可用，请在桌面应用中执行' })
          return
        }
        if (tab.type === 'redis-console') {
          get().patchTab(tabId, { isLoading: true, error: null })
          try {
            const result = await window.db.executeQuery(
              tab.connectionId,
              sql,
              tab.selectedDatabase ?? undefined
            )
            get().patchTab(tabId, { result, error: result.error ?? null })
          } catch (err) {
            get().patchTab(tabId, { error: String(err) })
          } finally {
            get().patchTab(tabId, { isLoading: false })
          }
          return
        }
        const executionId = crypto.randomUUID()
        get().patchTab(tabId, {
          isLoading: true,
          isCancelling: false,
          error: null,
          result: null,
          batch: undefined,
          executionId,
          startedAt: Date.now()
        })
        const unsubscribe = window.db.onQueryProgress((progress) => {
          if (progress.executionId !== executionId) return
          const current = get().tabs.find((t) => t.id === tabId)
          if (current?.executionId !== executionId) return
          get().patchTab(tabId, {
            result: progress.result,
            batch: {
              results: [...(current.batch?.results ?? []), progress.result],
              totalStatements: progress.total,
              durationMs: Date.now() - (current.startedAt ?? Date.now()),
              status: 'completed'
            }
          })
        })
        try {
          const batch = await window.db.executeBatch(
            executionId,
            tab.connectionId,
            sql,
            tab.selectedDatabase ?? undefined,
            tab.timeoutMs ?? 300000
          )
          get().patchTab(tabId, {
            batch,
            result: batch.results[batch.results.length - 1] ?? null,
            error: batch.error ?? null
          })
        } catch (err) {
          get().patchTab(tabId, { error: err instanceof Error ? err.message : String(err) })
        } finally {
          unsubscribe()
          get().patchTab(tabId, { isLoading: false, isCancelling: false, executionId: undefined })
        }
      },

      clearSchema: (connectionId) => {
        schemaGenerations.set(connectionId, (schemaGenerations.get(connectionId) ?? 0) + 1)
        for (const [key, request] of schemaRequests)
          if (request.connectionId === connectionId) schemaRequests.delete(key)
        set((state) => ({
          schema: Object.fromEntries(
            Object.entries(state.schema).filter(([id]) => id !== connectionId)
          ),
          schemaLoading: Object.fromEntries(
            Object.entries(state.schemaLoading).filter(
              ([key]) => JSON.parse(key)[0] !== connectionId
            )
          ),
          schemaErrors: Object.fromEntries(
            Object.entries(state.schemaErrors).filter(
              ([key]) => JSON.parse(key)[0] !== connectionId
            )
          )
        }))
      },

      loadSchema: async (connectionId, database, force = true) => {
        if (!window.db) return
        const connectionState = useConnectionStore.getState()
        if (
          !connectionState.connections.some((c) => c.id === connectionId) ||
          connectionState.statuses[connectionId] !== 'connected'
        )
          return
        const key = schemaRequestKey(connectionId, database)
        const pending = schemaRequests.get(key)
        if (pending) return pending.promise
        const cached = get().schema[connectionId]
        if (
          !force &&
          (database === undefined
            ? !!cached
            : cached?.databases.some((db) => db.name === database && db.tablesLoaded))
        )
          return
        const generation = schemaGenerations.get(connectionId) ?? 0
        const valid = () =>
          (schemaGenerations.get(connectionId) ?? 0) === generation &&
          useConnectionStore.getState().statuses[connectionId] === 'connected'
        set((state) => ({
          schemaLoading: { ...state.schemaLoading, [key]: true },
          schemaErrors: { ...state.schemaErrors, [key]: undefined }
        }))
        const promise = (async () => {
          try {
            const incoming = await window.db!.getSchema(connectionId, database)
            if (!valid()) return
            set((state) => {
              const previous = state.schema[connectionId]?.databases ?? []
              const incomingByName = new Map(incoming.databases.map((db) => [db.name, db]))
              const databases =
                database === undefined
                  ? incoming.databases.map(
                      (db) => previous.find((old) => old.name === db.name && old.tablesLoaded) ?? db
                    )
                  : [
                      ...previous.map((db) =>
                        incomingByName.get(db.name)
                          ? { ...incomingByName.get(db.name)!, tablesLoaded: true }
                          : db
                      ),
                      ...incoming.databases
                        .filter((db) => !previous.some((old) => old.name === db.name))
                        .map((db) => ({ ...db, tablesLoaded: true }))
                    ]
              return { schema: { ...state.schema, [connectionId]: { ...incoming, databases } } }
            })
          } catch (error) {
            if (valid())
              set((state) => ({
                schemaErrors: {
                  ...state.schemaErrors,
                  [key]: error instanceof Error ? error.message : String(error)
                }
              }))
          } finally {
            if (valid())
              set((state) => ({ schemaLoading: { ...state.schemaLoading, [key]: false } }))
          }
        })()
        schemaRequests.set(key, { connectionId, promise })
        try {
          await promise
        } finally {
          if (schemaRequests.get(key)?.promise === promise) schemaRequests.delete(key)
        }
      },

      getSchema: (connectionId) => {
        return get().schema[connectionId] ?? null
      },

      loadHistory: async (connectionId) => {
        if (!window.db) return
        const history = await window.db.getHistory(connectionId, 200)
        set({ history })
      }
    }),
    {
      name: 'nexsql-query-drafts-v1',
      merge: (persisted, current) => {
        const saved = persisted as Partial<QueryState> | undefined
        const tabs = saved?.tabs ?? current.tabs
        const activeTabId = tabs.some((tab) => tab.id === saved?.activeTabId)
          ? saved!.activeTabId!
          : (tabs[tabs.length - 1]?.id ?? null)
        return { ...current, tabs, activeTabId }
      },
      partialize: (state) => ({
        activeTabId: state.activeTabId,
        tabs: state.tabs
          .filter((tab) => tab.type === 'query')
          .map((tab) => ({
            id: tab.id,
            title: tab.title,
            type: tab.type,
            connectionId: tab.connectionId,
            selectedDatabase: tab.selectedDatabase,
            timeoutMs: tab.timeoutMs,
            sql: tab.sql,
            result: null,
            isLoading: false,
            error: null
          }))
      })
    }
  )
)
