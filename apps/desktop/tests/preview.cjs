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
const transactionWorker = path.join(temp, 'transaction.cjs')
fs.writeFileSync(
  transactionWorker,
  `const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
process.once('message', ({ filePath, statements }) => {
  const db = new Database(filePath); let result;
  try { db.pragma('foreign_keys = ON'); db.transaction(() => { for (const sql of statements) db.prepare(sql).run(); })(); result = {success:true}; }
  catch (error) { result = {success:false,message:error.message}; }
  finally { db.close(); }
  process.send(result, () => process.disconnect());
});`
)
async function transact(statements, database) {
  return new Promise((resolve, reject) => {
    const worker = fork(transactionWorker, [], {
      execPath: require('electron'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    const timer = setTimeout(() => {
      worker.kill()
      reject(new Error('Preview transaction timed out'))
    }, 10000)
    worker.once('message', (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.send({ filePath: configs.get(configId(database)).filePath, statements })
  })
}
const config = {
  id: 'preview-sqlite',
  name: '产品演示 · SQLite',
  type: 'sqlite',
  filePath: path.join(temp, 'demo.db'),
  database: 'main',
  group: '本地开发'
}
// Optional multi-database fixture uses separate disposable SQLite files.
const demoNames = process.env.NEXSQL_PREVIEW_SCHEMA_DEMO
  ? ['main', 'tenant_a', 'tenant_b']
  : ['main']
const configId = (database) =>
  !database || database === 'main' ? config.id : `${config.id}-${database}`
const configs = new Map(
  demoNames.map((database) => [
    configId(database),
    {
      ...config,
      id: configId(database),
      database,
      filePath: database === 'main' ? config.filePath : path.join(temp, database + '.db')
    }
  ])
)
function load(file, overrides, filename = file) {
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
const parser = load(path.join(root, '../../packages/shared/src/sqlStatements.ts'), {})
const connectionImporter = load(path.join(root, 'src/main/db/ConnectionImport.ts'), {
  '@shared/ssh': load(path.join(root, '../../packages/shared/src/ssh.ts'), {}),
  '@shared/types/connectionImport': load(path.join(root, '../../packages/shared/src/types/connectionImport.ts'), {})
})
// Optional bulk sidebar fixture contains synthetic metadata only; only SQLite can connect.
const importedConnections = process.env.NEXSQL_PREVIEW_CONNECTIONS
  ? Array.from({ length: Math.min(1000, Math.max(0, Number(process.env.NEXSQL_PREVIEW_CONNECTIONS) || 0)) }, (_, i) => ({
      id: `sidebar-demo-${i}`, name: `租户 ${String(i + 1).padStart(3, '0')} · ${i % 2 ? '测试' : '生产'}`,
      type: 'mysql', host: `db-${i + 1}.example.test`, port: 3306,
      group: i < 60 ? '生产环境' : '测试环境', tags: i % 2 ? ['TEST'] : ['PROD'],
      createdAt: 1, updatedAt: 1
    }))
  : []
function publicConnection(form) {
  const { password, ssh, ...fields } = form
  if (!ssh) return fields
  const { password: sshPassword, passphrase, ...sshFields } = ssh
  return { ...fields, ssh: { ...sshFields, hasPassword: !!sshPassword || !!ssh.hasPassword, hasPassphrase: !!passphrase || !!ssh.hasPassphrase } }
}
const runner = load(
  path.join(root, 'src/main/db/QueryRunner.ts'),
  {
    './ConnectionManager': {
      getConnectionRuntimeConfig: (id) => {
        const found = configs.get(id)
        if (!found) throw new Error('Unknown preview database')
        return found
      },
      getConnectionPassword: () => ''
    },
    './QueryExecutor': { saveHistory: () => {} },
    './SSHTunnel': { prepareConnection: async config => ({config, close() {}, getError: () => undefined}) },
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
const run = (sql, database = 'main') =>
  runner.executeBatch(
    sender,
    require('node:crypto').randomUUID(),
    configId(database),
    sql,
    database
  )
const bridge = `<script>
const events = new EventSource('/events'); const listeners = new Set(); events.onmessage = e => listeners.forEach(fn => fn(JSON.parse(e.data)));
const rpc = async (method, args=[]) => { const response = await fetch('/api', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})}); const value=await response.json(); if(value.error) throw new Error(value.error); return value.result; };
window.db = new Proxy({onRefreshData: () => () => {}, onQueryProgress: fn => {listeners.add(fn); return () => listeners.delete(fn)}}, {get: (target,key) => target[key] || ((...args) => rpc(key,args))});
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
      if (method === 'listConnections') result = [config, ...importedConnections]
      else if (method === 'addConnection') {
        result = { ...publicConnection(args[0]), id: require('node:crypto').randomUUID(), createdAt: Date.now(), updatedAt: Date.now() }
        importedConnections.push(result)
      }
      else if (method === 'updateConnection') {
        const index = importedConnections.findIndex(conn => conn.id === args[0])
        if (index < 0) throw new Error('演示连接只读')
        result = { ...importedConnections[index], ...publicConnection(args[1]), updatedAt: Date.now() }
        importedConnections[index] = result
      }
      else if (method === 'testConnection') throw new Error('预览模式不建立外部连接，请在桌面应用中测试')
      else if (method === 'previewConnectionImport') result = connectionImporter.parseConnectionImport(args[0], [config, ...importedConnections]).preview
      else if (method === 'importConnections') {
        const {preview, forms} = connectionImporter.parseConnectionImport(args[0], [config, ...importedConnections])
        const selected = new Set(args[1] ?? preview.entries.filter(entry => entry.status === 'ready').map(entry => entry.index))
        const ready = preview.entries.filter(entry => selected.has(entry.index) && entry.status === 'ready')
        for (const entry of ready) {
          importedConnections.push({...publicConnection(forms[entry.index]), id:require('node:crypto').randomUUID(), createdAt:Date.now(), updatedAt:Date.now()})
        }
        result = ready.length
      }
      else if (method === 'connect' || method === 'disconnect') {
        if (args[0] !== config.id) throw new Error('预览模式不连接外部数据库')
        result = null
      }
      else if (method === 'getDatabases') result = demoNames
      else if (method === 'getHistory') result = []
      else if (method === 'executeBatch')
        result = await runner.executeBatch(
          sender,
          args[0],
          configId(args[3]),
          args[2],
          args[3],
          args[4]
        )
      else if (method === 'cancelQuery') result = runner.cancelQuery(args[0], sender.id)
      else if (method === 'executeTransaction') result = await transact(args[1], args[2])
      else if (method === 'executeQuery') result = (await run(args[1], args[2])).results.at(-1)
      else if (method === 'getTableColumns') {
        const name = String(args[1]).replace(/'/g, "''")
        result = (await run(`PRAGMA table_info('${name}')`, args[2])).results[0].rows.map((r) => ({
          name: r.name,
          type: r.type,
          nullable: !r.notnull,
          primaryKey: !!r.pk,
          defaultValue: r.dflt_value
        }))
      } else if (method === 'getTableDDL') {
        const name = String(args[1]).replace(/'/g, "''")
        result = (await run(`SELECT sql FROM sqlite_master WHERE name='${name}'`, args[2]))
          .results[0].rows[0]?.sql
      } else if (method === 'getTableIndexes') result = []
      else if (method === 'getSchema') {
        const database = args[1] ?? undefined
        console.log(`[schema] ${database === undefined ? '(catalog only)' : database}`)
        if (database === undefined) {
          result = {
            connectionId: config.id,
            databases: demoNames.map((name) => ({ name, tables: [], tablesLoaded: false }))
          }
        } else {
          const tables = (
            await run(
              "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
              database
            )
          ).results[0].rows
          result = {
            connectionId: config.id,
            databases: [
              {
                name: database,
                tablesLoaded: true,
                tables: tables.map((t) => ({ ...t, columns: [] }))
              }
            ]
          }
        }
      } else throw new Error('预览中未开放此操作')
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
Promise.all(
  demoNames.map((database) =>
    run(
      database === 'main'
        ? "CREATE TABLE orders(id INTEGER PRIMARY KEY, customer TEXT, amount REAL, status TEXT, created_at TEXT); INSERT INTO orders VALUES(1001,'陈佳',268.00,'已完成','2026-09-15 09:30:00'),(1002,'林远',1280.50,'待发货','2026-09-15 10:12:00'),(1003,'周宁',89.90,'已完成','2026-09-15 11:05:00');"
        : database === 'tenant_a'
          ? 'CREATE TABLE a_orders(id INTEGER PRIMARY KEY, note TEXT); CREATE TABLE a_customers(id INTEGER);'
          : 'CREATE TABLE b_reports(id INTEGER PRIMARY KEY); CREATE TABLE b_events(id INTEGER);',
      database
    )
  )
)
  .then((results) => {
    const result = results.find((result) => result.status !== 'completed') ?? results[0]
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
