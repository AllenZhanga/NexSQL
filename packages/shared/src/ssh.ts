import type { SSHConfig } from './types/connection'

export function sshAuthMethod(ssh: SSHConfig): 'password' | 'privateKey' {
  return ssh.authMethod ?? (ssh.privateKeyPath ? 'privateKey' : 'password')
}

export function validateSSHConfig(ssh: SSHConfig): void {
  if (!ssh.host?.trim() || !ssh.username?.trim()) throw new Error('请填写 SSH 主机和用户名')
  if (!Number.isInteger(ssh.port) || ssh.port < 1 || ssh.port > 65535)
    throw new Error('SSH 端口必须是 1–65535 的整数')
  if (ssh.authMethod && !['password', 'privateKey'].includes(ssh.authMethod))
    throw new Error('不支持的 SSH 认证方式')
  if (sshAuthMethod(ssh) === 'privateKey' && !ssh.privateKeyPath?.trim())
    throw new Error('请选择 SSH 私钥文件')
}
