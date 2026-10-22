import { app, dialog, BrowserWindow } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const pending = new Map<string, Promise<boolean>>()

async function readKnownHosts(): Promise<Record<string, string>> {
  try {
    const data = JSON.parse(
      await readFile(join(app.getPath('userData'), 'ssh-known-hosts.json'), 'utf8')
    )
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid known hosts')
    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('无法读取 SSH 主机指纹记录，请检查本地配置文件')
  }
}

// Serialize trust-file updates across hosts so simultaneous first connections cannot
// discard another host's accepted fingerprint.
let saving: Promise<void> = Promise.resolve()
function saveFingerprint(endpoint: string, fingerprint: string): Promise<void> {
  const next = saving
    .catch(() => {})
    .then(async () => {
      const known = await readKnownHosts()
      if (known[endpoint] && known[endpoint] !== fingerprint)
        throw new Error('SSH 主机指纹已变化，连接已停止')
      const dir = app.getPath('userData')
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'ssh-known-hosts.json')
      const temp = `${file}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify({ ...known, [endpoint]: fingerprint }), { mode: 0o600 })
      await rename(temp, file)
    })
  saving = next
  return next
}

export async function verifySSHHostKey(
  host: string,
  port: number,
  key: Buffer,
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted) return false
  const endpoint = JSON.stringify([host.toLowerCase(), port])
  const fingerprint =
    'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  const previous = pending.get(endpoint)
  if (previous) await previous
  if (signal.aborted) return false
  const request = (async () => {
    const known = await readKnownHosts()
    if (known[endpoint]) {
      if (known[endpoint] !== fingerprint)
        throw new Error(
          'SSH 服务器主机指纹已变化，已停止连接。请先核实服务器身份，原信任记录不会自动覆盖。'
        )
      return true
    }
    if (signal.aborted) return false
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!parent) throw new Error('无法显示 SSH 主机指纹确认，请从主窗口连接')
    const result = await dialog.showMessageBox(parent, {
      type: 'question',
      title: '确认 SSH 服务器身份',
      message: `首次连接 SSH 服务器 ${host}:${port}`,
      detail: `服务器主机指纹：\n${fingerprint}\n\n请与服务器管理员核对后再信任。`,
      buttons: ['取消', '信任并连接'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal
    })
    if (result.response !== 1 || signal.aborted) return false
    await saveFingerprint(endpoint, fingerprint)
    return true
  })()
  pending.set(endpoint, request)
  try {
    return await request
  } finally {
    if (pending.get(endpoint) === request) pending.delete(endpoint)
  }
}
