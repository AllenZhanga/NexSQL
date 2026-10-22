const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module')
const net = require('node:net'),
  crypto = require('node:crypto'),
  ts = require('typescript')
const { Server, utils } = require('ssh2')
const root = path.resolve(__dirname, '..')
function load(file, overrides = {}, filename = file) {
  const m = new Module(filename, module)
  m.filename = filename
  m.paths = module.paths
  m.require = (name) => overrides[name] ?? require(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText,
    filename
  )
  return m.exports
}
const sharedSSH = load(path.join(root, '../../packages/shared/src/ssh.ts'))
const hostPrivate = crypto
  .generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
const hostPublic = utils.parseKey(hostPrivate).getPublicSSH()
function tunnelModule(verify = async (_host, _port, key) => key.equals(hostPublic)) {
  return load(path.join(root, 'src/main/db/SSHTunnel.ts'), {
    '@shared/ssh': sharedSSH,
    './SSHHostKeys': { verifySSHHostKey: verify }
  })
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}
async function fixture(options = {}) {
  const channels = new Set(),
    clients = new Set(),
    destinations = [],
    backends = new Set()
  const echo = net.createServer((socket) => {
    backends.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => backends.delete(socket))
    socket.pipe(socket)
  })
  const backendPort = options.backendPort ?? (await listen(echo))
  const server = new Server({ hostKeys: [hostPrivate] }, (client) => {
    clients.add(client)
    client.on('error', () => {})
    client.once('close', () => clients.delete(client))
    client.on('authentication', (ctx) => {
      if (options.holdAuth && ctx.method !== 'none') return
      if (ctx.username !== 'jump') return ctx.reject()
      if (ctx.method === 'password' && ctx.password === 'test-pass') return ctx.accept()
      if (ctx.method === 'publickey' && options.publicKey) {
        const key = utils.parseKey(options.publicKey)
        if (
          ctx.key.data.equals(key.getPublicSSH()) &&
          (!ctx.signature || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)
        )
          return ctx.accept()
      }
      ctx.reject(['password', 'publickey'])
    })
    client.on('tcpip', (accept, reject, info) => {
      destinations.push({ host: info.destIP, port: info.destPort })
      if (options.rejectForward) return reject()
      const target = net.connect(backendPort, '127.0.0.1')
      backends.add(target)
      target.on('error', () => target.destroy())
      target.once('close', () => backends.delete(target))
      const channel = accept()
      channels.add(channel)
      channel.on('error', () => target.destroy())
      channel.once('close', () => {
        channels.delete(channel)
        target.destroy()
      })
      target.once('close', () => channel.end())
      channel.pipe(target).pipe(channel)
    })
  })
  const port = await listen(server)
  return {
    port,
    clients,
    channels,
    destinations,
    config: {
      id: 'ssh-test',
      name: 'ssh test',
      type: 'mysql',
      host: 'db.internal.invalid',
      port: 3306,
      createdAt: 1,
      updatedAt: 1,
      ssh: {
        host: '127.0.0.1',
        port,
        username: 'jump',
        password: 'test-pass',
        authMethod: 'password'
      }
    },
    close: async () => {
      for (const channel of channels) channel.destroy()
      for (const socket of backends) socket.destroy()
      for (const client of clients) client.end()
      await new Promise((resolve) => server.close(resolve))
      if (echo.listening) await new Promise((resolve) => echo.close(resolve))
    }
  }
}
async function roundTrip(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1'),
      chunks = []
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Round trip timed out'))
    }, 3000)
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      if (Buffer.concat(chunks).length >= Buffer.byteLength(text)) {
        clearTimeout(timer)
        resolve(Buffer.concat(chunks).toString())
        socket.end()
      }
    })
    socket.once('connect', () => socket.write(text))
  })
}
module.exports = { load, root, sharedSSH, fixture, tunnelModule, roundTrip, listen }
