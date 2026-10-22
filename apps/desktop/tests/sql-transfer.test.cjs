const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
function load(file, overrides = {}) {
  const m = new Module(file, module)
  m.require = (name) => overrides[name] ?? require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    file
  )
  return m.exports
}
const root = path.resolve(__dirname, '..')
const utils = load(path.join(root, '../../packages/shared/src/utils.ts'))
const serializers = load(path.join(root, '../../packages/shared/src/sqlExport.ts'), {
  './utils': utils
})
const { buildSQLExport } = load(
  path.join(root, 'src/renderer/src/components/transfer/sqlTransfer.ts'),
  { '@shared/sqlExport': serializers }
)
const { exportLiteral, terminateDDL } = serializers
function fixture() {
  const calls = []
  global.window = {
    db: {
      getSchema: async () => ({
        databases: [
          {
            name: 'chosen_db',
            tables: [
              { name: 'records', type: 'table' },
              { name: 'summary', type: 'view' }
            ]
          }
        ]
      }),
      getTableDDL: async (...args) => {
        calls.push(['ddl', ...args])
        return `CREATE TABLE "${args[1]}" (id INTEGER, text TEXT)`
      },
      executeBatch: async (...args) => {
        calls.push(['data', ...args])
        return {
          status: 'completed',
          results: [
            {
              columns: [{ name: 'id' }, { name: 'text' }],
              rows: [{ id: 1, text: "O'Reilly\n中文" }]
            }
          ]
        }
      }
    }
  }
  return calls
}
test('SQL export structure mode ends DDL and reads no data', async () => {
  const calls = fixture()
  const sql = await buildSQLExport('connection', 'chosen_db', 'sqlite', 'structure', ['records'])
  assert.match(sql, /CREATE TABLE "records".*;/)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['ddl', 'connection', 'records', 'chosen_db'])
  assert.doesNotMatch(sql, /INSERT INTO/)
})
test('SQL export data mode uses the chosen database on an isolated batch and escapes values', async () => {
  const calls = fixture()
  const sql = await buildSQLExport('connection', 'chosen_db', 'postgresql', 'data', ['records'])
  assert.equal(calls[0][0], 'data')
  assert.equal(calls[0][4], 'chosen_db')
  assert.equal(calls[0][3], 'SELECT * FROM "records";')
  assert.doesNotMatch(sql, /CREATE TABLE/)
  assert.match(sql, /INSERT INTO "records".*O''Reilly/)
})
test('full export includes DDL before inserts and skips view rows', async () => {
  const calls = fixture()
  const sql = await buildSQLExport('connection', 'chosen_db', 'sqlite', 'full')
  assert.ok(sql.indexOf('CREATE TABLE "records"') < sql.indexOf('INSERT INTO "records"'))
  assert.equal(calls.filter((c) => c[0] === 'data').length, 1)
  assert.doesNotMatch(sql, /INSERT INTO "summary"/)
})
test('missing selected tables and failed reads cannot silently create incomplete exports', async () => {
  fixture()
  await assert.rejects(buildSQLExport('c', 'chosen_db', 'sqlite', 'full', ['missing']), /不存在/)
  window.db.executeBatch = async () => ({ status: 'failed', results: [{ error: 'read denied' }] })
  await assert.rejects(
    buildSQLExport('c', 'chosen_db', 'sqlite', 'full', ['records']),
    /read denied/
  )
})
test('export literals preserve NULL, Unicode, boolean, bigint and binary by dialect', () => {
  assert.equal(exportLiteral(null, 'mysql'), 'NULL')
  assert.equal(exportLiteral(true, 'postgresql'), 'TRUE')
  assert.equal(exportLiteral('中文', 'mssql'), "N'中文'")
  assert.equal(exportLiteral(9007199254740993n, 'sqlite'), '9007199254740993')
  assert.equal(exportLiteral(new Uint8Array([0, 255]), 'postgresql'), "decode('00ff', 'hex')")
  assert.equal(exportLiteral('a\\b\n', 'mysql'), "CONVERT(X'615c620a' USING utf8mb4)")
  assert.throws(() => exportLiteral(9007199254740992, 'sqlite'), /不安全整数/)
  assert.throws(() => terminateDDL('-- DDL unavailable'), /建表语句/)
})

test('legacy table export scopes MySQL reads to selected database and terminates DDL', async () => {
  const calls = []
  const driver = {
    getTableDDL: async () => 'CREATE TABLE `records` (`id` INT)',
    getTables: async () => [{ name: 'records', type: 'table' }],
    useDatabase: async (db) => calls.push(['use', db]),
    execute: async (sql) => {
      calls.push(['query', sql])
      return { columns: [{ name: 'id' }], rows: [{ id: 1 }] }
    }
  }
  const executor = load(path.join(root, 'src/main/db/QueryExecutor.ts'), {
    electron: { app: {} },
    'better-sqlite3': {},
    '@shared/sqlExport': serializers,
    './ConnectionManager': {
      getDriver: () => driver,
      getConnectionConfig: () => ({ type: 'mysql', database: 'default_db' }),
      reconnectById: async () => {}
    },
    './types': {}
  })
  const sql = await executor.exportTableSQL('c', 'records', 'other`db')
  assert.match(sql, /CREATE TABLE.*;\n/)
  assert.deepEqual(calls, [
    ['use', 'other`db'],
    ['query', 'SELECT * FROM `other``db`.`records`']
  ])
  driver.getTables = async () => [{ name: 'records', type: 'view' }]
  calls.length = 0
  assert.doesNotMatch(await executor.exportTableSQL('c', 'records', 'other`db'), /INSERT/)
  assert.equal(calls.length, 0)
})

test('unsupported view definitions fail explicitly instead of exporting them as tables', async () => {
  fixture()
  await assert.rejects(
    buildSQLExport('c', 'chosen_db', 'postgresql', 'structure', ['summary']),
    /视图定义/
  )
})

test('connection schema catalog does not fan out table queries across databases', async () => {
  const calls = []
  const driver = {
    getDatabases: async () => Array.from({ length: 100 }, (_, i) => 'db_' + i),
    getTables: async (db) => {
      calls.push(db)
      return [{ name: 'orders', type: 'table' }]
    }
  }
  const executor = load(path.join(root, 'src/main/db/QueryExecutor.ts'), {
    electron: { app: {} },
    'better-sqlite3': {},
    '@shared/sqlExport': serializers,
    './ConnectionManager': {
      getDriver: () => driver,
      getConnectionConfig: () => ({ type: 'mysql', database: 'db_0' }),
      reconnectById: async () => {}
    },
    './types': {}
  })
  const catalog = await executor.getSchema('c')
  assert.equal(catalog.databases.length, 100)
  assert.deepEqual(calls, [])
  assert.ok(catalog.databases.every((db) => !db.tablesLoaded && db.tables.length === 0))
  const selected = await executor.getSchema('c', 'db_55')
  assert.deepEqual(calls, ['db_55'])
  assert.equal(selected.databases[0].tablesLoaded, true)
  assert.equal(selected.databases[0].tables[0].name, 'orders')
  driver.getTables = async () => {
    throw new Error('access denied')
  }
  await assert.rejects(executor.getSchema('c', 'db_99'), /access denied/)
})
