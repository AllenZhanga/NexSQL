import type { ConnectionConfig } from '@shared/types/connection'
import type { IDbDriver } from '../types'
import { MySQLDriver } from './mysql'
import { PostgresDriver } from './postgres'
import { MSSQLDriver } from './mssql'
import { SQLiteDriver } from './sqlite'
import { RedisDriver } from './redis'
import { createSSHDriver } from './SSHDriver'

export function createDriver(config: ConnectionConfig, password: string): IDbDriver {
  if (config.ssh) {
    return createSSHDriver(config, direct => createDriver(direct, password))
  }

  switch (config.type) {
    case 'mysql':
      return new MySQLDriver({
        host: config.host ?? 'localhost',
        port: config.port ?? 3306,
        database: config.database ?? '',
        user: config.username ?? '',
        password,
        ssl: config.ssl,
        tlsServerName: config.tlsServerName
      })

    case 'postgresql':
      return new PostgresDriver({
        host: config.host ?? 'localhost',
        port: config.port ?? 5432,
        database: config.database ?? '',
        user: config.username ?? '',
        password,
        ssl: config.ssl,
        tlsServerName: config.tlsServerName
      })

    case 'mssql':
      return new MSSQLDriver({
        host: config.host ?? 'localhost',
        port: config.port ?? 1433,
        database: config.database ?? '',
        user: config.username ?? '',
        password,
        ssl: config.ssl,
        tlsServerName: config.tlsServerName
      })

    case 'sqlite':
      return new SQLiteDriver({
        filePath: config.filePath ?? ':memory:'
      })

    case 'redis':
      return new RedisDriver({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        database: config.database ?? '0',
        user: config.username ?? '',
        password,
        ssl: config.ssl,
        tlsServerName: config.tlsServerName
      })

    default:
      throw new Error(`Unsupported database type: ${config.type}`)
  }
}

export { MySQLDriver, PostgresDriver, MSSQLDriver, SQLiteDriver, RedisDriver }
