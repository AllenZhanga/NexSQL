import type { RedisKeyDetail, RedisKeyPage, RedisKeyUpdateRequest } from '@shared/types/redis'
import { getDriver, getConnectionConfig } from './ConnectionManager'
import type { RedisDriver } from './drivers/redis'

function getRedisDriver(connectionId: string): RedisDriver {
  if (getConnectionConfig(connectionId).type !== 'redis') {
    throw new Error('Current connection is not Redis')
  }
  return getDriver(connectionId) as RedisDriver
}

export async function getRedisKeys(
  connectionId: string,
  pattern?: string,
  database?: string,
  cursor?: string,
  pageSize?: number
): Promise<RedisKeyPage> {
  return getRedisDriver(connectionId).getKeysPage(cursor, pattern, database, pageSize)
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

export async function updateRedisKey(request: RedisKeyUpdateRequest): Promise<RedisKeyDetail> {
  return getRedisDriver(request.connectionId).updateKey(
    request.key,
    request.type,
    request.value,
    request.ttl,
    request.database
  )
}
