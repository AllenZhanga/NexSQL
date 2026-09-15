import type { QueryBatchResult, QueryProgress } from '@shared/types/query'
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

declare global {
  interface Window {
    db:
      | undefined
      | {
          executeBatch(
            executionId: string,
            connectionId: string,
            sql: string,
            database?: string,
            timeoutMs?: number
          ): Promise<QueryBatchResult>
          cancelQuery(executionId: string): Promise<boolean>
          onQueryProgress(callback: (progress: QueryProgress) => void): () => void
          listConnections(): Promise<ConnectionConfig[]>
          addConnection(formData: ConnectionFormData): Promise<ConnectionConfig>
          updateConnection(
            id: string,
            formData: Partial<ConnectionFormData>
          ): Promise<ConnectionConfig>
          deleteConnection(id: string): Promise<void>
          testConnection(
            formData: ConnectionFormData,
            existingId?: string
          ): Promise<ConnectionTestResult>
          connect(id: string): Promise<void>
          disconnect(id: string): Promise<void>
          executeQuery(connectionId: string, sql: string, database?: string): Promise<QueryResult>
          executeTransaction(
            connectionId: string,
            sqls: string[],
            database?: string
          ): Promise<{ success: boolean; message?: string }>
          getDatabases(connectionId: string): Promise<string[]>
          createDatabase(
            connectionId: string,
            database: string,
            charset?: string,
            collation?: string
          ): Promise<void>
          dropDatabase(connectionId: string, database: string): Promise<void>
          alterDatabaseCharset(
            connectionId: string,
            database: string,
            charset: string,
            collation?: string,
            applyToAllTables?: boolean
          ): Promise<void>
          getSchema(connectionId: string, database?: string): Promise<DatabaseSchema>
          getTableColumns(
            connectionId: string,
            table: string,
            database?: string
          ): Promise<SchemaColumn[]>
          getTableIndexes(
            connectionId: string,
            table: string,
            database?: string
          ): Promise<Array<{ name: string; columns: string[]; unique: boolean; primary: boolean }>>
          getTableDDL(connectionId: string, table: string, database?: string): Promise<string>
          exportTableSQL(connectionId: string, table: string, database?: string): Promise<string>
          exportDatabaseSQL(connectionId: string, database?: string): Promise<string>
          importDatabaseSQL(connectionId: string, sql: string, database?: string): Promise<number>
          getHistory(connectionId?: string, limit?: number): Promise<QueryHistoryEntry[]>
          getRedisKeys(
            connectionId: string,
            pattern?: string,
            database?: string,
            cursor?: string,
            pageSize?: number
          ): Promise<RedisKeyPage>
          getRedisKeyDetail(
            connectionId: string,
            key: string,
            database?: string
          ): Promise<RedisKeyDetail>
          deleteRedisKey(connectionId: string, key: string, database?: string): Promise<number>
          updateRedisKey(request: RedisKeyUpdateRequest): Promise<RedisKeyDetail>
          duplicateConnection(id: string): Promise<ConnectionConfig>
          exportConnections(): Promise<string>
          importConnections(jsonStr: string): Promise<number>
        }
    ai:
      | undefined
      | {
          getConfig(): Promise<AIConfig>
          updateConfig(config: Partial<AIConfig>): Promise<void>
          generateSQL(request: NLToSQLRequest): Promise<string>
        }
    platform: string | undefined
  }
}

export {}
