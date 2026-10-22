import type { DBType } from './types/connection'
import { formatDateTimeLocal } from './utils'

export type ExportMode = 'structure' | 'data' | 'full'
export function quoteSQLIdentifier(type: DBType, name: string): string {
  if (type === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  if (type === 'mssql') return '[' + name.replace(/\]/g, ']]') + ']'
  return '"' + name.replace(/"/g, '""') + '"'
}
export function exportLiteral(value: unknown, type: DBType): string {
  if (value == null) return 'NULL'
  if (typeof value === 'boolean')
    return type === 'postgresql' ? String(value).toUpperCase() : value ? '1' : '0'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new Error('数据含不安全整数或非有限数，无法可靠导出。')
    return String(value)
  }
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  if (value instanceof Uint8Array) {
    const data = hex(value)
    return type === 'postgresql'
      ? `decode('${data}', 'hex')`
      : type === 'mssql'
        ? `0x${data}`
        : `X'${data}'`
  }
  const text =
    value instanceof Date
      ? formatDateTimeLocal(value)
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  if (type === 'mysql' && /[\\\x00-\x1f]/.test(text))
    return `CONVERT(X'${hex(new TextEncoder().encode(text))}' USING utf8mb4)`
  if (text.includes('\0')) throw new Error('文本含空字符，无法可靠导出。')
  const escaped = text.replace(/'/g, "''")
  return type === 'postgresql'
    ? "E'" + escaped.replace(/\\/g, '\\\\') + "'"
    : (type === 'mssql' ? "N'" : "'") + escaped + "'"
}
export function buildExportInsert(
  type: DBType,
  table: string,
  columns: string[],
  row: Record<string, unknown>
): string {
  return `INSERT INTO ${quoteSQLIdentifier(type, table)} (${columns.map((c) => quoteSQLIdentifier(type, c)).join(', ')}) VALUES (${columns.map((c) => exportLiteral(row[c], type)).join(', ')});`
}
export function terminateDDL(ddl: string): string {
  const text = ddl.trimEnd()
  if (!text.trim() || /^\s*--/.test(text)) throw new Error('未能获取完整建表语句。')
  return text.endsWith(';') ? text : text + ';'
}
