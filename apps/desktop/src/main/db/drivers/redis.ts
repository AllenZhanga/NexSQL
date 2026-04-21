import { createClient, type RedisClientType } from 'redis'
import type { DriverColumnInfo, DriverIndexInfo, DriverResult, DriverTableInfo, IDbDriver } from '../types'
import type { RedisKeyDetail, RedisKeySummary } from '@shared/types/redis'

interface RedisConfig {
  host: string
  port: number
  database?: string
  user?: string
  password?: string
  ssl?: boolean
}

const PREVIEW_LIMIT = 100

export class RedisDriver implements IDbDriver {
  private client: RedisClientType
  private connected = false
  private currentDatabase: string

  constructor(private readonly config: RedisConfig) {
    this.currentDatabase = normalizeDatabase(config.database)
    this.client = createClient({
      socket: {
        host: config.host,
        port: config.port,
        tls: config.ssl
      },
      database: Number(this.currentDatabase),
      username: config.user || undefined,
      password: config.password || undefined
    })
    this.client.on('error', () => {})
  }

  async testConnection(): Promise<void> {
    await this.ensureConnected()
    await this.client.ping()
  }

  async execute(command: string): Promise<DriverResult> {
    await this.ensureConnected()
    const args = parseRedisCommand(command)
    if (args.length === 0) {
      return { columns: [], rows: [], rowCount: 0 }
    }
    const reply = await this.client.sendCommand(args)
    return normalizeReply(reply)
  }

  async getDatabases(): Promise<string[]> {
    await this.ensureConnected()
    const info = await this.client.sendCommand(['INFO', 'keyspace'])
    const discovered = new Set<string>()
    const text = typeof info === 'string' ? info : ''
    for (const match of text.matchAll(/db(\d+):/g)) {
      discovered.add(match[1])
    }
    discovered.add(this.currentDatabase)
    if (discovered.size === 0) discovered.add('0')
    return Array.from(discovered).sort((a, b) => Number(a) - Number(b))
  }

  async getTables(_database?: string): Promise<DriverTableInfo[]> {
    return []
  }

  async getColumns(_table: string, _database?: string): Promise<DriverColumnInfo[]> {
    return []
  }

  async getIndexes(_table: string, _database?: string): Promise<DriverIndexInfo[]> {
    return []
  }

  async getTableDDL(_table: string, _database?: string): Promise<string> {
    throw new Error('Redis 不支持表结构 DDL')
  }

  async useDatabase(database: string): Promise<void> {
    await this.selectDatabase(database)
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return
    await this.client.quit()
    this.connected = false
  }

  async getKeys(pattern = '*', database?: string): Promise<RedisKeySummary[]> {
    await this.selectDatabase(database)
    const keys = await this.scanKeys(pattern)
    const summaries = await Promise.all(keys.map(async (key) => this.buildKeySummary(key)))
    return summaries.sort((a, b) => a.key.localeCompare(b.key))
  }

  async inspectKey(key: string, database?: string): Promise<RedisKeyDetail> {
    await this.selectDatabase(database)
    const summary = await this.buildKeySummary(key)
    const type = summary.type
    let value: unknown = null

    switch (type) {
      case 'string':
        value = await this.client.get(key)
        break
      case 'list':
        value = await this.client.lRange(key, 0, PREVIEW_LIMIT - 1)
        break
      case 'set':
        value = (await this.client.sMembers(key)).slice(0, PREVIEW_LIMIT)
        break
      case 'zset': {
        const raw = await this.client.sendCommand(['ZRANGE', key, '0', String(PREVIEW_LIMIT - 1), 'WITHSCORES'])
        value = normalizeZSetReply(raw)
        break
      }
      case 'hash':
        value = await this.client.hGetAll(key)
        break
      case 'stream': {
        const raw = await this.client.sendCommand(['XRANGE', key, '-', '+', 'COUNT', String(PREVIEW_LIMIT)])
        value = raw
        break
      }
      default:
        value = await this.client.sendCommand(['DUMP', key])
        break
    }

    return {
      ...summary,
      value
    }
  }

  async deleteKey(key: string, database?: string): Promise<number> {
    await this.selectDatabase(database)
    return this.client.del(key)
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return
    await this.client.connect()
    this.connected = true
    if (this.currentDatabase !== '0') {
      await this.client.sendCommand(['SELECT', this.currentDatabase])
    }
  }

  private async selectDatabase(database?: string): Promise<void> {
    await this.ensureConnected()
    const nextDatabase = normalizeDatabase(database ?? this.currentDatabase)
    if (nextDatabase === this.currentDatabase) return
    await this.client.sendCommand(['SELECT', nextDatabase])
    this.currentDatabase = nextDatabase
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    let cursor = '0'
    const collected: string[] = []

    do {
      const reply = await this.client.sendCommand(['SCAN', cursor, 'MATCH', pattern || '*', 'COUNT', '200'])
      const [nextCursor, keys] = Array.isArray(reply) ? reply : ['0', []]
      cursor = String(nextCursor ?? '0')
      if (Array.isArray(keys)) {
        for (const key of keys) {
          collected.push(String(key))
        }
      }
    } while (cursor !== '0')

    return collected
  }

  private async buildKeySummary(key: string): Promise<RedisKeySummary> {
    const [type, ttl, size] = await Promise.all([
      this.client.type(key),
      this.client.ttl(key),
      this.safeMemoryUsage(key)
    ])

    return {
      key,
      type,
      ttl,
      size
    }
  }

  private async safeMemoryUsage(key: string): Promise<number | undefined> {
    try {
      const value = await this.client.sendCommand(['MEMORY', 'USAGE', key])
      return value == null ? undefined : Number(value)
    } catch {
      return undefined
    }
  }
}

function normalizeDatabase(database?: string): string {
  const trimmed = database?.trim()
  if (!trimmed) return '0'
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : '0'
}

function parseRedisCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false

  for (const char of command.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote === 'single') {
      if (char === "'") {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'") {
      quote = 'single'
      continue
    }

    if (char === '"') {
      quote = 'double'
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) tokens.push(current)
  return tokens
}

function normalizeReply(reply: unknown): DriverResult {
  if (Array.isArray(reply)) {
    if (reply.length === 0) {
      return { columns: [], rows: [], rowCount: 0 }
    }

    if (reply.every((item) => !Array.isArray(item) && !isPlainObject(item))) {
      return {
        columns: [{ name: 'value', type: 'text' }],
        rows: reply.map((value) => ({ value: formatScalar(value) })),
        rowCount: reply.length
      }
    }

    if (reply.every((item) => isPlainObject(item))) {
      const columnNames = Array.from(new Set(reply.flatMap((item) => Object.keys(item as Record<string, unknown>))))
      return {
        columns: columnNames.map((name) => ({ name, type: 'text' })),
        rows: reply.map((item) => normalizeObject(item as Record<string, unknown>)),
        rowCount: reply.length
      }
    }

    const rows = reply.map((item, index) => {
      if (Array.isArray(item)) {
        return Object.fromEntries(item.map((value, columnIndex) => [`col_${columnIndex + 1}`, formatScalar(value)]))
      }
      return { index, value: formatScalar(item) }
    })
    const firstRow = rows[0] ?? {}
    return {
      columns: Object.keys(firstRow).map((name) => ({ name, type: 'text' })),
      rows,
      rowCount: rows.length
    }
  }

  if (isPlainObject(reply)) {
    const row = normalizeObject(reply)
    return {
      columns: Object.keys(row).map((name) => ({ name, type: 'text' })),
      rows: [row],
      rowCount: 1
    }
  }

  if (reply == null) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  return {
    columns: [{ name: 'value', type: 'text' }],
    rows: [{ value: formatScalar(reply) }],
    rowCount: 1
  }
}

function normalizeObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, formatScalar(item)]))
}

function formatScalar(value: unknown): unknown {
  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value)
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64')
  }
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeZSetReply(reply: unknown): Array<{ member: string; score: string }> {
  if (!Array.isArray(reply)) return []
  const rows: Array<{ member: string; score: string }> = []
  for (let index = 0; index < reply.length; index += 2) {
    rows.push({
      member: String(reply[index] ?? ''),
      score: String(reply[index + 1] ?? '')
    })
  }
  return rows
}
