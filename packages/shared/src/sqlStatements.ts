/** SQL script boundaries. Separators inside literals, identifiers and comments are never executed separately. */
export function splitSQL(source: string, dialect = 'sql'): string[] {
  const statements: string[] = []
  let start = 0,
    i = 0,
    quote = '',
    dollar = '',
    commentDepth = 0
  let escapeString = false
  let lineComment = false,
    delimiter = ';',
    meaningful = false
  let trigger = false,
    triggerDepth = 0,
    token = '',
    prefix = ''
  const word = (): void => {
    if (!token) return
    const upper = token.toUpperCase()
    prefix += ` ${upper}`
    if (dialect === 'sqlite' && /^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/.test(prefix))
      trigger = true
    if (trigger && (upper === 'BEGIN' || upper === 'CASE')) triggerDepth++
    if (trigger && upper === 'END') triggerDepth--
    token = ''
  }
  const flush = (end: number): void => {
    word()
    if (meaningful) statements.push(source.slice(start, end).trim())
    meaningful = false
    prefix = ''
    trigger = false
    triggerDepth = 0
  }
  while (i < source.length) {
    const ch = source[i],
      next = source[i + 1]
    if (lineComment) {
      if (ch === '\n') lineComment = false
      i++
      continue
    }
    if (commentDepth) {
      if (ch === '/' && next === '*' && dialect !== 'mysql') {
        commentDepth++
        i += 2
      } else if (ch === '*' && next === '/') {
        commentDepth--
        i += 2
      } else i++
      continue
    }
    if (dollar) {
      if (source.startsWith(dollar, i)) {
        i += dollar.length
        dollar = ''
      } else i++
      continue
    }
    if (quote) {
      if (ch === quote) {
        if (next === quote) i += 2
        else {
          quote = ''
          i++
        }
      } else if (ch === '\\' && escapeString) i += 2
      else i++
      continue
    }
    if ((i === 0 || source[i - 1] === '\n') && dialect === 'mysql') {
      const match = source.slice(i).match(/^[ \t]*DELIMITER\s+(\S+)[ \t]*(?:\r?\n|$)/i)
      if (match) {
        if (meaningful) throw new Error('DELIMITER 必须位于完整语句之间')
        delimiter = match[1]
        i += match[0].length
        start = i
        continue
      }
    }
    if ((i === 0 || source[i - 1] === '\n') && dialect === 'mssql') {
      const match = source.slice(i).match(/^[ \t]*GO[ \t]*(?:--[^\n]*)?(?:\r?\n|$)/i)
      if (match) {
        flush(i)
        i += match[0].length
        start = i
        continue
      }
      if (/^[ \t]*GO\s+\d+\b/i.test(source.slice(i)))
        throw new Error('暂不支持 GO 重复次数，请展开为明确的批次')
    }
    if (
      ch === '-' &&
      next === '-' &&
      (dialect !== 'mysql' || !source[i + 2] || /\s/.test(source[i + 2]))
    ) {
      word()
      lineComment = true
      i += 2
      continue
    }
    if (ch === '#' && dialect === 'mysql') {
      word()
      lineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      word()
      if (source[i + 2] === '!') meaningful = true
      commentDepth = 1
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`' || (ch === '[' && dialect !== 'postgresql')) {
      escapeString =
        dialect === 'mysql' ||
        (dialect === 'postgresql' && ch === "'" && /(?:^|[^\w])E$/i.test(source.slice(0, i)))
      word()
      quote = ch === '[' ? ']' : ch
      meaningful = true
      i++
      continue
    }
    if (ch === '$' && dialect === 'postgresql') {
      const match = source.slice(i).match(/^\$(?:[a-zA-Z_][\w]*)?\$/)
      if (match) {
        word()
        dollar = match[0]
        meaningful = true
        i += dollar.length
        continue
      }
    }
    if (source.startsWith(delimiter, i) && dialect !== 'mssql') {
      word()
      if (!trigger || triggerDepth === 0) {
        flush(i)
        i += delimiter.length
        start = i
        continue
      }
    }
    if (/[a-zA-Z_]/.test(ch)) token += ch
    else word()
    if (!/\s/.test(ch)) meaningful = true
    i++
  }
  word()
  if (quote || dollar || commentDepth || (trigger && triggerDepth > 0))
    throw new Error('选中的 SQL 不完整：引号、注释或语句块尚未闭合')
  flush(source.length)
  return statements
}
