const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  { EventEmitter } = require('node:events'),
  { fork } = require('node:child_process')
const { load, root, fixture, tunnelModule } = require('./ssh-fixtures.cjs')
let sequence = 0
function queryFixture(f, type = 'mysql') {
  const config = {
    ...f.config,
    id: 'ssh-query',
    type,
    database: 'nexsql_test',
    username: type === 'mysql' ? 'root' : 'postgres'
  }
  const sender = new EventEmitter()
  sender.id = ++sequence
  sender.isDestroyed = () => false
  sender.send = () => {}
  const ssh = tunnelModule()
  const runner = load(
    path.join(root, 'src/main/db/QueryRunner.ts'),
    {
      './ConnectionManager': {
        getConnectionRuntimeConfig: () => config,
        getConnectionPassword: () => 'nexsql_test_only'
      },
      './SSHTunnel': ssh,
      './QueryExecutor': { saveHistory() {} },
      '@shared/sqlStatements': load(path.join(root, '../../packages/shared/src/sqlStatements.ts')),
      'node:child_process': {
        fork: (file, args, options) =>
          fork(file, args, { ...options, execPath: require('electron') })
      }
    },
    path.join(root, 'out/main/QueryRunner.ssh-test.cjs')
  )
  return {
    config,
    sender,
    ...runner,
    run: (sql) => runner.executeBatch(sender, `ssh-${++sequence}`, config.id, sql)
  }
}
for (const [type, env, slow] of [
  ['mysql', 'NEXSQL_TEST_MYSQL_PORT', 'SELECT SLEEP(30)'],
  ['postgresql', 'NEXSQL_TEST_PG_PORT', 'SELECT pg_sleep(30)']
]) {
  const port = Number(process.env[env])
  test(
    `${type}: actual SSH tunnel supports browsing metadata, transactions and table reads`,
    { skip: !port, timeout: 20000 },
    async () => {
      const f = await fixture({ backendPort: port }),
        q = queryFixture(f, type),
        ssh = tunnelModule()
      const wrapper = load(path.join(root, 'src/main/db/drivers/SSHDriver.ts'), {
        '../SSHTunnel': ssh
      })
      const direct = load(
        path.join(root, `src/main/db/drivers/${type === 'mysql' ? 'mysql' : 'postgres'}.ts`)
      )
      const Driver = type === 'mysql' ? direct.MySQLDriver : direct.PostgresDriver
      const driver = wrapper.createSSHDriver(
        q.config,
        (cfg) =>
          new Driver({
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            user: cfg.username,
            password: 'nexsql_test_only'
          })
      )
      const table = `ssh_meta_${++sequence}`
      try {
        await driver.testConnection()
        assert.ok((await driver.getDatabases()).includes('nexsql_test'))
        await driver.execute(`CREATE TABLE ${table}(id INT PRIMARY KEY, label VARCHAR(50))`)
        assert.ok((await driver.getTables('nexsql_test')).some((t) => t.name === table))
        assert.deepEqual(
          (await driver.getColumns(table, 'nexsql_test')).map((c) => c.name),
          ['id', 'label']
        )
        await driver.transaction([
          `INSERT INTO ${table} VALUES (1,'one')`,
          `INSERT INTO ${table} VALUES (2,'two')`
        ])
        assert.deepEqual((await driver.execute(`SELECT * FROM ${table} ORDER BY id`)).rows, [
          { id: 1, label: 'one' },
          { id: 2, label: 'two' }
        ])
        await driver.execute(`DROP TABLE ${table}`)
        assert.ok(f.destinations.every((d) => d.host === 'db.internal.invalid'))
      } finally {
        await driver.disconnect()
        await f.close()
      }
    }
  )
  test(
    `${type}: SSH batch continues after errors, and cancellation uses a separate forwarded control connection`,
    { skip: !port, timeout: 20000 },
    async () => {
      const f = await fixture({ backendPort: port }),
        q = queryFixture(f, type)
      try {
        const result = await q.run(
          'CREATE TEMPORARY TABLE ssh_t(v INT); INSERT INTO ssh_t VALUES(1); SELECT * FROM missing_ssh_table; INSERT INTO ssh_t VALUES(2); SELECT * FROM ssh_t ORDER BY v;'
        )
        assert.equal(result.status, 'failed')
        assert.equal(result.failedStatements, 1)
        assert.deepEqual(result.results.at(-1).rows, [{ v: 1 }, { v: 2 }])
        const id = `ssh-cancel-${++sequence}`
        let timer
        q.sender.send = (_channel, p) => {
          if (p.executionId === id && p.index === 0)
            timer = setTimeout(() => q.cancelQuery(id, q.sender.id), 100)
        }
        const pending = q.executeBatch(
          q.sender,
          id,
          q.config.id,
          `SELECT 1 AS n; ${slow}; SELECT 999 AS n;`
        )
        const other = await q.run('SELECT 7 AS n;')
        assert.equal(other.status, 'completed')
        assert.equal(other.results[0].rows[0].n, 7)
        const cancelled = await pending
        clearTimeout(timer)
        assert.equal(cancelled.status, 'cancelled')
        assert.equal(
          cancelled.results.some((r) => r.sql.includes('999')),
          false
        )
        assert.ok(
          f.destinations.length >= 4,
          'Three query sessions plus a separate cancellation control session must be forwarded'
        )
      } finally {
        await f.close()
      }
    }
  )
}
test(
  'query cancellation and sender destruction abort SSH setup before any SQL worker is launched',
  { timeout: 5000 },
  async () => {
    const f = await fixture({ holdAuth: true }),
      q = queryFixture(f)
    try {
      const id = 'pending-ssh'
      const pending = q.executeBatch(q.sender, id, q.config.id, 'SELECT 1;')
      await assert.rejects(q.executeBatch(q.sender, id, q.config.id, 'SELECT 2;'), /重复/)
      setTimeout(() => q.cancelQuery(id, q.sender.id), 50)
      assert.equal((await pending).status, 'cancelled')
      const destroyed = q.run('SELECT 3;')
      q.sender.emit('destroyed')
      assert.equal((await destroyed).status, 'cancelled')
      assert.equal(f.destinations.length, 0)
      const timed = await q.executeBatch(
        q.sender,
        'timeout-ssh',
        q.config.id,
        'SELECT 4;',
        undefined,
        30
      )
      assert.equal(timed.status, 'cancelled')
      assert.match(timed.error, /时限/)
    } finally {
      await f.close()
    }
  }
)
test(
  'Redis browsing, key inspection and deletion work through the SSH driver wrapper',
  { skip: !process.env.NEXSQL_TEST_REDIS_PORT, timeout: 15000 },
  async () => {
    const f = await fixture({ backendPort: Number(process.env.NEXSQL_TEST_REDIS_PORT) }),
      ssh = tunnelModule()
    const { createSSHDriver } = load(path.join(root, 'src/main/db/drivers/SSHDriver.ts'), {
      '../SSHTunnel': ssh
    })
    const { RedisDriver } = load(path.join(root, 'src/main/db/drivers/redis.ts'))
    const config = { ...f.config, type: 'redis', port: 6379, database: '0' }
    const driver = createSSHDriver(
      config,
      (cfg) => new RedisDriver({ host: cfg.host, port: cfg.port, database: '0' })
    )
    const api = load(path.join(root, 'src/main/db/redis.ts'), {
      './ConnectionManager': { getDriver: () => driver, getConnectionConfig: () => config }
    })
    try {
      await driver.testConnection()
      await driver.execute('SET nexsql-ssh-key "example value"')
      assert.equal(
        (await api.getRedisKeyDetail(config.id, 'nexsql-ssh-key', '0')).value,
        'example value'
      )
      const page = await api.getRedisKeys(config.id, 'nexsql-ssh-*', '0')
      assert.ok(page.items.some((key) => key.key === 'nexsql-ssh-key'))
      assert.equal(await api.deleteRedisKey(config.id, 'nexsql-ssh-key', '0'), 1)
    } finally {
      await driver.disconnect()
      await f.close()
    }
  }
)

test(
  'MySQL TLS connections and cancellation retain their remote hostname through SSH',
  { skip: !process.env.NEXSQL_TEST_MYSQL_PORT, timeout: 15000 },
  async () => {
    const f = await fixture({ backendPort: Number(process.env.NEXSQL_TEST_MYSQL_PORT) }),
      q = queryFixture(f)
    q.config.ssl = true
    try {
      const secure = await q.run("SHOW SESSION STATUS LIKE 'Ssl_cipher';")
      assert.equal(secure.status, 'completed')
      assert.ok(secure.results[0].rows[0].Value)
      const id = 'ssh-tls-cancel'
      q.sender.send = (_channel, p) => {
        if (p.executionId === id && p.index === 0)
          setTimeout(() => q.cancelQuery(id, q.sender.id), 100)
      }
      const cancelled = await q.executeBatch(
        q.sender,
        id,
        q.config.id,
        'SELECT 1; SELECT SLEEP(30); SELECT 999;'
      )
      assert.equal(cancelled.status, 'cancelled')
      assert.equal(
        cancelled.results.some((r) => r.sql.includes('999')),
        false
      )
    } finally {
      await f.close()
    }
  }
)
