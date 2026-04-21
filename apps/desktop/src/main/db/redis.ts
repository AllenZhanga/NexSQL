import type { RedisKeyDetail, RedisKeyPage, RedisKeyUpdateRequest } from '@shared/types/redis'
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
