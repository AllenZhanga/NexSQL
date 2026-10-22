import { app, safeStorage } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  ConnectionConfig,
  ConnectionFormData,
  ConnectionTestResult
} from '@shared/types/connection'
import type { SSHConfig } from '@shared/types/connection'
import { validateSSHConfig, sshAuthMethod } from '@shared/ssh'
import { createDriver } from './drivers'
import type { IDbDriver } from './types'
import { parseConnectionImport } from './ConnectionImport'
import type { ConnectionImportPreview } from '@shared/types/connectionImport'

let internalDb: Database.Database | null = null

function getInternalDb(): Database.Database {
  if (!internalDb) {
    const dbPath = join(app.getPath('userData'), 'nexsql.db')
    internalDb = new Database(dbPath)
    internalDb.pragma('journal_mode = WAL')
    internalDb.pragma('foreign_keys = ON')
    initSchema(internalDb)
  }
  return internalDb
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT,
      port INTEGER,
      database_name TEXT NOT NULL DEFAULT '',
      username TEXT,
      password_encrypted BLOB,
      ssl INTEGER DEFAULT 0,
      file_path TEXT,
      group_name TEXT,
      tags TEXT,
      ssh_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      sql TEXT NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      row_count INTEGER DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      executed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_connection ON query_history(connection_id);
    CREATE INDEX IF NOT EXISTS idx_history_executed_at ON query_history(executed_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  const historyColumns = db.pragma('table_info(query_history)') as { name: string }[]
  if (!historyColumns.some((column) => column.name === 'database_name'))
    db.exec('ALTER TABLE query_history ADD COLUMN database_name TEXT')

  // Migrations: add new columns if missing
  const cols = db.pragma('table_info(connections)') as { name: string }[]
  const colNames = cols.map((c) => c.name)
  if (!colNames.includes('group_name'))
    db.exec(`ALTER TABLE connections ADD COLUMN group_name TEXT`)
  if (!colNames.includes('tags')) db.exec(`ALTER TABLE connections ADD COLUMN tags TEXT`)
  if (!colNames.includes('ssh_config'))
    db.exec(`ALTER TABLE connections ADD COLUMN ssh_config TEXT`)
  for (const row of db
    .prepare('SELECT id, ssh_config FROM connections WHERE ssh_config IS NOT NULL')
    .all() as { id: string; ssh_config: string }[]) {
    const ssh = JSON.parse(row.ssh_config) as SSHConfig
    if (ssh.password || ssh.passphrase)
      db.prepare('UPDATE connections SET ssh_config = ? WHERE id = ?').run(
        serializeSSH(ssh, row.ssh_config, false),
        row.id
      )
  }
}

// Row type from internal DB
interface ConnectionRow {
  id: string
  name: string
  type: string
  host: string | null
  port: number | null
  database_name: string
  username: string | null
  password_encrypted: Buffer | null
  ssl: number
  file_path: string | null
  group_name: string | null
  tags: string | null
  ssh_config: string | null
  created_at: number
  updated_at: number
}

function rowToConfig(row: ConnectionRow): ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ConnectionConfig['type'],
    host: row.host ?? undefined,
    port: row.port ?? undefined,
    database: row.database_name || undefined,
    username: row.username ?? undefined,
    ssl: row.ssl === 1,
    filePath: row.file_path ?? undefined,
    group: row.group_name ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    ssh: publicSSH(row.ssh_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function encryptPassword(password: string): Buffer | null {
  if (!password) return null
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(password)
  }
  // Fallback: store base64 if safeStorage unavailable (dev/test)
  return Buffer.from(Buffer.from(password).toString('base64'))
}

function decryptPassword(encrypted: Buffer | null): string {
  if (!encrypted) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(encrypted)
  }
  return Buffer.from(encrypted.toString(), 'base64').toString()
}

interface StoredSSH extends Omit<SSHConfig, 'password' | 'passphrase'> {
  password?: string // legacy migration only
  passphrase?: string
  passwordEncrypted?: string
  passphraseEncrypted?: string
}

function publicSSH(raw: string | null): SSHConfig | undefined {
  if (!raw) return undefined
  const ssh = JSON.parse(raw) as StoredSSH
  return {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    authMethod: sshAuthMethod(ssh),
    privateKeyPath: ssh.privateKeyPath,
    hasPassword: !!(ssh.passwordEncrypted || ssh.password),
    hasPassphrase: !!(ssh.passphraseEncrypted || ssh.passphrase)
  }
}

function runtimeSSH(raw: string | null): SSHConfig | undefined {
  const config = publicSSH(raw)
  if (!config || !raw) return undefined
  const stored = JSON.parse(raw) as StoredSSH
  return {
    ...config,
    password: stored.passwordEncrypted
      ? decryptPassword(Buffer.from(stored.passwordEncrypted, 'base64'))
      : stored.password,
    passphrase: stored.passphraseEncrypted
      ? decryptPassword(Buffer.from(stored.passphraseEncrypted, 'base64'))
      : stored.passphrase
  }
}

function serializeSSH(
  ssh: SSHConfig | null | undefined,
  previous?: string | null,
  validate = true
): string | null {
  if (!ssh) return null
  if (validate) validateSSHConfig(ssh)
  const old = previous ? (JSON.parse(previous) as StoredSSH) : undefined
  const secret = (key: 'password' | 'passphrase'): string | undefined => {
    const encryptedKey = key === 'password' ? 'passwordEncrypted' : 'passphraseEncrypted'
    return ssh[key]
      ? encryptPassword(ssh[key]!)?.toString('base64')
      : (old?.[encryptedKey] ??
          (old?.[key] ? encryptPassword(old[key]!)?.toString('base64') : undefined))
  }
  const authMethod = sshAuthMethod(ssh)
  return JSON.stringify({
    host: ssh.host?.trim() ?? '',
    port: ssh.port,
    username: ssh.username?.trim() ?? '',
    authMethod,
    privateKeyPath: authMethod === 'privateKey' ? ssh.privateKeyPath : undefined,
    passwordEncrypted: authMethod === 'password' ? secret('password') : undefined,
    passphraseEncrypted: authMethod === 'privateKey' ? secret('passphrase') : undefined
  })
}

// Active connection pool
const activeConnections = new Map<string, IDbDriver>()
const pendingConnections = new Map<string, { driver: IDbDriver; promise: Promise<void> }>()

const CONNECTION_TEST_TIMEOUT_MS = 10000

function getConnectionTimeoutMessage(
  config: Pick<ConnectionConfig, 'type' | 'host' | 'ssl'>
): string {
  const host = config.host?.trim().toLowerCase() ?? ''
  if (config.type === 'redis' && host.endsWith('.aliyuncs.com')) {
    return '连接超时，请检查主机、端口、密码或 TLS 配置。阿里云 Redis 还需确认连接地址类型正确，并将当前客户端出口 IP 加入白名单；若实例为 VPC 地址，则需要在同一 VPC 内访问。'
  }

  return '连接超时，请检查主机、端口、密码或 TLS 配置。'
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  return readConnections()
}

function readConnections(): ConnectionConfig[] {
  const db = getInternalDb()
  const rows = db.prepare('SELECT * FROM connections ORDER BY name').all() as ConnectionRow[]
  return rows.map(rowToConfig)
}

export async function addConnection(formData: ConnectionFormData): Promise<ConnectionConfig> {
  return insertConnection(formData)
}

function insertConnection(formData: ConnectionFormData): ConnectionConfig {
  if (formData.type === 'sqlite' && formData.ssh) throw new Error('SQLite 文件连接不支持 SSH 隧道')
  const db = getInternalDb()
  const now = Date.now()
  const id = randomUUID()
  const passwordEncrypted = encryptPassword(formData.password ?? '')

  db.prepare(
    `
    INSERT INTO connections (id, name, type, host, port, database_name, username, password_encrypted, ssl, file_path, group_name, tags, ssh_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    formData.name,
    formData.type,
    formData.host ?? null,
    formData.port ?? null,
    formData.database ?? '',
    formData.username ?? null,
    passwordEncrypted,
    formData.ssl ? 1 : 0,
    formData.filePath ?? null,
    formData.group ?? null,
    formData.tags ? JSON.stringify(formData.tags) : null,
    serializeSSH(formData.ssh),
    now,
    now
  )

  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  return rowToConfig(row)
}

export async function updateConnection(
  id: string,
  formData: Partial<ConnectionFormData>
): Promise<ConnectionConfig> {
  const db = getInternalDb()
  const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!existing) throw new Error(`Connection not found: ${id}`)

  const now = Date.now()
  // Only update password if a non-empty value is provided; keep existing otherwise
  const passwordEncrypted =
    formData.password !== undefined && formData.password !== ''
      ? encryptPassword(formData.password)
      : existing.password_encrypted
  const sshConfig =
    formData.ssh !== undefined
      ? serializeSSH(formData.ssh, existing.ssh_config)
      : existing.ssh_config
  await disconnectById(id)

  db.prepare(
    `
    UPDATE connections SET
      name = ?, type = ?, host = ?, port = ?, database_name = ?,
      username = ?, password_encrypted = ?, ssl = ?, file_path = ?,
      group_name = ?, tags = ?, ssh_config = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(
    formData.name ?? existing.name,
    formData.type ?? existing.type,
    formData.host ?? existing.host,
    formData.port ?? existing.port,
    formData.database ?? existing.database_name,
    formData.username ?? existing.username,
    passwordEncrypted,
    formData.ssl !== undefined ? (formData.ssl ? 1 : 0) : existing.ssl,
    formData.filePath ?? existing.file_path,
    formData.group !== undefined ? formData.group || null : existing.group_name,
    formData.tags !== undefined
      ? formData.tags
        ? JSON.stringify(formData.tags)
        : null
      : existing.tags,
    sshConfig,
    now,
    id
  )

  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  return rowToConfig(row)
}

export async function deleteConnection(id: string): Promise<void> {
  // Disconnect if active
  await disconnectById(id)
  const db = getInternalDb()
  db.prepare('DELETE FROM connections WHERE id = ?').run(id)
  db.prepare('DELETE FROM query_history WHERE connection_id = ?').run(id)
}

export async function testConnection(
  formData: ConnectionFormData,
  existingId?: string
): Promise<ConnectionTestResult> {
  const start = Date.now()

  // When editing an existing connection and password field is blank,
  // fall back to the stored (encrypted) password so the test uses real credentials.
  let passwordToUse = formData.password ?? ''
  if (!passwordToUse && existingId) {
    passwordToUse = getConnectionPassword(existingId)
  }
  const savedSSH =
    formData.ssh === null || !existingId ? undefined : getConnectionRuntimeConfig(existingId).ssh
  const inputSSH = formData.ssh === undefined ? savedSSH : formData.ssh

  const tempConfig: ConnectionConfig = {
    id: 'test',
    name: formData.name,
    type: formData.type,
    host: formData.host,
    port: formData.port,
    database: formData.database,
    username: formData.username,
    ssl: formData.ssl,
    filePath: formData.filePath,
    ssh: inputSSH
      ? {
          ...inputSSH,
          password: inputSSH.password || savedSSH?.password,
          passphrase: inputSSH.passphrase || savedSSH?.passphrase
        }
      : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  let driver: IDbDriver | null = null
  try {
    driver = createDriver(tempConfig, passwordToUse)
    await withTimeout(
      driver.testConnection(),
      tempConfig.ssh ? 90000 : CONNECTION_TEST_TIMEOUT_MS,
      getConnectionTimeoutMessage(tempConfig)
    )
    return { success: true, message: '连接成功', latencyMs: Date.now() - start }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start
    }
  } finally {
    if (driver) {
      try {
        await withTimeout(driver.disconnect(), 2000, 'disconnect timeout')
      } catch {
        // ignore cleanup failures from temporary test drivers
      }
    }
  }
}

export async function connectById(id: string): Promise<void> {
  if (activeConnections.has(id)) return
  const pending = pendingConnections.get(id)
  if (pending) return pending.promise

  const db = getInternalDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!row) throw new Error(`Connection not found: ${id}`)

  const config = { ...rowToConfig(row), ssh: runtimeSSH(row.ssh_config) }
  const password = decryptPassword(row.password_encrypted)
  const driver = createDriver(config, password)
  const promise = (async () => {
    await Promise.resolve()
    try {
      if (pendingConnections.get(id)?.driver !== driver) throw new Error('连接已取消')
      await withTimeout(
        driver.testConnection(),
        config.ssh ? 90000 : CONNECTION_TEST_TIMEOUT_MS,
        getConnectionTimeoutMessage(config)
      )
      if (pendingConnections.get(id)?.driver !== driver) throw new Error('连接已取消')
      activeConnections.set(id, driver)
    } catch (err) {
      try {
        await withTimeout(driver.disconnect(), 2000, 'disconnect timeout')
      } catch {
        /* already closed */
      }
      throw err
    } finally {
      if (pendingConnections.get(id)?.driver === driver) pendingConnections.delete(id)
    }
  })()
  pendingConnections.set(id, { driver, promise })
  return promise
}

export async function reconnectById(id: string): Promise<void> {
  // Tear down the stale driver first, ignoring any disconnect errors
  const stale = activeConnections.get(id)
  if (stale) {
    try {
      await stale.disconnect()
    } catch {
      /* ignore */
    }
    activeConnections.delete(id)
  }
  await connectById(id)
}

export async function disconnectById(id: string): Promise<void> {
  const pending = pendingConnections.get(id)
  pendingConnections.delete(id)
  if (pending) await pending.driver.disconnect()
  const driver = activeConnections.get(id)
  if (driver) {
    activeConnections.delete(id)
    await driver.disconnect()
  }
}

export function getDriver(id: string): IDbDriver {
  const driver = activeConnections.get(id)
  if (!driver) throw new Error(`Not connected to: ${id}. Call connect first.`)
  return driver
}

export function getConnectionConfig(id: string): ConnectionConfig {
  const db = getInternalDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!row) throw new Error(`Connection not found: ${id}`)
  return rowToConfig(row)
}

export function getConnectionRuntimeConfig(id: string): ConnectionConfig {
  const row = getInternalDb()
    .prepare('SELECT * FROM connections WHERE id = ?')
    .get(id) as ConnectionRow
  if (!row) throw new Error(`Connection not found: ${id}`)
  return { ...rowToConfig(row), ssh: runtimeSSH(row.ssh_config) }
}

export function getConnectionPassword(id: string): string {
  const db = getInternalDb()
  const row = db.prepare('SELECT password_encrypted FROM connections WHERE id = ?').get(id) as Pick<
    ConnectionRow,
    'password_encrypted'
  >
  if (!row) return ''
  return decryptPassword(row.password_encrypted)
}

export async function duplicateConnection(id: string): Promise<ConnectionConfig> {
  const db = getInternalDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!row) throw new Error(`Connection not found: ${id}`)
  const now = Date.now()
  const newId = randomUUID()
  db.prepare(
    `
    INSERT INTO connections (id, name, type, host, port, database_name, username, password_encrypted, ssl, file_path, group_name, tags, ssh_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    newId,
    row.name + ' (副本)',
    row.type,
    row.host,
    row.port,
    row.database_name,
    row.username,
    row.password_encrypted,
    row.ssl,
    row.file_path,
    row.group_name,
    row.tags,
    row.ssh_config,
    now,
    now
  )
  const newRow = db.prepare('SELECT * FROM connections WHERE id = ?').get(newId) as ConnectionRow
  return rowToConfig(newRow)
}

export async function exportConnections(): Promise<string> {
  const db = getInternalDb()
  const rows = db.prepare('SELECT * FROM connections ORDER BY name').all() as ConnectionRow[]
  const exportData = rows.map((row) => ({
    ...rowToConfig(row),
    _passwordHint: row.password_encrypted ? '(encrypted, not exported)' : null
  }))
  return JSON.stringify(exportData, null, 2)
}

export async function previewConnectionImport(content: string): Promise<ConnectionImportPreview> {
  return parseConnectionImport(content, await listConnections()).preview
}

export async function importConnections(
  content: string,
  selectedIndices?: number[]
): Promise<number> {
  // Save all selected connections atomically; never overwrite existing connections.
  return getInternalDb().transaction(() => {
    const { preview, forms } = parseConnectionImport(content, readConnections())
    const selected =
      selectedIndices ??
      preview.entries.filter((entry) => entry.status === 'ready').map((entry) => entry.index)
    if (
      !Array.isArray(selected) ||
      selected.length > 2000 ||
      selected.some((index) => !Number.isInteger(index) || index < 0 || index >= forms.length)
    )
      throw new Error('无效的连接选择')
    const entries = [...new Set(selected)].map((index) => preview.entries[index])
    if (entries.some((entry) => entry.status === 'unsupported' || entry.status === 'invalid'))
      throw new Error('选中的连接包含不支持或无效的配置，请重新预览')
    const ready = entries.filter((entry) => entry.status === 'ready')
    for (const entry of ready) insertConnection(forms[entry.index]!)
    return ready.length
  })()
}
