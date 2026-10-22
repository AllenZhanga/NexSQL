import type { DBType } from '@shared/types/connection'
import {
  buildExportInsert,
  quoteSQLIdentifier,
  terminateDDL,
  type ExportMode
} from '@shared/sqlExport'

export async function buildSQLExport(
  connectionId: string,
  database: string,
  dbType: DBType,
  mode: ExportMode,
  tableNames?: string[]
): Promise<string> {
  if (!window.db || dbType === 'redis') throw new Error('当前连接不支持 SQL 导出')
  const schema = await window.db.getSchema(connectionId, database)
  const available = schema.databases.find((db) => db.name === database)?.tables ?? []
  const tables = tableNames ? available.filter((t) => tableNames.includes(t.name)) : available
  if (tableNames?.some((name) => !tables.some((t) => t.name === name)))
    throw new Error('部分待导出的表已不存在，请刷新表清单。')
  if (!tables.length) throw new Error('没有可导出的表。')
  const chunks = [
    '-- NexSQL SQL Export',
    `-- Mode: ${mode}`,
    `-- Exported At: ${new Date().toISOString()}`,
    ''
  ]
  for (const table of tables) {
    chunks.push(
      `-- ${table.type === 'view' ? 'View' : 'Table'}: ${table.name.replace(/[\r\n]/g, ' ')}`
    )
    if (mode !== 'data') {
      if (table.type === 'view' && (dbType === 'postgresql' || dbType === 'mssql'))
        throw new Error('当前数据库暂不支持视图定义导出，请仅选择数据表。')
      chunks.push(terminateDDL(await window.db.getTableDDL(connectionId, table.name, database)))
    }
    if (mode !== 'structure' && table.type === 'table') {
      const batch = await window.db.executeBatch(
        crypto.randomUUID(),
        connectionId,
        `SELECT * FROM ${quoteSQLIdentifier(dbType, table.name)};`,
        database,
        300000
      )
      if (batch.status !== 'completed' || batch.results.some((r) => r.error))
        throw new Error(
          batch.results.find((r) => r.error)?.error ?? batch.error ?? '读取表数据失败'
        )
      const result = batch.results[0]
      if (!result) throw new Error('读取表数据未返回结果')
      for (const row of result.rows)
        chunks.push(
          buildExportInsert(
            dbType,
            table.name,
            result.columns.map((c) => c.name),
            row
          )
        )
    }
    chunks.push('')
  }
  return chunks.join('\n')
}
export function downloadText(name: string, text: string, type = 'text/sql;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[\\/:*?"<>|]/g, '_')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
