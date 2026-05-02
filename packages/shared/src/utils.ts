/**
 * Formats a Date object as a local datetime string: YYYY-MM-DD HH:mm:ss
 * Returns an empty string for invalid Date objects.
 */
export function formatDateTimeLocal(date: Date): string {
  if (isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`
}

/**
 * Formats a cell value for display. Date objects are rendered as local
 * datetime strings (YYYY-MM-DD HH:mm:ss) instead of the default UTC ISO
 * representation returned by String(date).
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatDateTimeLocal(value)
  return String(value)
}
