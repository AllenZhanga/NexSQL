const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { fork } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexsql-tests-'))
const configs = {}
let sequence = 0
const electron = require('electron')
function loadTS(file, overrides = {}, filename = file) {
  const m = new Module(filename, module)
  m.filename = filename
  m.paths = module.paths
  m.require = (name) => overrides[name] ?? require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    filename
  )
  return m.exports
}
const { splitSQL } = loadTS(path.join(root, '../../packages/shared/src/sqlStatements.ts'))
const { executeBatch, cancelQuery } = loadTS(
  path.join(root, 'src/main/db/QueryRunner.ts'),
  {
    './ConnectionManager': {
      getConnectionRuntimeConfig: (id) => configs[id],
      getConnectionPassword: (id) => configs[id].password || ''
    },
    './QueryExecutor': { saveHistory: () => {} },
    './SSHTunnel': { prepareConnection: async config => ({config, close() {}, getError: () => undefined}) },
    '@shared/sqlStatements': { splitSQL },
    'node:child_process': {
      fork: (file, args, options) => fork(file, args, { ...options, execPath: electron })
    }
  },
  path.join(root, 'out/main/QueryRunner.test.cjs')
)
function fixture() {
  const id = `db-${++sequence}`
  configs[id] = { id, type: 'sqlite', filePath: path.join(temp, `${id}.db`) }
  const sender = new EventEmitter()
  sender.id = sequence
  sender.isDestroyed = () => false
  sender.send = () => {}
  return { id, sender, run: (sql) => executeBatch(sender, `run-${++sequence}`, id, sql) }
}
after(() => fs.rmSync(temp, { recursive: true, force: true }))
test('multiple statements preserve session and individual results', async () => {
  const f = fixture()
  const result = await f.run(
    "CREATE TEMP TABLE t(v TEXT); INSERT INTO t VALUES ('a;b'); SELECT * FROM t; SELECT 42 AS n;"
  )
  assert.equal(result.status, 'completed')
  assert.equal(result.results.length, 4)
  assert.equal(result.results[2].rows[0].v, 'a;b')
  assert.equal(result.results[3].rows[0].n, 42)
})
test('failure preserves its error and continues subsequent writes and queries', async () => {
  const f = fixture()
  const result = await f.run(
    'CREATE TABLE t(v); INSERT INTO t VALUES (1); SELECT * FROM missing; INSERT INTO t VALUES (2); SELECT * FROM t;'
  )
  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 5)
  assert.equal(result.failedStatements, 1)
  assert.match(result.results[2].error, /missing/)
  assert.deepEqual(result.results[4].rows, [{ v: 1 }, { v: 2 }])
  const check = await f.run('SELECT * FROM t;')
  assert.deepEqual(check.results[0].rows, [{ v: 1 }, { v: 2 }])
})
test('uncommitted transaction is rolled back after continuing past an error', async () => {
  const f = fixture()
  await f.run('CREATE TABLE t(v);')
  const result = await f.run(
    'BEGIN; INSERT INTO t VALUES (1); SELECT * FROM missing; INSERT INTO t VALUES (2); SELECT * FROM t;'
  )
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.results.at(-1).rows, [{ v: 1 }, { v: 2 }])
  assert.match(result.warning, /未提交事务/)
  const check = await f.run('SELECT COUNT(*) AS n FROM t;')
  assert.equal(check.results[0].rows[0].n, 0)
})
test('explicit COMMIT still executes after a SQLite statement error', async () => {
  const f = fixture()
  await f.run('CREATE TABLE t(v);')
  const result = await f.run(
    'BEGIN; INSERT INTO t VALUES (1); SELECT * FROM missing; COMMIT; SELECT * FROM t;'
  )
  assert.equal(result.results.length, 5)
  assert.equal(result.status, 'failed')
  assert.equal(result.warning, undefined)
  assert.deepEqual((await f.run('SELECT * FROM t;')).results[0].rows, [{ v: 1 }])
})
test('multiple statement errors are each reported and later results still arrive', async () => {
  const f = fixture(),
    progress = []
  f.sender.send = (_channel, p) => progress.push(p)
  const result = await f.run(
    'SELECT * FROM missing_one; SELECT 7 AS n; SELECT * FROM missing_two; SELECT 9 AS n;'
  )
  assert.equal(result.failedStatements, 2)
  assert.equal(result.results.length, 4)
  assert.match(result.results[0].error, /missing_one/)
  assert.match(result.results[2].error, /missing_two/)
  assert.equal(result.results[1].rows[0].n, 7)
  assert.equal(result.results[3].rows[0].n, 9)
  assert.deepEqual(
    progress.map((p) => p.index),
    [0, 1, 2, 3]
  )
})
test('empty SELECT still returns column metadata and comments before SELECT work', async () => {
  const f = fixture()
  const result = await f.run('-- select\nSELECT 1 AS n WHERE 0;')
  assert.equal(result.results[0].columns[0].name, 'n')
  assert.deepEqual(result.results[0].rows, [])
})
test('SQLite trigger body is executed intact', async () => {
  const f = fixture()
  const result = await f.run(
    'CREATE TABLE a(v); CREATE TABLE b(v); CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES(1); INSERT INTO b VALUES(2); END; INSERT INTO a VALUES(0); SELECT * FROM b;'
  )
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.results.at(-1).rows, [{ v: 1 }, { v: 2 }])
})
test(
  'cancel interrupts native SQLite query, rolls back, and does not affect another run',
  { timeout: 15000 },
  async () => {
    const f = fixture(),
      other = fixture()
    await f.run('CREATE TABLE t(v);')
    const executionId = 'cancel-long-query'
    let timer
    f.sender.send = (_channel, p) => {
      if (p.index === 1) timer = setTimeout(() => cancelQuery(executionId, f.sender.id), 100)
    }
    const slow = executeBatch(
      f.sender,
      executionId,
      f.id,
      'BEGIN; INSERT INTO t VALUES(9); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT SUM(x) FROM n; COMMIT;'
    )
    assert.equal(cancelQuery(executionId, other.sender.id), false)
    const fast = await other.run('SELECT 7 AS n;')
    assert.equal(fast.results[0].rows[0].n, 7)
    const result = await slow
    clearTimeout(timer)
    assert.equal(result.status, 'cancelled')
    assert.equal(result.results.length, 2)
    const check = await f.run('SELECT COUNT(*) AS n FROM t;')
    assert.equal(check.results[0].rows[0].n, 0)
    assert.equal(cancelQuery(executionId, f.sender.id), false)
  }
)
test('duplicate execution IDs cannot start another session', async () => {
  const f = fixture()
  const first = executeBatch(f.sender, 'same-id', f.id, 'SELECT 1;')
  await assert.rejects(executeBatch(f.sender, 'same-id', f.id, 'SELECT 2;'), /重复/)
  await first
})
test('malformed selection is rejected before any statement executes', async () => {
  const f = fixture()
  await assert.rejects(f.run("CREATE TABLE bad(v); SELECT 'unfinished"), /不完整/)
  const result = await f.run("SELECT name FROM sqlite_master WHERE name='bad';")
  assert.equal(result.results[0].rowCount, 0)
})

for (const [dialect, env, username, slowSQL] of [
  ['mysql', 'NEXSQL_TEST_MYSQL_PORT', 'root', 'SELECT SLEEP(30)'],
  ['postgresql', 'NEXSQL_TEST_PG_PORT', 'postgres', 'SELECT pg_sleep(30)']
]) {
  const port = Number(process.env[env])
  function remote() {
    const f = fixture()
    configs[f.id] = {
      id: f.id,
      type: dialect,
      host: '127.0.0.1',
      port,
      username,
      password: 'nexsql_test_only',
      database: 'nexsql_test'
    }
    return f
  }
  test(
    `${dialect}: selected script session and continuation after a statement error`,
    { skip: !port, timeout: 15000 },
    async () => {
      const f = remote()
      const result = await f.run(
        'CREATE TEMPORARY TABLE t(v INT); INSERT INTO t VALUES (1); SELECT * FROM t; SELECT * FROM missing_table; INSERT INTO t VALUES(2); SELECT * FROM t ORDER BY v;'
      )
      assert.equal(result.status, 'failed')
      assert.equal(result.results.length, 6)
      assert.equal(result.failedStatements, 1)
      assert.match(result.results[3].error, /missing_table/)
      assert.equal(result.results[2].rows[0].v, 1)
      assert.deepEqual(result.results[5].rows, [{ v: 1 }, { v: 2 }])
    }
  )
  test(
    `${dialect}: transaction recovery statements still run after an error`,
    { skip: !port, timeout: 15000 },
    async () => {
      const f = remote()
      const result = await f.run(
        'BEGIN; SELECT * FROM missing_table; SELECT 7 AS n; ROLLBACK; SELECT 9 AS n;'
      )
      assert.equal(result.status, 'failed')
      assert.equal(result.results.length, 5)
      assert.equal(result.failedStatements, dialect === 'postgresql' ? 2 : 1)
      assert.equal(result.results[3].error, undefined)
      assert.equal(result.results[4].rows[0].n, 9)
      assert.equal(result.warning, undefined)
    }
  )
  test(
    `${dialect}: server-side cancellation stops remaining statements and leaves connection usable`,
    { skip: !port, timeout: 15000 },
    async () => {
      const f = remote(),
        id = `remote-cancel-${dialect}`
      let timer
      f.sender.send = (_channel, p) => {
        if (p.index === 0) timer = setTimeout(() => cancelQuery(id, f.sender.id), 200)
      }
      const result = await executeBatch(
        f.sender,
        id,
        f.id,
        `SELECT * FROM missing_table; ${slowSQL}; SELECT 99;`
      )
      clearTimeout(timer)
      assert.equal(result.status, 'cancelled')
      assert.ok(result.durationMs < 10000)
      assert.ok(!result.results.some((r) => r.sql.includes('99')))
      const next = await f.run('SELECT 7 AS n;')
      assert.equal(next.results[0].rows[0].n, 7)
    }
  )
  test(
    `${dialect}: database selection stays isolated between concurrent runs`,
    { skip: !port, timeout: 15000 },
    async () => {
      const f = remote()
      const alternate = dialect === 'mysql' ? 'information_schema' : 'postgres'
      const fn = dialect === 'mysql' ? 'DATABASE()' : 'current_database()'
      const [one, two] = await Promise.all([
        executeBatch(f.sender, `db-main-${dialect}`, f.id, `SELECT ${fn} AS db;`, 'nexsql_test'),
        executeBatch(f.sender, `db-alt-${dialect}`, f.id, `SELECT ${fn} AS db;`, alternate)
      ])
      assert.equal(one.results[0].rows[0].db, 'nexsql_test')
      assert.equal(two.results[0].rows[0].db, alternate)
    }
  )
}
test(
  'mysql: custom delimiter procedure exposes every result set',
  { skip: !process.env.NEXSQL_TEST_MYSQL_PORT },
  async () => {
    const f = fixture()
    configs[f.id] = {
      id: f.id,
      type: 'mysql',
      host: '127.0.0.1',
      port: Number(process.env.NEXSQL_TEST_MYSQL_PORT),
      username: 'root',
      password: 'nexsql_test_only',
      database: 'nexsql_test'
    }
    const result = await f.run(
      'DROP PROCEDURE IF EXISTS nexsql_test_proc;\nDELIMITER $$\nCREATE PROCEDURE nexsql_test_proc() BEGIN SELECT 1 AS a; SELECT 2 AS b; END$$\nDELIMITER ;\nCALL nexsql_test_proc(); DROP PROCEDURE nexsql_test_proc;'
    )
    assert.equal(result.status, 'completed', result.error)
    assert.ok(result.results.some((r) => r.rows[0]?.a === 1))
    assert.ok(result.results.some((r) => r.rows[0]?.b === 2))
  }
)

test('open transaction is rolled back and explicitly reported even on successful SQL', async () => {
  const f = fixture()
  await f.run('CREATE TABLE t(v);')
  const result = await f.run('BEGIN; INSERT INTO t VALUES(1);')
  assert.equal(result.status, 'completed')
  assert.match(result.warning, /未提交事务/)
  assert.equal((await f.run('SELECT COUNT(*) AS n FROM t')).results[0].rows[0].n, 0)
})
test('timeout reports its cause and stops a native query', { timeout: 10000 }, async () => {
  const f = fixture()
  const result = await executeBatch(
    f.sender,
    'timeout',
    f.id,
    'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT SUM(x) FROM n',
    'main',
    500
  )
  assert.equal(result.status, 'cancelled')
  assert.match(result.error, /时限/)
})
test('invalid timeout is rejected before starting an execution', async () => {
  const f = fixture()
  await assert.rejects(executeBatch(f.sender, 'bad-timeout', f.id, 'SELECT 1', 'main', -1), /超时/)
})

test('large result payload is delivered completely before worker disconnects', async () => {
  const f = fixture()
  const result = await f.run(
    'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5000) SELECT x AS id, hex(zeroblob(100)) AS payload FROM n; SELECT 42 AS answer;'
  )
  assert.equal(result.status, 'completed', result.error)
  assert.equal(result.results[0].rows.length, 5000)
  assert.equal(result.results[0].rows[4999].id, 5000)
  assert.equal(result.results[1].rows[0].answer, 42)
})

test('copied INSERT round-trips SQLite values', async () => {
  const { insertStatements } = loadTS(
    path.join(root, 'src/renderer/src/components/results/resultData.ts')
  )
  const f = fixture()
  const rows = [["O'Reilly 中文\\path\nnext", null, '', new Uint8Array([0, 255])]]
  const sql = insertStatements(
    ['text', 'nullable', 'empty', 'bytes'],
    rows,
    'copy test',
    '',
    'sqlite'
  )
  const result = await f.run(
    'CREATE TABLE "copy test" (text, nullable, empty, bytes);' +
      sql +
      ' SELECT text, nullable, empty, hex(bytes) AS bytes FROM "copy test";'
  )
  assert.equal(result.status, 'completed', result.error)
  assert.deepEqual(result.results[2].rows, [
    { text: rows[0][0], nullable: null, empty: '', bytes: '00FF' }
  ])
})

test('export SQL round-trips table DDL, text, NULL, boolean and binary in a single import session', async () => {
  const utils = loadTS(path.join(root, '../../packages/shared/src/utils.ts'))
  const { buildExportInsert, terminateDDL } = loadTS(
    path.join(root, '../../packages/shared/src/sqlExport.ts'),
    { './utils': utils }
  )
  const f = fixture()
  const row = {
    id: 1,
    text: "O'Reilly\n中文\\path",
    empty: '',
    nullable: null,
    flag: true,
    bytes: new Uint8Array([0, 255])
  }
  const sql =
    terminateDDL(
      'CREATE TABLE records (id INTEGER PRIMARY KEY, text TEXT, empty TEXT, nullable TEXT, flag INTEGER, bytes BLOB)'
    ) +
    '\n' +
    buildExportInsert('sqlite', 'records', Object.keys(row), row)
  const imported = await f.run(sql + '; SELECT *, hex(bytes) AS hex FROM records;')
  assert.equal(imported.status, 'completed', imported.error)
  const actual = imported.results.at(-1).rows[0]
  assert.equal(actual.text, row.text)
  assert.equal(actual.nullable, null)
  assert.equal(actual.empty, '')
  assert.equal(actual.flag, 1)
  assert.equal(actual.hex, '00FF')
})
