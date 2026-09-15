import type { QueryBatchResult, QueryProgress } from '@shared/types/query'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionConfig,
  ConnectionFormData,
  ConnectionTestResult
} from '@shared/types/connection'
import type {
  QueryResult,
  DatabaseSchema,
  QueryHistoryEntry,
  SchemaColumn
} from '@shared/types/query'
import type { RedisKeyDetail, RedisKeyPage, RedisKeyUpdateRequest } from '@shared/types/redis'
import type { AIConfig, NLToSQLRequest } from '@shared/types/ai'

const dbAPI = {
  executeBatch: (
    executionId: string,
    connectionId: string,
    sql: string,
    database?: string,
    timeoutMs?: number
  ): Promise<QueryBatchResult> =>
    ipcRenderer.invoke('db:executeBatch', executionId, connectionId, sql, database, timeoutMs),
  cancelQuery: (executionId: string): Promise<boolean> =>
    ipcRenderer.invoke('db:cancelQuery', executionId),
  onQueryProgress: (callback: (progress: QueryProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: QueryProgress): void =>
      callback(progress)
    ipcRenderer.on('db:queryProgress', listener)
    return () => ipcRenderer.off('db:queryProgress', listener)
  },
  listConnections: (): Promise<ConnectionConfig[]> => ipcRenderer.invoke('db:listConnections'),

  addConnection: (formData: ConnectionFormData): Promise<ConnectionConfig> =>
    ipcRenderer.invoke('db:addConnection', formData),

  updateConnection: (
    id: string,
    formData: Partial<ConnectionFormData>
  ): Promise<ConnectionConfig> => ipcRenderer.invoke('db:updateConnection', id, formData),

  deleteConnection: (id: string): Promise<void> => ipcRenderer.invoke('db:deleteConnection', id),

  testConnection: (
    formData: ConnectionFormData,
    existingId?: string
  ): Promise<ConnectionTestResult> => ipcRenderer.invoke('db:testConnection', formData, existingId),

  connect: (id: string): Promise<void> => ipcRenderer.invoke('db:connect', id),

  disconnect: (id: string): Promise<void> => ipcRenderer.invoke('db:disconnect', id),

  executeQuery: (connectionId: string, sql: string, database?: string): Promise<QueryResult> =>
    ipcRenderer.invoke('db:executeQuery', connectionId, sql, database),

  executeTransaction: (
    connectionId: string,
    sqls: string[],
    database?: string
  ): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke('db:executeTransaction', connectionId, sqls, database),

  getDatabases: (connectionId: string): Promise<string[]> =>
    ipcRenderer.invoke('db:getDatabases', connectionId),

  createDatabase: (
    connectionId: string,
    database: string,
    charset?: string,
    collation?: string
  ): Promise<void> =>
    ipcRenderer.invoke('db:createDatabase', connectionId, database, charset, collation),

  dropDatabase: (connectionId: string, database: string): Promise<void> =>
    ipcRenderer.invoke('db:dropDatabase', connectionId, database),

  alterDatabaseCharset: (
    connectionId: string,
    database: string,
    charset: string,
    collation?: string,
    applyToAllTables?: boolean
  ): Promise<void> =>
    ipcRenderer.invoke(
      'db:alterDatabaseCharset',
      connectionId,
      database,
      charset,
      collation,
      applyToAllTables
    ),

  getSchema: (connectionId: string, database?: string): Promise<DatabaseSchema> =>
    ipcRenderer.invoke('db:getSchema', connectionId, database),

  getTableColumns: (
    connectionId: string,
    table: string,
    database?: string
  ): Promise<SchemaColumn[]> =>
    ipcRenderer.invoke('db:getTableColumns', connectionId, table, database),

  getTableIndexes: (
    connectionId: string,
    table: string,
    database?: string
  ): Promise<Array<{ name: string; columns: string[]; unique: boolean; primary: boolean }>> =>
    ipcRenderer.invoke('db:getTableIndexes', connectionId, table, database),

  getTableDDL: (connectionId: string, table: string, database?: string): Promise<string> =>
    ipcRenderer.invoke('db:getTableDDL', connectionId, table, database),

  exportTableSQL: (connectionId: string, table: string, database?: string): Promise<string> =>
    ipcRenderer.invoke('db:exportTableSQL', connectionId, table, database),

  exportDatabaseSQL: (connectionId: string, database?: string): Promise<string> =>
    ipcRenderer.invoke('db:exportDatabaseSQL', connectionId, database),

  importDatabaseSQL: (connectionId: string, sql: string, database?: string): Promise<number> =>
    ipcRenderer.invoke('db:importDatabaseSQL', connectionId, sql, database),

  getHistory: (connectionId?: string, limit?: number): Promise<QueryHistoryEntry[]> =>
    ipcRenderer.invoke('db:getHistory', connectionId, limit),

  getRedisKeys: (
    connectionId: string,
    pattern?: string,
    database?: string,
    cursor?: string,
    pageSize?: number
  ): Promise<RedisKeyPage> =>
    ipcRenderer.invoke('db:getRedisKeys', connectionId, pattern, database, cursor, pageSize),

  getRedisKeyDetail: (
    connectionId: string,
    key: string,
    database?: string
  ): Promise<RedisKeyDetail> =>
    ipcRenderer.invoke('db:getRedisKeyDetail', connectionId, key, database),

  deleteRedisKey: (connectionId: string, key: string, database?: string): Promise<number> =>
    ipcRenderer.invoke('db:deleteRedisKey', connectionId, key, database),

  updateRedisKey: (request: RedisKeyUpdateRequest): Promise<RedisKeyDetail> =>
    ipcRenderer.invoke('db:updateRedisKey', request),

  duplicateConnection: (id: string): Promise<ConnectionConfig> =>
    ipcRenderer.invoke('db:duplicateConnection', id),

  exportConnections: (): Promise<string> => ipcRenderer.invoke('db:exportConnections'),

  importConnections: (jsonStr: string): Promise<number> =>
    ipcRenderer.invoke('db:importConnections', jsonStr)
}

const aiAPI = {
  getConfig: (): Promise<AIConfig> => ipcRenderer.invoke('ai:getConfig'),

  updateConfig: (config: Partial<AIConfig>): Promise<void> =>
    ipcRenderer.invoke('ai:updateConfig', config),

  generateSQL: (request: NLToSQLRequest): Promise<string> =>
    ipcRenderer.invoke('ai:generateSQL', request)
}

contextBridge.exposeInMainWorld('db', dbAPI)
contextBridge.exposeInMainWorld('ai', aiAPI)
contextBridge.exposeInMainWorld('platform', process.platform)

export type DbAPI = typeof dbAPI
export type AiAPI = typeof aiAPI
