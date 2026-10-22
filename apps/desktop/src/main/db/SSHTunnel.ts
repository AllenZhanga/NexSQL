import { Client, utils, type ClientChannel } from 'ssh2'
import { createServer, type Socket } from 'node:net'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionConfig } from '@shared/types/connection'
import { validateSSHConfig, sshAuthMethod } from '@shared/ssh'
import { verifySSHHostKey } from './SSHHostKeys'

export interface PreparedConnection {
  config: ConnectionConfig
  close(): void
  getError(): Error | undefined
}

export async function prepareConnection(
  config: ConnectionConfig,
  signal: AbortSignal = new AbortController().signal
): Promise<PreparedConnection> {
  if (!config.ssh) return { config, close() {}, getError: () => undefined }
  if (config.type === 'sqlite') throw new Error('SQLite 文件连接不支持 SSH 隧道')
  const ssh = config.ssh
  validateSSHConfig(ssh)
  const port =
    config.port ?? { mysql: 3306, postgresql: 5432, mssql: 1433, redis: 6379 }[config.type]
  const targetHost = config.host?.trim() || 'localhost'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('数据库端口无效')
  const keyAuth = sshAuthMethod(ssh) === 'privateKey'
  let privateKey: Buffer | undefined
  if (keyAuth) {
    const keyPath = ssh.privateKeyPath!.trim()
    try {
      privateKey = await readFile(
        keyPath.startsWith('~/') ? join(homedir(), keyPath.slice(2)) : keyPath
      )
    } catch {
      throw new Error('无法读取 SSH 私钥文件，请检查路径和权限')
    }
    const key = utils.parseKey(privateKey, ssh.passphrase)
    if (key instanceof Error) throw new Error('无法解析 SSH 私钥，请检查私钥格式和私钥口令')
  }
  if (signal.aborted) throw new Error('SSH 连接已取消')
  return new Promise((resolve, reject) => {
    const client = new Client()
    const sockets = new Set<Socket>()
    const channels = new Set<ClientChannel>()
    let closed = false,
      settled = false,
      lastError: Error | undefined
    const server = createServer((socket) => {
      if (closed) {
        socket.destroy()
        return
      }
      sockets.add(socket)
      socket.on('error', () => {})
      socket.once('close', () => sockets.delete(socket))
      const timer = setTimeout(() => {
        lastError = new Error('SSH 端口转发超时，请检查跳板机是否能访问目标数据库')
        socket.destroy()
      }, 15000)
      socket.once('close', () => clearTimeout(timer))
      client.forwardOut('127.0.0.1', socket.remotePort ?? 0, targetHost, port, (error, channel) => {
        clearTimeout(timer)
        if (error) {
          lastError = new Error('SSH 端口转发失败：' + error.message)
          socket.destroy()
          return
        }
        if (closed || socket.destroyed) {
          channel.destroy()
          return
        }
        channels.add(channel)
        channel.on('error', () => socket.destroy())
        channel.once('close', () => {
          channels.delete(channel)
          socket.end()
        })
        socket.once('close', () => channel.destroy())
        socket.pipe(channel).pipe(socket)
      })
    })
    const close = () => {
      if (closed) return
      closed = true
      signal.removeEventListener('abort', onAbort)
      for (const socket of sockets) socket.destroy()
      for (const channel of channels) channel.destroy()
      server.close()
      client.destroy()
    }
    const fail = (error: Error) => {
      lastError ??= error
      close()
      if (!settled) {
        settled = true
        reject(lastError)
      }
    }
    const onAbort = () => fail(new Error('SSH 连接已取消'))
    signal.addEventListener('abort', onAbort, { once: true })
    client.on('error', (error) => fail(new Error('SSH 连接失败：' + error.message)))
    client.on('close', () => fail(new Error('SSH 连接已断开，请重新连接')))
    server.on('error', (error) => fail(new Error('无法启动本地 SSH 转发：' + error.message)))
    client.once('ready', () => {
      if (closed) return
      server.listen(0, '127.0.0.1', () => {
        if (closed) return
        const address = server.address()
        if (!address || typeof address === 'string') {
          fail(new Error('无法分配 SSH 本地端口'))
          return
        }
        settled = true
        resolve({
          config: {
            ...config,
            host: '127.0.0.1',
            port: address.port,
            tlsServerName: config.ssl || config.type === 'mssql' ? targetHost : undefined,
            ssh: undefined
          },
          close,
          getError: () => lastError
        })
      })
    })
    try {
      client.connect({
        host: ssh.host.trim(),
        port: ssh.port,
        username: ssh.username.trim(),
        ...(keyAuth
          ? { privateKey, passphrase: ssh.passphrase }
          : { password: ssh.password ?? '', tryKeyboard: true }),
        readyTimeout: 60000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, callback: (accepted: boolean) => void) => {
          void verifySSHHostKey(ssh.host.trim(), ssh.port, key, signal)
            .then((accepted) => {
              if (!accepted) lastError = new Error('未信任 SSH 服务器主机指纹，连接已取消')
              callback(accepted && !closed)
            })
            .catch((error) => {
              lastError = error
              callback(false)
            })
        }
      })
      client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
        if (!keyAuth && prompts.length === 1 && /password/i.test(prompts[0].prompt))
          finish([ssh.password ?? ''])
        else finish([])
      })
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
