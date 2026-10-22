export type DBType = 'mysql' | 'postgresql' | 'mssql' | 'sqlite' | 'redis'

export interface SSHConfig {
  host: string
  port: number
  username: string
  password?: string
  privateKeyPath?: string
  authMethod?: 'password' | 'privateKey'
  passphrase?: string
  hasPassword?: boolean
  hasPassphrase?: boolean
}

export interface ConnectionConfig {
  id: string
  name: string
  type: DBType
  host?: string
  port?: number
  database?: string
  username?: string
  ssl?: boolean
  tlsServerName?: string // Runtime only: original database host behind a local SSH forward.
  filePath?: string // SQLite only
  group?: string
  tags?: string[]
  ssh?: SSHConfig
  createdAt: number
  updatedAt: number
}

export interface ConnectionFormData {
  name: string
  type: DBType
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  ssl?: boolean
  filePath?: string
  group?: string
  tags?: string[]
  ssh?: SSHConfig | null
}

export interface ConnectionTestResult {
  success: boolean
  message: string
  latencyMs?: number
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error'
