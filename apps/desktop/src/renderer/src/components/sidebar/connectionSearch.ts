import type { ConnectionConfig } from '@shared/types/connection'

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase()

export function matchingConnections(
  connections: ConnectionConfig[],
  search: string
): ConnectionConfig[] {
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return connections
  return connections.filter((connection) => {
    const text = normalize(
      [
        connection.name,
        connection.host,
        connection.port,
        connection.group,
        ...(connection.tags ?? []),
        connection.filePath
      ]
        .filter((value) => value !== undefined)
        .join(' ')
    )
    return terms.every((term) => text.includes(term))
  })
}

export function connectionAddress(connection: ConnectionConfig): string {
  if (connection.type === 'sqlite') return connection.filePath ?? ''
  const port =
    connection.port ?? { mysql: 3306, postgresql: 5432, mssql: 1433, redis: 6379 }[connection.type]
  const host = connection.host ?? 'localhost'
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}
