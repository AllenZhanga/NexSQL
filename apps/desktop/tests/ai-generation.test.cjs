const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
function fixture() {
  const handlers = {},
    captured = [],
    values = new Map([['ai_config', JSON.stringify({ provider: 'openai', apiKey: 'test-key' })]])
  class Store {
    exec() {}
    close() {}
    prepare() {
      return {
        get: (key) => (values.has(key) ? { value: values.get(key) } : undefined),
        run: (key, value) => values.set(key, value)
      }
    }
  }
  class Provider {
    async generateSQL(context, request) {
      captured.push({ context, request })
      return '```sql\nSELECT id FROM orders;\n```'
    }
  }
  const fake = {
    electron: {
      app: { getPath: () => '/unused' },
      ipcMain: { handle: (key, fn) => (handlers[key] = fn) },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from('encrypted:' + value),
        decryptString: (buffer) => buffer.toString().replace('encrypted:', '')
      }
    },
    'better-sqlite3': { default: Store },
    '../db/QueryExecutor': {
      getSchema: async () => ({
        databases: [{ name: 'example', tables: [{ name: 'orders', columns: [] }] }]
      }),
      getTableColumns: async () => [
        { name: 'id', type: 'integer', primaryKey: true, nullable: false }
      ]
    },
    '../db/ConnectionManager': {
      getConnectionConfig: () => ({ type: 'mysql', database: 'example' })
    },
    '../ai/SchemaContextBuilder': { buildSchemaContext: (schema) => JSON.stringify(schema) },
    '../ai/OpenAIProvider': { OpenAIProvider: Provider },
    '../ai/OllamaProvider': { OllamaProvider: Provider }
  }
  const filename = path.resolve(__dirname, '../src/main/ipc/aiHandlers.ts'),
    m = new Module(filename, module)
  m.filename = filename
  m.paths = module.paths
  m.require = (name) => fake[name] ?? require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    filename
  )
  m.exports.registerAiHandlers()
  return { handlers, captured, values }
}
test('only SQL generation and its configuration IPC are registered', () => {
  assert.deepEqual(Object.keys(fixture().handlers).sort(), [
    'ai:generateSQL',
    'ai:getConfig',
    'ai:updateConfig'
  ])
})
test('generation includes real columns and connection dialect, and strips code fences', async () => {
  const f = fixture()
  const sql = await f.handlers['ai:generateSQL'](
    {},
    { connectionId: 'test', question: '订单 ID', dialect: 'sql' }
  )
  assert.equal(sql, 'SELECT id FROM orders;')
  assert.match(f.captured[0].context, /"name":"id"/)
  assert.equal(f.captured[0].request.dialect, 'mysql')
})
test('model settings keep masked keys out of storage and encrypt new keys', async () => {
  const f = fixture()
  assert.equal(f.handlers['ai:getConfig']().apiKey, '••••••••')
  f.handlers['ai:updateConfig']({}, { apiKey: 'new-test-key' })
  const saved = JSON.parse(f.values.get('ai_config'))
  assert.equal(saved.apiKey, undefined)
  assert.ok(saved.encryptedApiKey)
  f.handlers['ai:updateConfig']({}, { apiKey: '••••••••', model: 'example' })
  assert.equal(JSON.parse(f.values.get('ai_config')).encryptedApiKey, saved.encryptedApiKey)
})
