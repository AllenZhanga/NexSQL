// Local-only UI verification with a disposable SQLite database. Never reads saved app connections.
const { createServer } = require('node:http')
const { EventEmitter } = require('node:events')
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  Module = require('node:module')
const ts = require('typescript'),
  { fork } = require('node:child_process')
const root = path.resolve(__dirname, '..'),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexsql-preview-'))
const config = {
  id: 'preview-sqlite',
  name: '产品演示 · SQLite',
  type: 'sqlite',
  filePath: path.join(temp, 'demo.db'),
  database: 'main',
  group: '本地开发'
}
function load(file, overrides, filename = file) {
  const m = new Module(filename, module)
  m.filename = filename
  m.paths = module.paths
  m.require = (name) => overrides[name] ?? require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    filename
  )
  return m.exports
}
const parser = load(path.join(root, '../../packages/shared/src/sqlStatements.ts'), {})
const runner = load(
  path.join(root, 'src/main/db/QueryRunner.ts'),
  {
    './ConnectionManager': { getConnectionConfig: () => config, getConnectionPassword: () => '' },
    './QueryExecutor': { saveHistory: () => {} },
    '@shared/sqlStatements': parser,
    'node:child_process': {
      fork: (file, args, options) => fork(file, args, { ...options, execPath: require('electron') })
    }
  },
  path.join(root, 'out/main/QueryRunner.preview.cjs')
)
const sender = new EventEmitter(),
  clients = new Set()
sender.id = 1
sender.isDestroyed = () => false
sender.send = (_channel, data) => {
  for (const res of clients) res.write(`data: ${JSON.stringify(data)}\n\n`)
}
const run = (sql) =>
  runner.executeBatch(sender, require('node:crypto').randomUUID(), config.id, sql, 'main')
const bridge = `<script>
const events = new EventSource('/events'); const listeners = new Set(); events.onmessage = e => listeners.forEach(fn => fn(JSON.parse(e.data)));
const rpc = async (method, args=[]) => { const response = await fetch('/api', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})}); const value=await response.json(); if(value.error) throw new Error(value.error); return value.result; };
window.db = new Proxy({onQueryProgress: fn => {listeners.add(fn); return () => listeners.delete(fn)}}, {get: (target,key) => target[key] || ((...args) => rpc(key,args))});
window.ai = {getConfig: async () => ({provider:'openai'}),generateSQL: async () => {throw new Error('预览未连接 AI 模型')}};
window.platform='preview';
</script>`
const server = createServer(async (req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.write('\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (req.url === '/api' && req.method === 'POST') {
    try {
      let body = ''
      for await (const part of req) body += part
      const { method, args } = JSON.parse(body)
      let result
      if (method === 'listConnections') result = [config]
      else if (method === 'connect' || method === 'disconnect') result = null
      else if (method === 'getDatabases') result = ['main']
      else if (method === 'getHistory') result = []
      else if (method === 'executeBatch') result = await runner.executeBatch(sender, ...args)
      else if (method === 'cancelQuery') result = runner.cancelQuery(args[0], sender.id)
      else if (method === 'executeQuery') result = (await run(args[1])).results.at(-1)
      else if (method === 'getTableColumns')
        result = (await run('PRAGMA table_info(orders)')).results[0].rows.map((r) => ({
          name: r.name,
          type: r.type,
          nullable: !r.notnull,
          primaryKey: !!r.pk
        }))
      else if (method === 'getSchema')
        result = {
          connectionId: config.id,
          databases: [{ name: 'main', tables: [{ name: 'orders', type: 'table', columns: [] }] }]
        }
      else throw new Error('预览中未开放此操作')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ result }))
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
    return
  }
  const relative = decodeURIComponent(req.url.split('?')[0])
  const file = path.resolve(
    root,
    'out/renderer',
    '.' + (relative === '/' ? '/index.html' : relative)
  )
  if (!file.startsWith(path.join(root, 'out/renderer') + path.sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  try {
    let data = fs.readFileSync(file)
    const ext = path.extname(file)
    if (ext === '.html') data = data.toString().replace('<head>', '<head>' + bridge)
    res.writeHead(200, {
      'Content-Type':
        { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' }[
          ext
        ] || 'application/octet-stream'
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
run(
  "CREATE TABLE orders(id INTEGER PRIMARY KEY, customer TEXT, amount REAL, status TEXT, created_at TEXT); INSERT INTO orders VALUES(1001,'陈佳',268.00,'已完成','2026-09-15 09:30:00'),(1002,'林远',1280.50,'待发货','2026-09-15 10:12:00'),(1003,'周宁',89.90,'已完成','2026-09-15 11:05:00');"
)
  .then((result) => {
    if (result.status !== 'completed') throw new Error(result.error)
    server.listen(4179, '127.0.0.1', () =>
      console.log('Isolated SQLite UI preview: http://127.0.0.1:4179')
    )
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
process.on('SIGINT', () => {
  sender.emit('destroyed')
  server.close()
  fs.rmSync(temp, { recursive: true, force: true })
  process.exit()
})
