const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { createCipheriv } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file, overrides = {}) {
  const m = new Module(file, module)
  m.filename = file
  m.paths = module.paths
  m.require = (name) => overrides[name] ?? require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    file
  )
  return m.exports
}
const importer = load(path.join(root, 'src/main/db/ConnectionImport.ts'), {
  '@shared/ssh': load(path.join(root, '../../packages/shared/src/ssh.ts')),
  '@shared/types/connectionImport': load(
    path.join(root, '../../packages/shared/src/types/connectionImport.ts')
  )
})
const parse = importer.parseConnectionImport
function encrypted(password) {
  const cipher = createCipheriv(
    'aes-128-cbc',
    Buffer.from('libcckeylibcckey'),
    Buffer.from('libcciv libcciv ')
  )
  return Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]).toString('hex')
}
const connection = (extra = '') =>
  `<Connection ConnectionName="生产 &amp; 测试" ConnType="MYSQL" Host="db.example.test" Port="3307" UserName="reader" Database="app" ${extra}/>`
const ncx = (...rows) =>
  `<?xml version="1.0" encoding="UTF-8"?><Connections Ver="1.4">${rows.join('')}</Connections>`

if (process.argv.includes('--storage-child')) {
  ;(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexsql-import-'))
    try {
      const Database = require('better-sqlite3')
      const connectionAttempts = []
      let deferConnection = false,
        releaseConnection
      const overrides = {
        '@shared/ssh': load(path.join(root, '../../packages/shared/src/ssh.ts')),
        electron: {
          app: { getPath: () => temp },
          safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (value) => Buffer.from('os-encrypted:' + value),
            decryptString: (value) => value.toString().slice('os-encrypted:'.length)
          }
        },
        'better-sqlite3': { default: Database },
        './drivers': {
          createDriver: (config) => {
            connectionAttempts.push(config)
            return {
              testConnection: () =>
                deferConnection
                  ? new Promise((resolve) => {
                      releaseConnection = resolve
                    })
                  : Promise.resolve(),
              disconnect: async () => {
                releaseConnection?.()
              }
            }
          }
        },
        './ConnectionImport': importer
      }
      const manager = load(path.join(root, 'src/main/db/ConnectionManager.ts'), overrides)
      const content = ncx(
        connection(`Password="${encrypted('secret-value')}" SavePassword="true"`).replace(
          '/>',
          '><Databases><Database Name="display_only"/></Databases></Connection>'
        ),
        '<Connection ConnectionName="second" ConnType="PGSQL" Host="pg.example.test" Port="5432"/>'
      )
      const preview = await manager.previewConnectionImport(content)
      assert.equal((await manager.listConnections()).length, 0, 'Preview must not write')
      assert.doesNotMatch(JSON.stringify(preview), /secret-value|os-encrypted/)
      assert.equal(await manager.importConnections(content, [0]), 1)
      let saved = await manager.listConnections()
      assert.equal(saved.length, 1)
      assert.equal(manager.getConnectionPassword(saved[0].id), 'secret-value')
      const db = new Database(path.join(temp, 'nexsql.db'))
      assert.equal(
        db
          .prepare('SELECT password_encrypted FROM connections')
          .get()
          .password_encrypted.toString(),
        'os-encrypted:secret-value'
      )
      assert.equal(
        await manager.importConnections(content, [0]),
        0,
        'Repeated import must skip existing connection'
      )
      const rollback = JSON.stringify([
        { name: 'before-failure', type: 'mysql', host: 'a' },
        { name: 'reject-me', type: 'mysql', host: 'b' }
      ])
      db.exec(
        "CREATE TRIGGER fail_import BEFORE INSERT ON connections WHEN NEW.name='reject-me' BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
      )
      await assert.rejects(manager.importConnections(rollback), /forced failure/)
      saved = await manager.listConnections()
      assert.equal(saved.length, 1, 'A failed batch must roll back its earlier inserts')
      assert.equal(saved[0].name, '生产 & 测试')
      await assert.rejects(manager.importConnections(content, [999]), /无效的连接选择/)
      assert.equal(await manager.importConnections(content, [1, 1]), 1)
      assert.equal((await manager.listConnections()).length, 2)
      const concurrent = JSON.stringify([{ name: 'concurrent', type: 'mysql', host: 'localhost' }])
      assert.deepEqual(
        await Promise.all([
          manager.importConnections(concurrent),
          manager.importConnections(concurrent)
        ]),
        [1, 0]
      )
      const sshForm = {
        name: 'encrypted SSH',
        type: 'mysql',
        host: 'db.internal',
        port: 3306,
        ssh: {
          host: 'bastion.example.test',
          port: 22,
          username: 'jump',
          authMethod: 'password',
          password: 'ssh-secret-only'
        }
      }
      const sshConn = await manager.addConnection(sshForm)
      assert.equal(sshConn.ssh.password, undefined)
      assert.equal(sshConn.ssh.hasPassword, true)
      assert.equal(manager.getConnectionRuntimeConfig(sshConn.id).ssh.password, 'ssh-secret-only')
      assert.equal(connectionAttempts.length, 0, 'Import must not connect')
      assert.equal(
        (
          await manager.testConnection(
            { ...sshConn, ssh: { ...sshConn.ssh, password: '' } },
            sshConn.id
          )
        ).success,
        true
      )
      assert.equal(
        connectionAttempts.at(-1).ssh.password,
        'ssh-secret-only',
        'Connection test must receive saved SSH credentials'
      )
      assert.equal(
        (await manager.testConnection({ ...sshConn, ssh: null }, sshConn.id)).success,
        true
      )
      assert.equal(connectionAttempts.at(-1).ssh, undefined)
      assert.doesNotMatch(
        db.prepare('SELECT ssh_config FROM connections WHERE id = ?').get(sshConn.id).ssh_config,
        /ssh-secret-only/
      )
      assert.doesNotMatch(await manager.exportConnections(), /ssh-secret-only/)
      await manager.updateConnection(sshConn.id, { ssh: { ...sshConn.ssh, password: '' } })
      assert.equal(manager.getConnectionRuntimeConfig(sshConn.id).ssh.password, 'ssh-secret-only')
      const copy = await manager.duplicateConnection(sshConn.id)
      assert.equal(manager.getConnectionRuntimeConfig(copy.id).ssh.password, 'ssh-secret-only')
      assert.equal(
        (await manager.previewConnectionImport(JSON.stringify([sshConn]))).entries[0].status,
        'duplicate'
      )
      await manager.updateConnection(sshConn.id, { ssh: null })
      assert.equal(manager.getConnectionRuntimeConfig(sshConn.id).ssh, undefined)
      const keyConn = await manager.addConnection({
        ...sshForm,
        name: 'key SSH',
        ssh: {
          ...sshForm.ssh,
          authMethod: 'privateKey',
          privateKeyPath: '/tmp/test-only-key',
          passphrase: 'key-secret-only'
        }
      })
      assert.equal(keyConn.ssh.passphrase, undefined)
      assert.equal(keyConn.ssh.hasPassphrase, true)
      assert.equal(manager.getConnectionRuntimeConfig(keyConn.id).ssh.passphrase, 'key-secret-only')
      assert.doesNotMatch(await manager.exportConnections(), /key-secret-only/)
      const importedSSH = ncx(
        connection(
          `SSH="true" SSH_Host="navicat-bastion.example.test" SSH_Port="22" SSH_UserName="jump" SSH_AuthenMethod="PASSWORD" SSH_Password="${encrypted('navicat-ssh-only')}"`
        )
      )
      assert.equal(await manager.importConnections(importedSSH), 1)
      const importedConfig = (await manager.listConnections()).find(
        (conn) => conn.ssh?.host === 'navicat-bastion.example.test'
      )
      assert.equal(importedConfig.ssh.password, undefined)
      assert.equal(
        manager.getConnectionRuntimeConfig(importedConfig.id).ssh.password,
        'navicat-ssh-only'
      )
      assert.equal(await manager.importConnections(importedSSH), 0)
      assert.doesNotMatch(await manager.exportConnections(), /navicat-ssh-only/)
      const pendingConnection = await manager.addConnection({ ...sshForm, name: 'pending SSH' })
      deferConnection = true
      let before = connectionAttempts.length
      const firstConnect = manager.connectById(pendingConnection.id)
      const secondConnect = manager.connectById(pendingConnection.id)
      assert.equal(
        connectionAttempts.length,
        before + 1,
        'Concurrent connects must share a single driver'
      )
      await new Promise((resolve) => setImmediate(resolve))
      releaseConnection()
      await Promise.all([firstConnect, secondConnect])
      await manager.disconnectById(pendingConnection.id)
      const cancelledConnect = manager.connectById(pendingConnection.id)
      await manager.disconnectById(pendingConnection.id)
      await assert.rejects(cancelledConnect, /取消/)
      deferConnection = false
      db.prepare('UPDATE connections SET ssh_config = ? WHERE id = ?').run(
        JSON.stringify(sshForm.ssh),
        copy.id
      )
      const migrated = load(path.join(root, 'src/main/db/ConnectionManager.ts'), overrides)
      assert.equal(
        (await migrated.listConnections()).find((conn) => conn.id === copy.id).ssh.password,
        undefined
      )
      assert.equal(migrated.getConnectionRuntimeConfig(copy.id).ssh.password, 'ssh-secret-only')
      assert.doesNotMatch(
        db.prepare('SELECT ssh_config FROM connections WHERE id = ?').get(copy.id).ssh_config,
        /ssh-secret-only/
      )
      db.close()
      const redisNCX = ncx(
        `<Connection ConnectionName="redis-import" ConnType="REDIS" Type="Standalone" Host="cache.example.test" Port="6380" AuthenticationMode="Password" UserName="default" Password="${encrypted('redis-import-only')}" SavePassword="true"><SentinelAddr Host="" Port="0"/><Profile ProfileName="AddressList" Host="localhost" Port="6379" AuthenticationMode="None"/></Connection>`
      )
      assert.equal(await manager.importConnections(redisNCX), 1)
      const redisImported = (await manager.listConnections()).find((c) => c.name === 'redis-import')
      assert.equal(redisImported.host, 'cache.example.test')
      assert.equal(redisImported.port, 6380)
      assert.equal(redisImported.username, '')
      assert.equal(manager.getConnectionPassword(redisImported.id), 'redis-import-only')
      assert.equal(await manager.importConnections(redisNCX), 0)
      assert.doesNotMatch(await manager.exportConnections(), /redis-import-only/)
      console.log('Connection import persistence, encrypted password and rollback passed')
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { test } = require('node:test')
  test('NCX reads XML entities, Chinese names, endpoint, database, group and AES password without exposing it in preview', () => {
    const { preview, forms } = parse(
      '\uFEFF' +
        ncx(
          connection(
            `GroupName="生产环境" SSL="true" Password="${encrypted('p@ss 中文 & spaces ')}" SavePassword="true"`
          )
        )
    )
    assert.equal(preview.format, 'navicat')
    assert.equal(preview.entries[0].name, '生产 & 测试')
    assert.equal(preview.entries[0].passwordStatus, 'included')
    assert.equal(preview.entries[0].group, '生产环境')
    assert.equal(forms[0].password, 'p@ss 中文 & spaces ')
    assert.equal(forms[0].port, 3307)
    assert.equal(forms[0].ssl, true)
    assert.equal(forms[0].database, 'app')
    assert.doesNotMatch(JSON.stringify(preview), /p@ss|Password|libcckey/)
  })
  test('NCX accepts connection display lists, empty CDATA and ordinary self-closing siblings', () => {
    const row =
      '<Connection ConnectionName="display lists" ConnType="MYSQL" Host="example.test"><!-- note --><![CDATA[ ]]><Databases><Database Name="display_only"/></Databases><Schemas><Schema Name="public"/></Schemas></Connection>'
    const { preview, forms } = parse(
      ncx(
        row,
        connection(
          'ServiceProvider="Default" ClientDriverVersion="Default" ClientEncoding="65001" Keepalive="true" UseConnectionTimeout="true" UseWriteTimeout="true" Compatibility="false" Remarks=""'
        )
      )
    )
    assert.deepEqual(
      preview.entries.map((entry) => entry.status),
      ['ready', 'ready']
    )
    assert.equal(forms[0].database, '', 'A display list must not choose an initial database')
    assert.match(preview.entries[0].warnings.join(' '), /显示列表/)
    assert.equal(forms[1].host, 'db.example.test')
  })
  test('NCX accepts known scalar child fields and preserves password text while enforcing tunnel checks', () => {
    const password = encrypted('child field password ')
    const row = `<Connection ConnectionName="child fields"><ConnType>MYSQL</ConnType><Host>example.test</Host><Port>3307</Port><UserName>reader</UserName><Password><![CDATA[${password}]]></Password><SavePassword>true</SavePassword><SSH>false</SSH></Connection>`
    const { preview, forms } = parse(ncx(row))
    assert.equal(preview.entries[0].status, 'ready')
    assert.equal(forms[0].password, 'child field password ')
    assert.equal(forms[0].port, 3307)
    assert.equal(
      parse(ncx(row.replace('<SSH>false</SSH>', '<SSH>true</SSH>'))).preview.entries[0].status,
      'invalid'
    )
    assert.doesNotMatch(JSON.stringify(preview), /child field password/)
  })
  test('unknown child configuration blocks only its own connection and reports tag names without values', () => {
    const nested =
      '<Connection ConnectionName="nested" ConnType="MYSQL" Host="nested.example.test" SSH="false"><FutureTunnel Enabled="true" Host="never-show-this-host" Password="never-show-this-password"/></Connection>'
    const { preview, forms } = parse(ncx(nested, connection()))
    assert.deepEqual(
      preview.entries.map((entry) => entry.status),
      ['unsupported', 'ready']
    )
    assert.equal(preview.entries[0].address, 'nested.example.test:3306')
    assert.match(preview.entries[0].warnings.join(' '), /FutureTunnel/)
    assert.doesNotMatch(JSON.stringify(preview), /never-show-this/)
    assert.equal(forms[0], undefined)
    assert.equal(forms[1].name, '生产 & 测试')
  })
  test('Navicat standalone Redis ignores empty Sentinel and saved AddressList without overriding endpoint or password', () => {
    const row = `<Connection ConnectionName="redis" ConnType="REDIS" Type="Standalone" Role="Master" Host="cache.example.test" Port="6380" AuthenticationMode="Password" UserName="default" Password="${encrypted('redis-main-secret')}" SavePassword="true" SSH="false"><SentinelAddr Host="" Port="0"/><Profile ProfileName="AddressList" Type="Standalone" Host="localhost" Port="6379" AuthenticationMode="None" UserName="default" Password="${encrypted('unused-profile-secret')}" SSH="false"/></Connection>`
    const { preview, forms } = parse(ncx(row, connection()))
    assert.deepEqual(
      preview.entries.map((e) => e.status),
      ['ready', 'ready']
    )
    assert.equal(forms[0].host, 'cache.example.test')
    assert.equal(forms[0].port, 6380)
    assert.equal(forms[0].username, '')
    assert.equal(forms[0].password, 'redis-main-secret')
    assert.equal(preview.entries[0].passwordStatus, 'included')
    assert.match(preview.entries[0].warnings.join(' '), /主连接地址/)
    assert.doesNotMatch(
      JSON.stringify(preview),
      /redis-main-secret|unused-profile-secret|localhost/
    )
    assert.equal(
      parse(ncx(row), [{ ...forms[0], id: 'saved', createdAt: 1, updatedAt: 1 }]).preview.entries[0]
        .status,
      'duplicate'
    )
  })
  test('Redis import keeps malformed encrypted credentials unavailable without blocking the standalone connection', () => {
    const row =
      '<Connection ConnectionName="redis" ConnType="REDIS" Type="Standalone" Host="cache.example.test" AuthenticationMode="Password" UserName="default" Password="0000000000000000000000000000000P" SavePassword="true"><SentinelAddr Host="" Port="0"/><Profile ProfileName="AddressList" Host="localhost"/></Connection>'
    const { preview, forms } = parse(ncx(row))
    assert.equal(preview.entries[0].status, 'ready')
    assert.equal(preview.entries[0].passwordStatus, 'unavailable')
    assert.equal(forms[0].password, undefined)
    assert.match(preview.entries[0].warnings.join(' '), /重新填写密码/)
  })
  test('Redis Password mode imports into the driver without prefixing the inactive default username', () => {
    const { forms } = parse(
      ncx(
        `<Connection ConnectionName="redis" ConnType="REDIS" Type="Standalone" Host="cache.example.aliyuncs.com" AuthenticationMode="Password" UserName="default" Password="${encrypted('redis-test-only')}" SavePassword="true"/>`
      )
    )
    let options
    const { RedisDriver } = load(path.join(root, 'src/main/db/drivers/redis.ts'), {
      redis: {
        createClient: (value) => {
          options = value
          return { on() {} }
        }
      }
    })
    new RedisDriver({
      host: forms[0].host,
      port: forms[0].port,
      user: forms[0].username,
      password: forms[0].password
    })
    assert.equal(options.username, undefined)
    assert.equal(options.password, 'redis-test-only')
  })
  test('Redis Sentinel and Cluster imports are explicitly rejected without blocking siblings', () => {
    const rows = ['Sentinel', 'Cluster'].map(
      (type) =>
        `<Connection ConnectionName="${type}" ConnType="REDIS" Type="${type}" Host="cache.example.test"><SentinelAddr Host="sentinel.example.test" Port="26379"/><Profile ProfileName="AddressList" Host="localhost"/></Connection>`
    )
    const { preview, forms } = parse(ncx(...rows, connection()))
    assert.deepEqual(
      preview.entries.map((e) => e.status),
      ['unsupported', 'unsupported', 'ready']
    )
    assert.ok(
      preview.entries.slice(0, 2).every((e) => e.warnings.join(' ').includes('Sentinel / Cluster'))
    )
    assert.equal(forms[0], undefined)
    assert.equal(forms[1], undefined)
  })
  test('Redis auxiliary compatibility stays limited to empty placeholders and known leaf profiles', () => {
    const children = [
      '<SentinelAddr Host="active.example.test" Port="26379"/>',
      '<Profile ProfileName="FutureProfile" Password="do-not-expose"/>',
      '<Profile ProfileName="AddressList"><FutureTunnel Password="do-not-expose"/></Profile>'
    ]
    for (const child of children) {
      const { preview, forms } = parse(
        ncx(
          `<Connection ConnectionName="redis" ConnType="REDIS" Type="Standalone" Host="cache.example.test">${child}</Connection>`
        )
      )
      assert.equal(preview.entries[0].status, 'unsupported')
      assert.equal(forms[0], undefined)
      assert.doesNotMatch(JSON.stringify(preview), /do-not-expose|active.example.test/)
    }
    assert.equal(
      parse(
        ncx(
          '<Connection ConnectionName="mysql" ConnType="MYSQL" Host="db.example.test"><Profile ProfileName="AddressList"/></Connection>'
        )
      ).preview.entries[0].status,
      'unsupported'
    )
  })
  test('Redis None authentication does not import inactive credentials or profile authentication', () => {
    const { preview, forms } = parse(
      ncx(
        `<Connection ConnectionName="redis" ConnType="REDIS" Host="cache.example.test" AuthenticationMode="None" UserName="default" Password="${encrypted('unused-main-secret')}"><Profile ProfileName="AddressList" AuthenticationMode="Password" Password="${encrypted('unused-profile-secret')}"/></Connection>`
      )
    )
    assert.equal(preview.entries[0].status, 'ready')
    assert.equal(preview.entries[0].passwordStatus, 'not-needed')
    assert.equal(forms[0].username, '')
    assert.equal(forms[0].password, undefined)
    const unknown = parse(
      ncx(
        '<Connection ConnectionName="redis" ConnType="REDIS" Host="cache.example.test" AuthenticationMode="FutureAuth"/>'
      )
    )
    assert.equal(unknown.preview.entries[0].status, 'unsupported')
  })
  test('conflicting child fields mark one row invalid without overwriting attributes or blocking siblings', () => {
    const row =
      '<Connection ConnectionName="conflict" ConnType="MYSQL" Host="example.test"><Host>other.example.test</Host></Connection>'
    const { preview, forms } = parse(ncx(row, connection()))
    assert.deepEqual(
      preview.entries.map((entry) => entry.status),
      ['invalid', 'ready']
    )
    assert.equal(forms[0], undefined)
    assert.match(preview.entries[0].warnings.join(' '), /冲突/)
  })
  test('supported engines map to existing drivers while Oracle and MongoDB stay visible as unsupported', () => {
    const { preview } = parse(
      ncx(
        ...['MARIADB', 'PGSQL', 'MSSQL', 'SQLITE', 'REDIS', 'ORACLE', 'MONGODB'].map(
          (type, index) =>
            `<Connection ConnectionName="${index}" ConnType="${type}" Host="localhost" DatabaseFileName="/tmp/sample.db"/>`
        )
      )
    )
    assert.deepEqual(
      preview.entries.map((entry) => entry.type),
      ['mysql', 'postgresql', 'mssql', 'sqlite', 'redis', undefined, undefined]
    )
    assert.deepEqual(
      preview.entries.map((entry) => entry.status),
      ['ready', 'ready', 'ready', 'ready', 'ready', 'unsupported', 'unsupported']
    )
  })
  test('malformed and old encrypted passwords never become literal connection passwords', () => {
    for (const password of ['not-hex', '1234', '00000000000000000000000000000000']) {
      const { preview, forms } = parse(ncx(connection(`Password="${password}"`)))
      assert.equal(preview.entries[0].passwordStatus, 'unavailable')
      assert.equal(forms[0].password, undefined)
    }
    const result = parse(ncx(connection(`Password="${encrypted('ignored')}" SavePassword="false"`)))
    assert.equal(result.preview.entries[0].passwordStatus, 'missing')
    assert.equal(result.forms[0].password, undefined)
  })
  test('Navicat SSH password and encrypted key passphrase migrate without exposing credentials in preview', () => {
    const attrs = `SSH="true" SSH_Host="bastion.example.test" SSH_Port="2222" SSH_UserName="jump" SSH_AuthenMethod="PASSWORD" SSH_Password="${encrypted('ssh-import-secret')}" SSH_SavePassword="true"`
    const password = parse(ncx(connection(attrs)))
    assert.equal(password.preview.entries[0].status, 'ready')
    assert.equal(password.forms[0].ssh.password, 'ssh-import-secret')
    assert.equal(password.forms[0].ssh.port, 2222)
    assert.doesNotMatch(JSON.stringify(password.preview), /ssh-import-secret/)
    const key = parse(
      ncx(
        connection(
          `SSH="true" SSH_Host="bastion.example.test" SSH_UserName="jump" SSH_AuthenMethod="PUBLICKEY" SSH_PrivateKey="/tmp/id_rsa" SSH_Passphrase="${encrypted('phrase-import-secret')}"`
        )
      )
    )
    assert.equal(key.preview.entries[0].status, 'ready')
    assert.equal(key.forms[0].ssh.authMethod, 'privateKey')
    assert.equal(key.forms[0].ssh.passphrase, 'phrase-import-secret')
    assert.doesNotMatch(JSON.stringify(key.preview), /phrase-import-secret/)
  })
  test('SSH credentials can be missing while valid imported transport settings remain; invalid SSH configuration is explicit', () => {
    const valid = 'SSH="true" SSH_Host="bastion.example.test" SSH_UserName="jump"'
    const missing = parse(ncx(connection(valid)))
    assert.equal(missing.preview.entries[0].status, 'ready')
    assert.equal(missing.preview.entries[0].ssh.credentialStatus, 'missing')
    const invalid = parse(ncx(connection(valid + ' SSH_Port="65536"')))
    assert.equal(invalid.preview.entries[0].status, 'invalid')
    const badPassword = parse(ncx(connection(valid + ' SSH_Password="old-cipher"')))
    assert.equal(badPassword.preview.entries[0].status, 'ready')
    assert.equal(badPassword.forms[0].ssh.password, undefined)
    assert.equal(badPassword.preview.entries[0].ssh.credentialStatus, 'unavailable')
  })
  test('nested Navicat SSH settings are preserved and conflicting activation flags are rejected', () => {
    const nested = connection().replace(
      '/>',
      `><SSH Enabled="true" Host="bastion.example.test" Port="2222" UserName="jump" AuthenMethod="PASSWORD"><Password>${encrypted('nested-ssh-secret')}</Password></SSH></Connection>`
    )
    const { preview, forms } = parse(ncx(nested))
    assert.equal(preview.entries[0].status, 'ready')
    assert.equal(forms[0].ssh.host, 'bastion.example.test')
    assert.equal(forms[0].ssh.password, 'nested-ssh-secret')
    assert.doesNotMatch(JSON.stringify(preview), /nested-ssh-secret/)
    assert.equal(
      parse(ncx(nested.replace('ConnectionName=', 'SSH="false" ConnectionName='))).preview
        .entries[0].status,
      'invalid'
    )
  })
  test('incompatible transport, encryption and authentication settings cannot silently import as direct connections', () => {
    for (const attrs of [
      'HTTP="1"',
      'NamedPipe="true"',
      'SSL="true" SSL_CACert="/tmp/ca.pem"',
      'SSL="true" SSL_PGSSLMode="VERIFY_FULL"',
      'ServiceProvider="CloudCustom"'
    ]) {
      assert.equal(parse(ncx(connection(attrs))).preview.entries[0].status, 'unsupported', attrs)
    }
    assert.equal(
      parse(
        ncx(
          '<Connection ConnectionName="win" ConnType="MSSQL" Host="host" MSSQLAuthenMode="WINDOWS"/>'
        )
      ).preview.entries[0].status,
      'unsupported'
    )
    assert.equal(
      parse(
        ncx(
          '<Connection ConnectionName="sqlite" ConnType="SQLITE" DatabaseFileName="/tmp/a.db" SQLiteEncrypt="true"/>'
        )
      ).preview.entries[0].status,
      'unsupported'
    )
  })
  test('duplicates within a file and against saved connections are skipped without overwriting', () => {
    const content = ncx(connection(), connection())
    const first = parse(content)
    assert.deepEqual(
      first.preview.entries.map((entry) => entry.status),
      ['ready', 'duplicate']
    )
    const existing = { ...first.forms[0], id: 'saved', createdAt: 1, updatedAt: 1 }
    assert.deepEqual(
      parse(content, [existing]).preview.entries.map((entry) => entry.status),
      ['duplicate', 'duplicate']
    )
  })
  test('bad row does not prevent previewing other valid rows and invalid ports are not defaulted', () => {
    assert.equal(
      parse(ncx(connection().replace('/>', '>\n</Connection>'))).preview.entries[0].status,
      'ready'
    )
    const { preview } = parse(
      ncx(
        '<Connection ConnectionName="bad" ConnType="MYSQL" Host="host" Port="oops"/>',
        connection()
      )
    )
    assert.equal(preview.entries[0].status, 'invalid')
    assert.equal(preview.entries[1].status, 'ready')
    for (const port of ['0', '65536', '1.5', '-1'])
      assert.equal(
        parse(ncx(`<Connection ConnectionName="bad" ConnType="MYSQL" Host="host" Port="${port}"/>`))
          .preview.entries[0].status,
        'invalid'
      )
  })
  test('NexSQL JSON remains importable with name, group, tags and default ports; unsupported types are explicit', () => {
    const { preview, forms } = parse(
      JSON.stringify([
        {
          name: 'existing JSON',
          type: 'postgresql',
          host: 'localhost',
          group: 'dev',
          tags: ['a', 'b']
        },
        null,
        { name: 'unknown', type: 'oracle' }
      ])
    )
    assert.equal(preview.format, 'nexsql')
    assert.equal(preview.entries[0].status, 'ready')
    assert.equal(forms[0].port, 5432)
    assert.equal(forms[0].group, 'dev')
    assert.deepEqual(forms[0].tags, ['a', 'b'])
    assert.equal(preview.entries[2].status, 'unsupported')
  })
  test('XML parser rejects damaged XML, unknown structure and entity definitions without leaking file content', () => {
    for (const text of [
      '<Connections><Connection></Connections>',
      '<Other/>',
      '<Connections><Folder/></Connections>',
      '<!DOCTYPE Connections [<!ENTITY x SYSTEM "file:///etc/passwd">]><Connections/>',
      '<Connections><Connection Host="&unknown;"/></Connections>',
      '<Connections>bad</Connections>'
    ])
      assert.throws(() => parse(text))
    assert.throws(() => parse('not JSON'), /请选择 NexSQL JSON/)
    assert.throws(() => parse('{}'), /JSON 数组/)
    assert.throws(() => parse(ncx()), /没有连接/)
    assert.throws(() => parse(ncx().repeat(200000)), /不能超过/)
  })
  test('SQLite paths, Redis database indices and empty names are validated', () => {
    assert.equal(
      parse(ncx('<Connection ConnectionName="" ConnType="MYSQL" Host="host"/>')).preview.entries[0]
        .status,
      'invalid'
    )
    assert.equal(
      parse(ncx('<Connection ConnectionName="sqlite" ConnType="SQLITE"/>')).preview.entries[0]
        .status,
      'invalid'
    )
    assert.equal(
      parse(ncx('<Connection ConnectionName="redis" ConnType="REDIS" Host="host" Database="-1"/>'))
        .preview.entries[0].status,
      'invalid'
    )
  })
  test('real SQLite persistence is atomic, preserves encrypted secrets, deduplicates and never connects during import', () => {
    const result = spawnSync(require('electron'), [__filename, '--storage-child'], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 20000
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /rollback passed/)
  })
}
