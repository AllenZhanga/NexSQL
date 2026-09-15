export interface QueryColumn {
  name: string
  type: string
  nullable?: boolean
}

export interface QueryResult {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  sql: string
  error?: string
}

export interface QueryHistoryEntry {
  database?: string
  id: string
  connectionId: string
  sql: string
  durationMs: number
  rowCount: number
  success: boolean
  error?: string
  executedAt: number
}

export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
  collation?: string
  comment?: string
}

export interface SchemaTable {
  name: string
  schema?: string
  type: 'table' | 'view'
  columns: SchemaColumn[]
  comment?: string
}

export interface DatabaseInfo {
  name: string
  tables: SchemaTable[]
}

export interface DatabaseSchema {
  connectionId: string
  databases: DatabaseInfo[]
}

export interface QueryBatchResult {
  results: QueryResult[]
  totalStatements: number
  durationMs: number
  warning?: string
  status: 'completed' | 'failed' | 'cancelled'
  error?: string
}
export interface QueryProgress {
  executionId: string
  index: number
  total: number
  result: QueryResult
}
