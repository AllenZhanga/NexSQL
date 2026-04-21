export interface RedisKeySummary {
  key: string
  type: string
  ttl: number
  size?: number
}

export interface RedisKeyDetail extends RedisKeySummary {
  value: unknown
}

export interface RedisKeyPage {
  items: RedisKeySummary[]
  nextCursor: string
  hasMore: boolean
  pageSize: number
}

export interface RedisKeyUpdateRequest {
  connectionId: string
  key: string
  database?: string
  type: string
  value: unknown
  ttl: number
}
