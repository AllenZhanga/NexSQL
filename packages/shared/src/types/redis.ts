export interface RedisKeySummary {
  key: string
  type: string
  ttl: number
  size?: number
}

export interface RedisKeyDetail extends RedisKeySummary {
  value: unknown
}
