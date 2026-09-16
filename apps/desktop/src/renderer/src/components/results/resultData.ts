export function rawText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object')
    return value instanceof Date ? value.toISOString() : JSON.stringify(value)
  return String(value)
}
export function delimitedText(
  headers: string[],
  rows: unknown[][],
  separator = ',',
  includeHeaders = true
): string {
  const escape = (value: unknown): string => {
    const text = rawText(value)
    return /["\r\n\t,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [...(includeHeaders ? [headers] : []), ...rows]
    .map((row) => row.map(escape).join(separator))
    .join('\r\n')
}
export function compareValues(a: unknown, b: unknown): number {
  if (a == null) return b == null ? 0 : 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0
  return rawText(a).localeCompare(rawText(b), undefined, { numeric: true })
}
export type CellPosition = { row: number; col: number }
export function selectionBounds(anchor: CellPosition, focus: CellPosition) {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col)
  }
}

export type SQLDialect = 'mysql' | 'postgresql' | 'mssql' | 'sqlite'
export function selectionJSON(headers: string[], rows: unknown[][]): string {
  if (new Set(headers).size !== headers.length)
    throw new Error('选区有重复列名，请先在 SQL 中为列设置不同的别名。')
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(headers.map((name, i) => [name, row[i] ?? null]))),
    (_, value) => (typeof value === 'bigint' ? String(value) : value),
    2
  )
}
export function insertStatements(
  headers: string[],
  rows: unknown[][],
  table: string,
  schema: string,
  dialect: SQLDialect
): string {
  if (!table.trim()) throw new Error('请填写目标表名。')
  if (new Set(headers).size !== headers.length)
    throw new Error('选区有重复列名，请先为列设置不同的别名。')
  const identifier = (name: string): string => {
    if (name.includes('\0')) throw new Error('名称不能包含空字符。')
    if (dialect === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
    if (dialect === 'mssql') return '[' + name.replace(/\]/g, ']]') + ']'
    return '"' + name.replace(/"/g, '""') + '"'
  }
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const literal = (value: unknown): string => {
    if (value == null) return 'NULL'
    if (typeof value === 'boolean')
      return dialect === 'postgresql' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
    if (typeof value === 'bigint') return String(value)
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
        throw new Error('选区包含非有限数或不安全整数，无法可靠生成 INSERT。')
      return String(value)
    }
    if (value instanceof Uint8Array) {
      const bytes = hex(value)
      return dialect === 'postgresql'
        ? `decode('${bytes}', 'hex')`
        : dialect === 'mssql'
          ? `0x${bytes}`
          : `X'${bytes}'`
    }
    const text = rawText(value)
    if (dialect === 'mysql' && /[\\\x00-\x1f]/.test(text))
      return `CONVERT(X'${hex(new TextEncoder().encode(text))}' USING utf8mb4)`
    if (text.includes('\0')) throw new Error('选区文本包含空字符，无法可靠生成 INSERT。')
    const escaped = text.replace(/'/g, "''")
    return dialect === 'postgresql'
      ? "E'" + escaped.replace(/\\/g, '\\\\') + "'"
      : (dialect === 'mssql' ? "N'" : "'") + escaped + "'"
  }
  const target = [schema, table].filter(Boolean).map(identifier).join('.')
  return rows
    .map(
      (row) =>
        `INSERT INTO ${target} (${headers.map(identifier).join(', ')}) VALUES (${row.map(literal).join(', ')});`
    )
    .join('\n')
}
