import type { DBType } from './connection'

export interface ConnectionImportEntry {
  index: number
  name: string
  type?: DBType
  sourceType: string
  address: string
  database: string
  username: string
  group: string
  status: 'ready' | 'duplicate' | 'unsupported' | 'invalid'
  passwordStatus: 'included' | 'missing' | 'unavailable' | 'not-needed'
  warnings: string[]
  ssh?: {
    host: string
    port: number
    username: string
    authMethod: 'password' | 'privateKey'
    credentialStatus: 'included' | 'missing' | 'unavailable' | 'not-needed'
  }
}

export interface ConnectionImportPreview {
  format: 'navicat' | 'nexsql'
  entries: ConnectionImportEntry[]
}

export const CONNECTION_IMPORT_MAX_BYTES = 5 * 1024 * 1024
