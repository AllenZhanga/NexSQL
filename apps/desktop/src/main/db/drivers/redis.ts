import { createClient, type RedisClientType } from 'redis'
import type { DriverColumnInfo, DriverIndexInfo, DriverResult, DriverTableInfo, IDbDriver } from '../types'
import type { RedisKeyDetail, RedisKeyPage, RedisKeySummary } from '@shared/types/redis'

interface RedisConfig {
  host: string
  port: number
  database?: string
  user?: string
  password?: string
  ssl?: boolean
}

const PREVIEW_LIMIT = 100
const REDIS_CONNECT_TIMEOUT_MS = 8000
const REDIS_KEY_PAGE_SIZE = 100

export class RedisDriver implements IDbDriver {
  private client: RedisClientType
  private connected = false
  private currentDatabase: string

  constructor(private readonly config: RedisConfig) {
    this.currentDatabase = normalizeDatabase(config.database)
    const auth = resolveRedisAuth(config)
    this.client = createClient({
      socket: {
        host: config.host,
        port: config.port,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
        ...(config.ssl ? { tls: true as const } : {})
      },
      database: Number(this.currentDatabase),
      username: auth.username,
      password: auth.password
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
    throw new Error('Redis does not support table DDL')
  }

  async useDatabase(database: string): Promise<void> {
    await this.selectDatabase(database)
  }

  async disconnect(): Promise<void> {
    try {
      if (this.connected) {
        await this.client.quit()
      } else {
        this.client.destroy()
      }
    } finally {
      this.connected = false
    }
  }

  async getKeys(pattern = '*', database?: string): Promise<RedisKeySummary[]> {
    await this.selectDatabase(database)
    const keys = await this.scanKeys(pattern)
    const summaries: RedisKeySummary[] = await Promise.all(keys.map(async (key) => this.buildKeySummary(key)))
    return summaries.sort((a, b) => a.key.localeCompare(b.key))
  }

  async getKeysPage(cursor = '0', pattern = '*', database?: string, pageSize = REDIS_KEY_PAGE_SIZE): Promise<RedisKeyPage> {
    await this.selectDatabase(database)
    const normalizedCursor = cursor.trim() || '0'
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : REDIS_KEY_PAGE_SIZE
    const page = await this.scanKeysPage(normalizedCursor, pattern, normalizedPageSize)
    const items: RedisKeySummary[] = await Promise.all(page.keys.map(async (key) => this.buildKeySummary(key)))

    return {
      items: items.sort((a, b) => a.key.localeCompare(b.key)),
      nextCursor: page.nextCursor,
      hasMore: page.nextCursor !== '0',
      pageSize: normalizedPageSize
    }
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

  async updateKey(key: string, type: string, value: unknown, ttl: number, database?: string): Promise<RedisKeyDetail> {
    await this.selectDatabase(database)

    switch (type) {
      case 'string':
        await this.client.set(key, normalizeRedisInputScalar(value))
        break
      case 'list': {
        const items = normalizeRedisArrayValue(value, 'List')
        if (items.length === 0) throw new Error('List 至少需要 1 个元素。')
        await this.client.del(key)
        await this.client.sendCommand(['RPUSH', key, ...items])
        break
      }
      case 'set': {
        const items = normalizeRedisArrayValue(value, 'Set')
        if (items.length === 0) throw new Error('Set 至少需要 1 个成员。')
        await this.client.del(key)
        await this.client.sendCommand(['SADD', key, ...items])
        break
      }
      case 'hash': {
        const entries = normalizeRedisHashValue(value)
        if (entries.length === 0) throw new Error('Hash 至少需要 1 个字段。')
        await this.client.del(key)
        await this.client.sendCommand(['HSET', key, ...entries.flatMap(([field, item]) => [field, item])])
        break
      }
      case 'zset': {
        const entries = normalizeRedisZSetValue(value)
        if (entries.length === 0) throw new Error('ZSet 至少需要 1 个成员。')
        await this.client.del(key)
        await this.client.sendCommand(['ZADD', key, ...entries.flatMap((entry) => [String(entry.score), entry.member])])
        break
      }
      case 'stream':
        throw new Error('暂不支持直接编辑 Stream 类型的 value。')
      default:
        throw new Error(`暂不支持编辑 ${type} 类型的 value。`)
    }

    await this.applyTTL(key, ttl)
    return this.inspectKey(key, database)
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

  private async scanKeysPage(cursor: string, pattern: string, pageSize: number): Promise<{ nextCursor: string; keys: string[] }> {
    const reply = await this.client.sendCommand(['SCAN', cursor, 'MATCH', pattern || '*', 'COUNT', String(pageSize)])
    const [nextCursor, keys] = Array.isArray(reply) ? reply : ['0', []]

    return {
      nextCursor: String(nextCursor ?? '0'),
      keys: Array.isArray(keys) ? keys.map((key) => String(key)) : []
    }
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

  private async applyTTL(key: string, ttl: number): Promise<void> {
    const exists = await this.client.exists(key)
    if (!exists) return
    if (ttl < 0) {
      await this.client.persist(key)
      return
    }
    await this.client.expire(key, ttl)
  }
}

function normalizeDatabase(database?: string): string {
  const trimmed = database?.trim()
  if (!trimmed) return '0'
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : '0'
}

function resolveRedisAuth(config: RedisConfig): { username?: string; password?: string } {
  const host = config.host.trim().toLowerCase()
  const username = config.user?.trim()
  const password = config.password?.trim()

  if (!password) {
    return {
      username: username || undefined,
      password: undefined
    }
  }

  // Aliyun Redis 5.x account mode commonly expects AUTH with `account:password`
  // rather than separate ACL username/password fields.
  if (host.endsWith('.aliyuncs.com') && username) {
    return {
      username: undefined,
      password: `${username}:${password}`
    }
  }

  return {
    username: username || undefined,
    password
  }
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

function normalizeRedisInputScalar(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return JSON.stringify(value)
}

function normalizeRedisArrayValue(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} value 必须是 JSON 数组。`)
  }
  return value.map((item) => normalizeRedisInputScalar(item))
}

function normalizeRedisHashValue(value: unknown): Array<[string, string]> {
  if (!isPlainObject(value)) {
    throw new Error('Hash value 必须是 JSON 对象。')
  }
  return Object.entries(value).map(([field, item]) => [field, normalizeRedisInputScalar(item)])
}

function normalizeRedisZSetValue(value: unknown): Array<{ member: string; score: number }> {
  if (!Array.isArray(value)) {
    throw new Error('ZSet value 必须是 JSON 数组。')
  }

  return value.map((item) => {
    if (!isPlainObject(item)) {
      throw new Error('ZSet 数组元素必须是包含 member 和 score 的对象。')
    }
    const member = normalizeRedisInputScalar(item.member)
    const score = Number(item.score)
    if (!Number.isFinite(score)) {
      throw new Error(`ZSet 成员 ${member || '(empty)'} 的 score 必须是数字。`)
    }
    return { member, score }
  })
}
