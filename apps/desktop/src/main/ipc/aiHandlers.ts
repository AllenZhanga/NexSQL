import { app, ipcMain, safeStorage } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import type { AIConfig, NLToSQLRequest } from '@shared/types/ai'
import { getSchema, getTableColumns } from '../db/QueryExecutor'
import { getConnectionConfig } from '../db/ConnectionManager'
import { buildSchemaContext } from '../ai/SchemaContextBuilder'
import { OpenAIProvider } from '../ai/OpenAIProvider'
import { OllamaProvider } from '../ai/OllamaProvider'

function db(): Database.Database {
  const store = new Database(join(app.getPath('userData'), 'nexsql.db'))
  store.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  return store
}
function getConfig(): AIConfig {
  const store = db()
  try {
    const row = store.prepare('SELECT value FROM settings WHERE key = ?').get('ai_config') as
      | { value: string }
      | undefined
    const config: AIConfig & { encryptedApiKey?: string } = row
      ? JSON.parse(row.value)
      : { provider: 'openai' }
    if (config.encryptedApiKey)
      config.apiKey = safeStorage.decryptString(Buffer.from(config.encryptedApiKey, 'base64'))
    delete config.encryptedApiKey
    return config
  } finally {
    store.close()
  }
}
export function registerAiHandlers(): void {
  ipcMain.handle('ai:getConfig', () => {
    const config = getConfig()
    return { ...config, apiKey: config.apiKey ? '••••••••' : '' }
  })
  ipcMain.handle('ai:updateConfig', (_event, partial: Partial<AIConfig>) => {
    const { apiKey, ...rest } = partial
    const current = getConfig()
    const updated = {
      ...current,
      ...rest,
      apiKey: apiKey === '••••••••' || apiKey === undefined ? current.apiKey : apiKey
    }
    const saved: AIConfig & { encryptedApiKey?: string } = { ...updated }
    if (saved.apiKey) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('系统安全存储不可用，无法保存 API Key')
      saved.encryptedApiKey = safeStorage.encryptString(saved.apiKey).toString('base64')
    }
    delete saved.apiKey
    const store = db()
    try {
      store
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('ai_config', JSON.stringify(saved))
    } finally {
      store.close()
    }
  })
  ipcMain.handle('ai:generateSQL', async (_event, request: NLToSQLRequest) => {
    const config = getConfig()
    if (config.provider === 'openai' && !config.apiKey)
      throw new Error('请先配置 SQL 生成模型和 API Key')
    let context = '-- No database selected'
    let dialect = 'sql'
    if (request.connectionId) {
      const connection = getConnectionConfig(request.connectionId)
      if (connection.type === 'redis') throw new Error('Redis 不支持生成 SQL')
      dialect = connection.type
      const schema = await getSchema(
        request.connectionId,
        request.databaseName || connection.database
      )
      // Load real columns: the schema tree intentionally only loads table names.
      for (const database of schema.databases) {
        if (request.tableHints?.length)
          database.tables = database.tables.filter((t) => request.tableHints!.includes(t.name))
        if (database.tables.length > 150)
          throw new Error('当前数据库超过 150 张表，请缩小数据库范围后生成 SQL')
        for (const table of database.tables)
          table.columns = await getTableColumns(request.connectionId, table.name, database.name)
      }
      context = buildSchemaContext(schema)
      if (context.length > 100000) throw new Error('数据库结构过大，请选择更小的数据库范围')
    }
    const provider =
      config.provider === 'ollama' ? new OllamaProvider(config) : new OpenAIProvider(config)
    const result = await provider.generateSQL(context, { ...request, dialect }, () => {})
    return result
      .replace(/^```(?:sql)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
  })
}
