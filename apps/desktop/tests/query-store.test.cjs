const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
function fixture(options = {}) {
  const connectionState = options.connectionState ?? { connections: [], statuses: {} }
  const values = new Map()
  global.localStorage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k)
  }
  let resolve,
    calls = 0,
    listener,
    cancelled = []
  global.window = {
    db: {
      onQueryProgress: (fn) => {
        listener = fn
        return () => {
          listener = null
        }
      },
      executeBatch: () => {
        calls++
        return new Promise((r) => (resolve = r))
      },
      cancelQuery: async (id) => {
        cancelled.push(id)
        return true
      }
    }
  }
  const filename = path.resolve(__dirname, '../src/renderer/src/stores/queryStore.ts')
  const m = new Module(filename, module)
  m.filename = filename
  m.paths = module.paths
  m.require = (name) =>
    name === './connectionStore'
      ? { useConnectionStore: { getState: () => connectionState } }
      : require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    filename
  )
  const store = m.exports.useQueryStore
  return {
    store,
    connectionState,
    values,
    calls: () => calls,
    cancelled,
    done: (result) => resolve(result),
    progress: (p) => listener(p)
  }
}
const result = { results: [], totalStatements: 2, durationMs: 10, status: 'completed' }
test('duplicate run is prevented and cannot close a running tab', async () => {
  const f = fixture(),
    s = f.store.getState(),
    id = s.newTab('connection')
  s.updateTabSQL(id, 'SELECT 1; SELECT 2;')
  const first = s.executeQuery(id)
  await s.executeQuery(id)
  assert.equal(f.calls(), 1)
  s.closeTab(id)
  assert.equal(f.store.getState().tabs.length, 1)
  f.done(result)
  await first
  s.closeTab(id)
  assert.equal(f.store.getState().tabs.length, 0)
})
test('cancellation retains running state until process reports completion', async () => {
  const f = fixture(),
    s = f.store.getState(),
    id = s.newTab('connection')
  s.updateTabSQL(id, 'SELECT 1;')
  const pending = s.executeQuery(id)
  await s.cancelQuery(id)
  assert.equal(f.store.getState().tabs[0].isLoading, true)
  assert.equal(f.store.getState().tabs[0].isCancelling, true)
  await s.cancelQuery(id)
  assert.equal(f.cancelled.length, 1)
  f.done({ ...result, status: 'cancelled' })
  await pending
  assert.equal(f.store.getState().tabs[0].isLoading, false)
})
test('edits during execution remain intact when results arrive', async () => {
  const f = fixture(),
    s = f.store.getState(),
    id = s.newTab('connection')
  s.updateTabSQL(id, 'SELECT 1;')
  const pending = s.executeQuery(id)
  s.updateTabSQL(id, 'SELECT 2;')
  f.done(result)
  await pending
  assert.equal(f.store.getState().tabs[0].sql, 'SELECT 2;')
})
test('progress for other requests cannot contaminate the active run', async () => {
  const f = fixture(),
    s = f.store.getState(),
    id = s.newTab('connection')
  s.updateTabSQL(id, 'SELECT 1;')
  const pending = s.executeQuery(id)
  f.progress({ executionId: 'unrelated', result: { sql: 'wrong' } })
  assert.equal(f.store.getState().tabs[0].batch, undefined)
  f.done(result)
  await pending
})
test('draft storage excludes results, busy state and data editing buffers', async () => {
  const f = fixture(),
    s = f.store.getState(),
    id = s.newTab('connection')
  s.updateTabSQL(id, 'SELECT 1;')
  s.patchTab(id, { result: { rows: [{ secret: 'data' }] }, isLoading: true })
  const saved = JSON.parse(f.values.get('nexsql-query-drafts-v1')).state
  assert.equal(saved.tabs[0].sql, 'SELECT 1;')
  assert.equal(saved.tabs[0].result, null)
  assert.equal(saved.tabs[0].isLoading, false)
})

function schemaFixture() {
  const f = fixture({
    connectionState: { connections: [{ id: 'c', type: 'mysql' }], statuses: { c: 'connected' } }
  })
  const requests = []
  window.db.getSchema = (connectionId, database) =>
    new Promise((resolve, reject) => requests.push({ database, resolve, reject }))
  return { ...f, requests, key: (db) => JSON.stringify(['c', db ?? null]) }
}
const databaseList = (names) => ({
  connectionId: 'c',
  databases: names.map((name) => ({ name, tables: [], tablesLoaded: false }))
})
const tableList = (name, tables = ['orders']) => ({
  connectionId: 'c',
  databases: [
    {
      name,
      tables: tables.map((name) => ({ name, type: 'table', columns: [] })),
      tablesLoaded: true
    }
  ]
})

test('schema lists databases without eager table loads, and caches only requested databases', async () => {
  const f = schemaFixture(),
    s = f.store.getState()
  const list = s.loadSchema('c')
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].database, undefined)
  f.requests[0].resolve(databaseList(['a', 'b']))
  await list
  const selected = s.loadSchema('c', 'a', false)
  assert.equal(f.requests[1].database, 'a')
  f.requests[1].resolve(tableList('a'))
  await selected
  await s.loadSchema('c', 'a', false)
  assert.equal(f.requests.length, 2)
  const dbs = f.store.getState().schema.c.databases
  assert.equal(dbs[0].tablesLoaded, true)
  assert.equal(dbs[1].tablesLoaded, false)
  assert.deepEqual(dbs[1].tables, [])
})
test('schema requests for the same database are deduplicated while loading', async () => {
  const f = schemaFixture(),
    s = f.store.getState()
  const one = s.loadSchema('c', 'a', false),
    two = s.loadSchema('c', 'a', false)
  assert.equal(f.requests.length, 1)
  assert.equal(f.store.getState().schemaLoading[f.key('a')], true)
  f.requests[0].resolve(tableList('a', []))
  await Promise.all([one, two])
  await s.loadSchema('c', 'a', false)
  assert.equal(f.requests.length, 1, 'an empty loaded database must be cached too')
  assert.equal(f.store.getState().schemaLoading[f.key('a')], false)
})
test('out-of-order database loads merge rather than replacing the entire catalog', async () => {
  const f = schemaFixture(),
    s = f.store.getState()
  const list = s.loadSchema('c')
  f.requests[0].resolve(databaseList(['a', 'b']))
  await list
  const a = s.loadSchema('c', 'a', false),
    b = s.loadSchema('c', 'b', false)
  f.requests[2].resolve(tableList('b', ['b_table']))
  await b
  f.requests[1].resolve(tableList('a', ['a_table']))
  await a
  assert.deepEqual(
    f.store.getState().schema.c.databases.map((db) => [db.name, db.tables[0].name]),
    [
      ['a', 'a_table'],
      ['b', 'b_table']
    ]
  )
})
test('refreshing database names preserves loaded tables and removes dropped databases', async () => {
  const f = schemaFixture(),
    s = f.store.getState()
  const a = s.loadSchema('c', 'a')
  f.requests[0].resolve(tableList('a'))
  await a
  const list = s.loadSchema('c')
  f.requests[1].resolve(databaseList(['a', 'b']))
  await list
  assert.equal(f.store.getState().schema.c.databases[0].tables[0].name, 'orders')
  const refresh = s.loadSchema('c')
  f.requests[2].resolve(databaseList(['b']))
  await refresh
  assert.deepEqual(
    f.store.getState().schema.c.databases.map((db) => db.name),
    ['b']
  )
})
test('explicit table refresh bypasses cache and metadata failures remain retryable', async () => {
  const f = schemaFixture(),
    s = f.store.getState()
  const first = s.loadSchema('c', 'a', false)
  f.requests[0].reject(new Error('access denied'))
  await first
  assert.match(f.store.getState().schemaErrors[f.key('a')], /access denied/)
  const retry = s.loadSchema('c', 'a', false)
  f.requests[1].resolve(tableList('a'))
  await retry
  assert.equal(f.store.getState().schemaErrors[f.key('a')], undefined)
  const refresh = s.loadSchema('c', 'a')
  f.requests[2].resolve(tableList('a', ['new_table']))
  await refresh
  assert.equal(f.store.getState().schema.c.databases[0].tables[0].name, 'new_table')
})
test('disconnect invalidation prevents stale responses from replacing reconnected metadata', async () => {
  const f = schemaFixture(),
    s = f.store.getState()
  const old = s.loadSchema('c', 'a')
  s.clearSchema('c')
  const fresh = s.loadSchema('c', 'a')
  f.requests[1].resolve(tableList('a', ['fresh_table']))
  await fresh
  f.requests[0].resolve(tableList('a', ['stale_table']))
  await old
  assert.equal(f.store.getState().schema.c.databases[0].tables[0].name, 'fresh_table')
  assert.equal(f.store.getState().schemaLoading[f.key('a')], false)
})
test('disconnected connections never fetch schema', async () => {
  const f = schemaFixture()
  f.connectionState.statuses.c = 'disconnected'
  await f.store.getState().loadSchema('c', 'a')
  assert.equal(f.requests.length, 0)
})
