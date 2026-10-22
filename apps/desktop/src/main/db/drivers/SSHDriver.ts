import type { ConnectionConfig } from '@shared/types/connection'
import type { IDbDriver } from '../types'
import { prepareConnection, type PreparedConnection } from '../SSHTunnel'

export function createSSHDriver(
  config: ConnectionConfig,
  createDirect: (config: ConnectionConfig) => IDbDriver
): IDbDriver {
  const controller = new AbortController()
  let closed = false
  let tunnel: PreparedConnection | undefined
  let delegate: IDbDriver | undefined
  let opening: Promise<IDbDriver> | undefined
  const getDriver = (): Promise<IDbDriver> => {
    if (closed) return Promise.reject(new Error('SSH 连接已关闭，请重新连接'))
    return (opening ??= prepareConnection(config, controller.signal).then((prepared) => {
      tunnel = prepared
      if (closed) {
        prepared.close()
        throw new Error('SSH 连接已取消')
      }
      try {
        return (delegate = createDirect(prepared.config))
      } catch (error) {
        prepared.close()
        throw error
      }
    }))
  }
  const disconnect = async (): Promise<void> => {
    closed = true
    controller.abort()
    tunnel?.close()
    try {
      await delegate?.disconnect()
    } catch {
      /* The forwarded sockets have already been closed. */
    }
  }
  return new Proxy({ disconnect } as IDbDriver, {
    get(target, property) {
      if (property === 'disconnect') return disconnect
      if (property === 'then') return undefined
      return async (...args: unknown[]) => {
        try {
          const driver = await getDriver()
          const method = driver[property as keyof IDbDriver] as (
            ...args: unknown[]
          ) => Promise<unknown>
          return await method.apply(driver, args)
        } catch (error) {
          throw closed ? error : (tunnel?.getError() ?? error)
        }
      }
    }
  })
}
