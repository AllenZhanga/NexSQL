import type { RedisKeyDetail, RedisKeySummary } from '@shared/types/redis'
import { getDriver } from './ConnectionManager'
import { RedisDriver } from './drivers/redis'

function getRedisDriver(connectionId: string): RedisDriver {
  const driver = getDriver(connectionId)
  if (!(driver instanceof RedisDriver)) {
    throw new Error('Current connection is not Redis')
  }
  return driver
}

export async function getRedisKeys(
  connectionId: string,
  pattern?: string,
  database?: string
): Promise<RedisKeySummary[]> {
  return getRedisDriver(connectionId).getKeys(pattern, database)
}

export async function getRedisKeyDetail(
  connectionId: string,
  key: string,
  database?: string
): Promise<RedisKeyDetail> {
  return getRedisDriver(connectionId).inspectKey(key, database)
}

export async function deleteRedisKey(
  connectionId: string,
  key: string,
  database?: string
): Promise<number> {
  return getRedisDriver(connectionId).deleteKey(key, database)
}
