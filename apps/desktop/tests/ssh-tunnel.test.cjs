const { test } = require('node:test')
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto')
const { load, root, fixture, tunnelModule, roundTrip } = require('./ssh-fixtures.cjs')

test('SSH password tunnel forwards concurrent connections, remote target names, and large payloads; close releases the listener', async () => {
  const f = await fixture(),
    { prepareConnection } = tunnelModule()
  let tunnel
  try {
    tunnel = await prepareConnection(f.config)
    assert.equal(tunnel.config.host, '127.0.0.1')
    assert.equal(tunnel.config.ssh, undefined)
    const payload = 'example 数据 '.repeat(20000)
    assert.deepEqual(
      await Promise.all([
        roundTrip(tunnel.config.port, 'one'),
        roundTrip(tunnel.config.port, payload)
      ]),
      ['one', payload]
    )
    assert.ok(f.destinations.every((d) => d.host === 'db.internal.invalid' && d.port === 3306))
    tunnel.close()
    tunnel.close()
    await assert.rejects(roundTrip(tunnel.config.port, 'after close'))
  } finally {
    tunnel?.close()
    await f.close()
  }
})
test('SSH encrypted private key authentication uses its passphrase', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKey = pair.privateKey.export({
    type: 'pkcs1',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: 'test-only-phrase'
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexsql-ssh-key-')),
    file = path.join(dir, 'id_rsa')
  fs.writeFileSync(file, privateKey)
  const f = await fixture({ publicKey: pair.privateKey.export({ type: 'pkcs1', format: 'pem' }) })
  let tunnel
  try {
    const { prepareConnection } = tunnelModule()
    tunnel = await prepareConnection({
      ...f.config,
      ssh: {
        ...f.config.ssh,
        authMethod: 'privateKey',
        privateKeyPath: file,
        password: undefined,
        passphrase: 'test-only-phrase'
      }
    })
    assert.equal(await roundTrip(tunnel.config.port, 'key-auth'), 'key-auth')
    await assert.rejects(
      prepareConnection({
        ...f.config,
        ssh: {
          ...f.config.ssh,
          authMethod: 'privateKey',
          privateKeyPath: file,
          passphrase: 'wrong'
        }
      }),
      /私钥/
    )
  } finally {
    tunnel?.close()
    await f.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
test('SSH accepts encrypted OpenSSH Ed25519 private key files', async (t) => {
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexsql-ed25519-')),
    file = path.join(dir, 'id_ed25519')
  const generated = spawnSync(
    'ssh-keygen',
    ['-q', '-t', 'ed25519', '-N', 'test-only-phrase', '-f', file],
    { encoding: 'utf8' }
  )
  if (generated.error?.code === 'ENOENT') {
    fs.rmSync(dir, { recursive: true, force: true })
    t.skip('ssh-keygen not available')
    return
  }
  assert.equal(generated.status, 0, generated.stderr)
  const f = await fixture({ publicKey: fs.readFileSync(file + '.pub') })
  let tunnel
  try {
    tunnel = await tunnelModule().prepareConnection({
      ...f.config,
      ssh: {
        ...f.config.ssh,
        authMethod: 'privateKey',
        privateKeyPath: file,
        passphrase: 'test-only-phrase'
      }
    })
    assert.equal(await roundTrip(tunnel.config.port, 'ed25519'), 'ed25519')
  } finally {
    tunnel?.close()
    await f.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
test('SSH failures reject rather than returning a direct database connection', async () => {
  const f = await fixture()
  try {
    await assert.rejects(
      tunnelModule().prepareConnection({
        ...f.config,
        ssh: { ...f.config.ssh, password: 'wrong' }
      }),
      /SSH/
    )
    await assert.rejects(tunnelModule(async () => false).prepareConnection(f.config), /未信任/)
    await assert.rejects(
      tunnelModule(async () => {
        throw new Error('主机指纹已变化')
      }).prepareConnection(f.config),
      /指纹已变化/
    )
    assert.equal(f.destinations.length, 0)
  } finally {
    await f.close()
  }
})
test('SSH cancellation during authentication closes the pending connection promptly', async () => {
  const f = await fixture({ holdAuth: true }),
    controller = new AbortController()
  try {
    const pending = tunnelModule().prepareConnection(f.config, controller.signal)
    setTimeout(() => controller.abort(), 50)
    await assert.rejects(pending, /取消/)
    assert.equal(f.destinations.length, 0)
  } finally {
    await f.close()
  }
})
test('closing one SSH tunnel does not interrupt another tunnel', async () => {
  const f = await fixture(),
    { prepareConnection } = tunnelModule()
  let first, second
  try {
    ;[first, second] = await Promise.all([prepareConnection(f.config), prepareConnection(f.config)])
    assert.notEqual(first.config.port, second.config.port)
    first.close()
    assert.equal(await roundTrip(second.config.port, 'still running'), 'still running')
  } finally {
    first?.close()
    second?.close()
    await f.close()
  }
})
test('SSH driver wrapper initializes one tunnel for concurrent operations and refuses use after disconnect', async () => {
  const f = await fixture()
  let created = 0
  const ssh = tunnelModule(),
    { createSSHDriver } = load(path.join(root, 'src/main/db/drivers/SSHDriver.ts'), {
      '../SSHTunnel': ssh
    })
  const driver = createSSHDriver(f.config, (config) => {
    created++
    return {
      testConnection: () => roundTrip(config.port, 'ping'),
      execute: (sql) => roundTrip(config.port, sql),
      disconnect: async () => {}
    }
  })
  try {
    assert.deepEqual(await Promise.all([driver.execute('first'), driver.execute('second')]), [
      'first',
      'second'
    ])
    assert.equal(created, 1)
    await driver.disconnect()
    await assert.rejects(driver.execute('after close'), /关闭/)
  } finally {
    await driver.disconnect()
    await f.close()
  }
})
test('SSH driver disconnect aborts an in-progress handshake and cleans up', async () => {
  const f = await fixture({ holdAuth: true }),
    ssh = tunnelModule(),
    { createSSHDriver } = load(path.join(root, 'src/main/db/drivers/SSHDriver.ts'), {
      '../SSHTunnel': ssh
    })
  const driver = createSSHDriver(f.config, () => {
    throw new Error('Must not create direct driver')
  })
  try {
    const pending = driver.testConnection()
    setTimeout(() => void driver.disconnect(), 50)
    await assert.rejects(pending, /取消/)
  } finally {
    await driver.disconnect()
    await f.close()
  }
})

function hostTrustFixture(response = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexsql-host-trust-')),
    prompts = []
  const api = load(path.join(root, 'src/main/db/SSHHostKeys.ts'), {
    electron: {
      app: { getPath: () => dir },
      BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [] },
      dialog: {
        showMessageBox: async (_parent, options) => {
          prompts.push(options)
          return { response }
        }
      }
    }
  })
  return { ...api, dir, prompts, close: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
test('first-use SSH host trust is explicit, deduplicated, persisted and changed keys are refused', async () => {
  const f = hostTrustFixture(),
    signal = new AbortController().signal,
    key = Buffer.from('test-host-key')
  try {
    assert.deepEqual(
      await Promise.all([
        f.verifySSHHostKey('example.test', 22, key, signal),
        f.verifySSHHostKey('example.test', 22, key, signal)
      ]),
      [true, true]
    )
    assert.equal(f.prompts.length, 1)
    assert.match(f.prompts[0].detail, /SHA256:/)
    assert.equal(await f.verifySSHHostKey('example.test', 22, key, signal), true)
    await assert.rejects(
      f.verifySSHHostKey('example.test', 22, Buffer.from('changed'), signal),
      /指纹已变化/
    )
    assert.equal(f.prompts.length, 1)
  } finally {
    f.close()
  }
})
test('SSH trust rejection and cancelled requests do not save a fingerprint; concurrent hosts are retained', async () => {
  const rejected = hostTrustFixture(0),
    accepted = hostTrustFixture(),
    signal = new AbortController().signal
  try {
    assert.equal(await rejected.verifySSHHostKey('a', 22, Buffer.from('a'), signal), false)
    assert.equal(fs.existsSync(path.join(rejected.dir, 'ssh-known-hosts.json')), false)
    const aborted = new AbortController()
    aborted.abort()
    assert.equal(
      await accepted.verifySSHHostKey('cancelled', 22, Buffer.from('x'), aborted.signal),
      false
    )
    await Promise.all(
      ['a', 'b'].map((host) => accepted.verifySSHHostKey(host, 22, Buffer.from(host), signal))
    )
    const saved = JSON.parse(
      fs.readFileSync(path.join(accepted.dir, 'ssh-known-hosts.json'), 'utf8')
    )
    assert.equal(Object.keys(saved).length, 2)
  } finally {
    rejected.close()
    accepted.close()
  }
})
