import { DOMParser } from '@xmldom/xmldom'
import { createDecipheriv } from 'node:crypto'
import { TextDecoder } from 'node:util'
import type { ConnectionConfig, ConnectionFormData, DBType } from '@shared/types/connection'
import { validateSSHConfig, sshAuthMethod } from '@shared/ssh'
import { CONNECTION_IMPORT_MAX_BYTES } from '@shared/types/connectionImport'
import type { ConnectionImportEntry, ConnectionImportPreview } from '@shared/types/connectionImport'

const ports: Record<DBType, number> = {
  mysql: 3306,
  postgresql: 5432,
  mssql: 1433,
  sqlite: 0,
  redis: 6379
}
const types: Record<string, DBType | undefined> = {
  MYSQL: 'mysql',
  MARIADB: 'mysql',
  PGSQL: 'postgresql',
  POSTGRESQL: 'postgresql',
  POSTGRES: 'postgresql',
  MSSQL: 'mssql',
  SQLSERVER: 'mssql',
  SQLITE: 'sqlite',
  REDIS: 'redis'
}
const enabled = (value: unknown): boolean => /^(true|1|yes)$/i.test(String(value ?? ''))

export function connectionIdentity(form: ConnectionFormData): string {
  if (form.type === 'sqlite') return JSON.stringify([form.name, form.type, form.filePath ?? ''])
  return JSON.stringify([
    form.name,
    form.type,
    form.host?.toLowerCase() ?? '',
    form.port ?? ports[form.type],
    form.database ?? '',
    form.username ?? '',
    form.filePath ?? '',
    !!form.ssl,
    form.ssh
      ? [
          form.ssh.host.trim().toLowerCase(),
          form.ssh.port,
          form.ssh.username,
          sshAuthMethod(form.ssh),
          sshAuthMethod(form.ssh) === 'privateKey' ? (form.ssh.privateKeyPath ?? '') : ''
        ]
      : null
  ])
}

// NCX AES format documented by HyperSine's original format analysis:
// https://github.com/HyperSine/how-does-navicat-encrypt-password/blob/master/doc/how-does-navicat-encrypt-password.md
function decodePassword(ciphertext: string): string {
  if (!/^(?:[0-9a-f]{32})+$/i.test(ciphertext)) throw new Error('Unsupported password encoding')
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from('libcckeylibcckey'),
    Buffer.from('libcciv libcciv ')
  )
  const bytes = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()])
  const password = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (password.includes('\0')) throw new Error('Unsupported password encoding')
  return password
}

interface NcxConnection {
  attributes: Record<string, string>
  ignoredDatabaseList: boolean
  ignoredRedisDefaults: boolean
  unsupportedChildren: string[]
  conflictingFields: boolean
}

const ncxFields = new Set([
  'ConnectionName',
  'ConnType',
  'Type',
  'AuthenticationMode',
  'SentinelMasterName',
  'Host',
  'Port',
  'Database',
  'UserName',
  'Password',
  'SavePassword',
  'DatabaseFileName',
  'GroupName',
  'Group',
  'ProjectUUID',
  'ServiceProvider',
  'SSH',
  'SSH_Host',
  'SSH_Port',
  'SSH_UserName',
  'SSH_AuthenMethod',
  'SSH_Password',
  'SSH_SavePassword',
  'SSH_PrivateKey',
  'SSH_Passphrase',
  'SSH_SavePassphrase',
  'HTTP',
  'NamedPipe',
  'SQLiteEncrypt',
  'MSSQLAuthenMode',
  'SSL',
  'SSL_Authen',
  'SSL_ClientKey',
  'SSL_ClientCert',
  'SSL_CACert',
  'SSL_PGSSLCRL',
  'SSL_PGSSLMode'
])
const ncxDatabaseLists = new Set(['Databases', 'Schemas', 'DatabaseList', 'SchemaList'])
const nestedSSHFields: Record<string, string> = {
  Enabled: 'SSH',
  Host: 'SSH_Host',
  Port: 'SSH_Port',
  UserName: 'SSH_UserName',
  AuthenMethod: 'SSH_AuthenMethod',
  Password: 'SSH_Password',
  SavePassword: 'SSH_SavePassword',
  PrivateKey: 'SSH_PrivateKey',
  Passphrase: 'SSH_Passphrase',
  SavePassphrase: 'SSH_SavePassphrase'
}

function readNcx(text: string): NcxConnection[] {
  // NCX has no DTD. Reject it before parsing, including external entities.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('连接文件不能包含 DTD 或自定义实体')
  let invalid = false
  let doc: ReturnType<DOMParser['parseFromString']>
  try {
    doc = new DOMParser({
      onError: () => {
        invalid = true
      }
    }).parseFromString(text, 'text/xml')
  } catch {
    throw new Error('Navicat 文件 XML 格式不正确')
  }
  if (invalid || doc.documentElement?.tagName !== 'Connections')
    throw new Error('请选择 Navicat 导出的 Connections .ncx 文件')
  const rows: NcxConnection[] = []
  for (let i = 0; i < doc.documentElement.childNodes.length; i++) {
    const node = doc.documentElement.childNodes.item(i)!
    if (node.nodeType !== 1) {
      if (node.nodeType === 3 && node.nodeValue?.trim())
        throw new Error('Navicat 文件包含无法识别的内容')
      continue
    }
    if (node.nodeName !== 'Connection')
      throw new Error('暂不支持此 Navicat 文件结构，请使用“文件 → 导出连接”生成 .ncx')
    const element = node as import('@xmldom/xmldom').Element
    const attrs: Record<string, string> = Object.create(null)
    for (let j = 0; j < element.attributes.length; j++) {
      const attr = element.attributes.item(j)!
      attrs[attr.name] = attr.value
    }
    const row: NcxConnection = {
      attributes: attrs,
      ignoredDatabaseList: false,
      ignoredRedisDefaults: false,
      unsupportedChildren: [],
      conflictingFields: false
    }
    const assign = (name: string, value: string) => {
      if (Object.hasOwn(attrs, name) && attrs[name] !== value) row.conflictingFields = true
      else attrs[name] = value
    }
    for (let j = 0; j < element.childNodes.length; j++) {
      const child = element.childNodes.item(j)!
      if (
        child.nodeType === 8 ||
        child.nodeType === 7 ||
        ((child.nodeType === 3 || child.nodeType === 4) && !child.nodeValue?.trim())
      )
        continue
      if (child.nodeType !== 1) {
        row.unsupportedChildren.push('非空文本内容')
        continue
      }
      const field = child as import('@xmldom/xmldom').Element
      if (attrs.ConnType?.trim().toUpperCase() === 'REDIS') {
        const leaf = Array.from(field.childNodes).every(
          (node) =>
            node.nodeType === 8 || ([3, 4].includes(node.nodeType) && !node.nodeValue?.trim())
        )
        // Navicat writes an unused Sentinel placeholder and a saved AddressList
        // profile for standalone Redis. Neither overrides the Connection endpoint.
        const emptySentinel =
          field.tagName === 'SentinelAddr' &&
          leaf &&
          Array.from(field.attributes).every((attr) => ['Host', 'Port'].includes(attr.name)) &&
          !field.getAttribute('Host')?.trim() &&
          ['', '0'].includes(field.getAttribute('Port')?.trim() ?? '')
        const addressProfile =
          field.tagName === 'Profile' && leaf && field.getAttribute('ProfileName') === 'AddressList'
        if (emptySentinel || addressProfile) {
          row.ignoredRedisDefaults = true
          continue
        }
      }
      if (
        field.tagName === 'SSH' &&
        (field.attributes.length ||
          Array.from(field.childNodes).some((node) => node.nodeType === 1))
      ) {
        for (const attr of Array.from(field.attributes)) {
          const name = nestedSSHFields[attr.name]
          if (name) assign(name, attr.value)
          else row.unsupportedChildren.push(`SSH.${attr.name}`)
        }
        for (const child of Array.from(field.childNodes)) {
          if (child.nodeType === 8 || (child.nodeType === 3 && !child.nodeValue?.trim())) continue
          const name = nestedSSHFields[child.nodeName]
          if (
            child.nodeType === 1 &&
            name &&
            !(child as import('@xmldom/xmldom').Element).attributes.length &&
            Array.from(child.childNodes).every((node) => [3, 4, 8].includes(node.nodeType))
          )
            assign(name, child.textContent ?? '')
          else row.unsupportedChildren.push(`SSH.${child.nodeName}`)
        }
        if (!Object.hasOwn(attrs, 'SSH')) assign('SSH', 'true')
        continue
      }
      if (ncxDatabaseLists.has(field.tagName)) {
        // A saved display list is not the connection's initial database.
        row.ignoredDatabaseList = true
        continue
      }
      if (
        ncxFields.has(field.tagName) &&
        !field.attributes.length &&
        Array.from(field.childNodes).every((node) => [3, 4, 8].includes(node.nodeType))
      ) {
        const value = field.textContent ?? ''
        assign(field.tagName, value)
        continue
      }
      // Unsupported per-connection settings must not block valid siblings or silently
      // downgrade a tunnel/certificate configuration to a direct connection.
      row.unsupportedChildren.push(field.tagName)
    }
    rows.push(row)
  }
  return rows
}

function validate(form: ConnectionFormData): void {
  if (!form.name?.trim()) throw new Error('连接名称不能为空')
  if (!Object.values(types).includes(form.type)) throw new Error('不支持的数据库类型')
  if (form.ssh) {
    if (form.type === 'sqlite') throw new Error('SQLite 文件连接不支持 SSH 隧道')
    validateSSHConfig(form.ssh)
  }
  if (form.type === 'sqlite') {
    if (!form.filePath?.trim()) throw new Error('SQLite 文件路径不能为空')
  } else {
    if (!form.host?.trim()) throw new Error('主机地址不能为空')
    if (!Number.isInteger(form.port) || form.port! < 1 || form.port! > 65535)
      throw new Error('端口必须是 1–65535 的整数')
    if (form.type === 'redis' && form.database && !/^\d+$/.test(form.database))
      throw new Error('Redis 数据库必须是非负整数')
  }
}

export function parseConnectionImport(
  content: string,
  existing: ConnectionConfig[] = []
): {
  preview: ConnectionImportPreview
  forms: Array<ConnectionFormData | undefined>
} {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content, 'utf8') > CONNECTION_IMPORT_MAX_BYTES
  )
    throw new Error('连接文件不能超过 5 MB')
  const text = content.replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('连接文件为空')
  const navicat = text.startsWith('<')
  let rows: unknown[]
  try {
    rows = navicat ? readNcx(text) : JSON.parse(text)
  } catch (error) {
    if (navicat) throw error
    throw new Error('请选择 NexSQL JSON 或 Navicat .ncx 连接文件')
  }
  if (!Array.isArray(rows)) throw new Error('NexSQL 连接文件必须是 JSON 数组')
  if (!rows.length) throw new Error('文件中没有连接')
  if (rows.length > 2000) throw new Error('每次最多导入 2000 个连接')
  const seen = new Set(existing.map(connectionIdentity))
  const forms: Array<ConnectionFormData | undefined> = []
  const entries = rows.map((raw, index): ConnectionImportEntry => {
    const ncx = navicat ? (raw as NcxConnection) : undefined
    const row = ncx
      ? ncx.attributes
      : raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {}
    const value = (key: string): string =>
      typeof row[key] === 'string' ? (row[key] as string) : ''
    const sourceType = (navicat ? value('ConnType') : value('type')).trim().toUpperCase()
    const type = types[sourceType]
    const entry: ConnectionImportEntry = {
      index,
      name: navicat ? value('ConnectionName') : value('name'),
      sourceType,
      type,
      address: '',
      database: '',
      username: '',
      group: '',
      status: 'ready',
      passwordStatus: type === 'sqlite' ? 'not-needed' : 'missing',
      warnings: []
    }
    forms.push(undefined)
    if (ncx?.ignoredDatabaseList)
      entry.warnings.push('未迁移 Navicat 的数据库 / Schema 显示列表，连接后可选择数据库')
    if (!type) {
      entry.status = 'unsupported'
      entry.warnings.push(`暂不支持 ${sourceType || '未知'} 数据库`)
      return entry
    }
    const form: ConnectionFormData = navicat
      ? {
          name: entry.name,
          type,
          host: value('Host').trim(),
          port: value('Port') ? Number(value('Port')) : ports[type],
          database: value('Database'),
          username: value('UserName'),
          ssl: enabled(row.SSL),
          filePath: value('DatabaseFileName'),
          group: value('GroupName') || value('Group')
        }
      : {
          name: entry.name,
          type,
          host: value('host').trim() || (type !== 'sqlite' ? 'localhost' : ''),
          port: row.port === undefined ? ports[type] : Number(row.port),
          database: value('database'),
          username: value('username'),
          ssl: row.ssl === true,
          filePath: value('filePath'),
          group: value('group'),
          tags: Array.isArray(row.tags)
            ? row.tags.filter((tag): tag is string => typeof tag === 'string')
            : undefined
        }
    entry.address = type === 'sqlite' ? form.filePath! : `${form.host}:${form.port}`
    entry.database = form.database ?? ''
    entry.username = form.username ?? ''
    entry.group = form.group ?? ''
    if (ncx?.conflictingFields) {
      entry.status = 'invalid'
      entry.warnings.push('同一连接的属性与子字段存在冲突，请检查导出配置；其他连接可继续导入')
      return entry
    }
    if (navicat && type === 'redis') {
      const topology = value('Type').trim().toLowerCase()
      if ((topology && topology !== 'standalone') || value('SentinelMasterName').trim()) {
        entry.status = 'unsupported'
        entry.warnings.push(
          '当前仅支持 Redis 单机连接，暂不支持 Sentinel / Cluster 拓扑；其他连接可继续导入'
        )
        return entry
      }
      const auth = value('AuthenticationMode').trim().toLowerCase()
      if (auth && !['password', 'none'].includes(auth)) {
        entry.status = 'unsupported'
        entry.warnings.push('暂不支持此 Redis 认证方式，其他连接可继续导入')
        return entry
      }
      // Password mode uses AUTH password, not the inactive default username
      // Navicat also exports. This matters for Aliyun's account:password handling.
      if (auth === 'password' || auth === 'none') form.username = entry.username = ''
      if (auth === 'none') entry.passwordStatus = 'not-needed'
      if (ncx?.ignoredRedisDefaults)
        entry.warnings.push('已忽略空 Sentinel 地址和 AddressList 保存配置，使用主连接地址')
    }
    if (ncx?.unsupportedChildren.length) {
      entry.status = 'unsupported'
      const tags = [...new Set(ncx.unsupportedChildren)].slice(0, 8).join('、')
      entry.warnings.push(`此连接含未适配的子配置：${tags}；已跳过此连接，其他连接可继续导入`)
      return entry
    }
    const unsupported: string[] = []
    if (navicat) {
      if (enabled(row.SSH)) {
        const method = value('SSH_AuthenMethod')
          .toUpperCase()
          .replace(/[\s_-]/g, '')
        const keyAuth = method
          ? ['PUBLICKEY', 'PRIVATEKEY', 'KEY', 'KEYFILE'].includes(method)
          : !!value('SSH_PrivateKey')
        if (method && !keyAuth && method !== 'PASSWORD') unsupported.push('该 SSH 认证方式')
        form.ssh = {
          host: value('SSH_Host').trim(),
          port: value('SSH_Port') ? Number(value('SSH_Port')) : 22,
          username: value('SSH_UserName'),
          authMethod: keyAuth ? 'privateKey' : 'password',
          privateKeyPath: keyAuth ? value('SSH_PrivateKey') : undefined
        }
        const field = keyAuth ? 'SSH_Passphrase' : 'SSH_Password'
        const saveFlag = keyAuth ? 'SSH_SavePassphrase' : 'SSH_SavePassword'
        let credentialStatus: NonNullable<ConnectionImportEntry['ssh']>['credentialStatus'] =
          keyAuth ? 'not-needed' : 'missing'
        if (value(field) && !/^(false|0|no)$/i.test(value(saveFlag))) {
          try {
            form.ssh[keyAuth ? 'passphrase' : 'password'] = decodePassword(value(field))
            credentialStatus = 'included'
          } catch {
            credentialStatus = 'unavailable'
            entry.warnings.push('SSH 密码或私钥口令无法转换，导入后请重新填写')
          }
        } else if (!keyAuth) entry.warnings.push('文件未包含 SSH 密码，导入后请填写')
        if (keyAuth)
          entry.warnings.push('请确认 SSH 私钥文件路径在当前电脑有效；文件本身不会从导出文件中复制')
        entry.ssh = {
          host: form.ssh.host,
          port: form.ssh.port,
          username: form.ssh.username,
          authMethod: keyAuth ? 'privateKey' : 'password',
          credentialStatus
        }
      }
      if (enabled(row.HTTP)) unsupported.push('HTTP 隧道')
      if (enabled(row.NamedPipe)) unsupported.push('命名管道或 Socket')
      if (enabled(row.SQLiteEncrypt)) unsupported.push('SQLite 加密')
      if (
        type === 'mssql' &&
        value('MSSQLAuthenMode') &&
        !/^(sql(server)?|sql_server|password|0)$/i.test(value('MSSQLAuthenMode'))
      )
        unsupported.push('SQL Server Windows 身份认证')
      if (
        form.ssl &&
        (enabled(row.SSL_Authen) ||
          ['SSL_ClientKey', 'SSL_ClientCert', 'SSL_CACert', 'SSL_PGSSLCRL'].some((key) =>
            value(key)
          ) ||
          /^VERIFY/i.test(value('SSL_PGSSLMode')))
      )
        unsupported.push('SSL 客户端证书或严格证书验证')
      if (value('ServiceProvider') && !/^default$/i.test(value('ServiceProvider')))
        unsupported.push('自定义服务提供商')
      if (type === 'sqlite') entry.warnings.push('请确认 SQLite 文件路径在当前电脑有效')
      if (form.ssl) entry.warnings.push('仅迁移 SSL 开关，证书验证行为以 NexSQL 当前连接实现为准')
      if (value('ProjectUUID') && !form.group)
        entry.warnings.push('文件仅含项目标识，无法恢复项目名称')
      const encrypted = value('Password')
      if (
        entry.passwordStatus !== 'not-needed' &&
        encrypted &&
        !/^(false|0|no)$/i.test(value('SavePassword'))
      ) {
        try {
          form.password = decodePassword(encrypted)
          entry.passwordStatus = 'included'
        } catch {
          entry.passwordStatus = 'unavailable'
          entry.warnings.push('密码格式无法转换（含旧版格式），导入后请重新填写密码')
        }
      }
    } else if (row.ssh && typeof row.ssh === 'object' && !Array.isArray(row.ssh)) {
      const ssh = row.ssh as Record<string, unknown>
      form.ssh = {
        host: typeof ssh.host === 'string' ? ssh.host : '',
        port: ssh.port === undefined ? 22 : Number(ssh.port),
        username: typeof ssh.username === 'string' ? ssh.username : '',
        privateKeyPath: typeof ssh.privateKeyPath === 'string' ? ssh.privateKeyPath : undefined,
        authMethod: ssh.authMethod as 'password' | 'privateKey' | undefined,
        password: typeof ssh.password === 'string' ? ssh.password : undefined,
        passphrase: typeof ssh.passphrase === 'string' ? ssh.passphrase : undefined
      }
      const method = sshAuthMethod(form.ssh)
      const included = !!form.ssh[method === 'password' ? 'password' : 'passphrase']
      entry.ssh = {
        host: form.ssh.host,
        port: form.ssh.port,
        username: form.ssh.username,
        authMethod: method,
        credentialStatus: included ? 'included' : method === 'password' ? 'missing' : 'not-needed'
      }
      if (!included && (ssh.hasPassword || ssh.hasPassphrase || method === 'password'))
        entry.warnings.push('JSON 未包含 SSH 凭据，导入后请重新填写')
      if (method === 'privateKey') entry.warnings.push('请确认 SSH 私钥文件路径在当前电脑有效')
    } else if (row.ssh) unsupported.push('无法识别的 SSH 配置')
    if (unsupported.length) {
      entry.status = 'unsupported'
      entry.warnings.push(`当前不支持：${unsupported.join('、')}，请改用直接连接配置后导入`)
      return entry
    }
    try {
      validate(form)
    } catch (error) {
      entry.status = 'invalid'
      entry.warnings.push((error as Error).message)
      return entry
    }
    if (seen.has(connectionIdentity(form))) {
      entry.status = 'duplicate'
      entry.warnings.push('相同名称及配置的连接已存在，自动跳过')
    } else seen.add(connectionIdentity(form))
    if (entry.passwordStatus === 'missing')
      entry.warnings.push('文件未包含密码，需要时请在连接设置中补填')
    forms[index] = form
    return entry
  })
  return { preview: { format: navicat ? 'navicat' : 'nexsql', entries }, forms }
}
