const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
function fixture() {
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
      ? { useConnectionStore: { getState: () => ({ connections: [], statuses: {} }) } }
      : require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    filename
  )
  const store = m.exports.useQueryStore
  return {
    store,
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
