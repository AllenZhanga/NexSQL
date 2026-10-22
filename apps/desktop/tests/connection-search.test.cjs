const { test } = require('node:test'),
  assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  Module = require('node:module')
const file = path.resolve(__dirname, '../src/renderer/src/components/sidebar/connectionSearch.ts')
const m = new Module(file, module)
m._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  file
)
const { matchingConnections, connectionAddress } = m.exports
const fixtures = [
  {
    id: 'one',
    type: 'mysql',
    name: '华中 · 生产',
    host: 'DB-A.example.invalid',
    port: 3307,
    group: '生产环境',
    tags: ['PROD', '财务'],
    ssh: { host: 'private-jump', password: 'private-secret' }
  },
  {
    id: 'two',
    type: 'postgresql',
    name: '华中 · 测试',
    host: 'db-b.example.invalid',
    port: 5432,
    group: '测试环境',
    tags: ['TEST']
  },
  { id: 'three', type: 'sqlite', name: '本地', filePath: '/tmp/demo.db' }
]
test('connection search matches metadata across fields with AND terms, Unicode normalization and case-insensitivity', () => {
  assert.deepEqual(
    matchingConnections(fixtures, '华中 ＰＲＯＤ 3307').map((c) => c.id),
    ['one']
  )
  assert.deepEqual(
    matchingConnections(fixtures, 'db-a 财务 生产环境').map((c) => c.id),
    ['one']
  )
  assert.deepEqual(
    matchingConnections(fixtures, '华中 测试 TEST').map((c) => c.id),
    ['two']
  )
  assert.deepEqual(
    matchingConnections(fixtures, 'demo.db').map((c) => c.id),
    ['three']
  )
  assert.deepEqual(matchingConnections(fixtures, '财务 TEST'), [])
})
test('search excludes credentials, preserves source order and leaves source objects unchanged', () => {
  const before = JSON.stringify(fixtures)
  assert.equal(matchingConnections(fixtures, '  '), fixtures)
  assert.deepEqual(
    matchingConnections(fixtures, '华中').map((c) => c.id),
    ['one', 'two']
  )
  assert.deepEqual(matchingConnections(fixtures, 'private-secret'), [])
  assert.deepEqual(matchingConnections(fixtures, 'private-jump'), [])
  assert.equal(JSON.stringify(fixtures), before)
})
test('connection addresses distinguish endpoints and preserve SQLite paths and IPv6 syntax', () => {
  assert.equal(connectionAddress(fixtures[0]), 'DB-A.example.invalid:3307')
  assert.equal(connectionAddress(fixtures[2]), '/tmp/demo.db')
  assert.equal(connectionAddress({ type: 'redis', host: '::1' }), '[::1]:6379')
  assert.equal(connectionAddress({ type: 'postgresql' }), 'localhost:5432')
})
