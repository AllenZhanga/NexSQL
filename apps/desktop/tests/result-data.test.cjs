const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
const file = path.resolve(__dirname, '../src/renderer/src/components/results/resultData.ts')
const m = new Module(file, module)
m._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  file
)
const { delimitedText, compareValues, rawText, selectionBounds } = m.exports

test('CSV uses doubled quotes and preserves commas, newlines, Unicode and empty fields', () => {
  assert.equal(
    delimitedText(
      ['a"b', 'note'],
      [
        ['x,y', 'line1\r\n"中文"'],
        [null, '']
      ]
    ),
    '"a""b",note\r\n"x,y","line1\r\n""中文"""\r\n,'
  )
})
test('TSV selected rectangle can omit headers without losing embedded tabs and newlines', () => {
  assert.equal(delimitedText(['a', 'b'], [['a\tb', 'c\nd']], '\t', false), '"a\tb"\t"c\nd"')
})
test('raw values preserve bigint precision and structured JSON', () => {
  assert.equal(rawText(9007199254740993n), '9007199254740993')
  assert.equal(rawText({ text: '中文' }), '{"text":"中文"}')
  assert.equal(rawText(null), '')
})
test('numeric sorting is numeric, stable ties and nulls are explicit', () => {
  assert.ok(compareValues(2, 10) < 0)
  assert.ok(compareValues('item2', 'item10') < 0)
  assert.ok(compareValues(null, 0) > 0)
  assert.equal(compareValues(null, undefined), 0)
  assert.equal(compareValues(3, 3), 0)
})
test('reverse selection yields the same rectangular bounds', () => {
  assert.deepEqual(selectionBounds({ row: 5, col: 3 }, { row: 1, col: 0 }), {
    top: 1,
    bottom: 5,
    left: 0,
    right: 3
  })
})

const { selectionJSON, insertStatements } = m.exports
test('selection JSON includes only selected columns and preserves types and nulls', () => {
  assert.deepEqual(
    JSON.parse(
      selectionJSON(
        ['id', 'note', 'flag'],
        [
          [9n, null, true],
          [10n, '', false]
        ]
      )
    ),
    [
      { id: '9', note: null, flag: true },
      { id: '10', note: '', flag: false }
    ]
  )
  assert.throws(() => selectionJSON(['x', 'x'], [[1, 2]]), /重复/)
})
test('INSERT quotes SQLite identifiers, strings and NULL without confusing empty strings', () => {
  assert.equal(
    insertStatements(['a"b', 'note', 'empty'], [["O'Reilly", null, '']], 'my"table', '', 'sqlite'),
    'INSERT INTO "my""table" ("a""b", "note", "empty") VALUES (\'O\'\'Reilly\', NULL, \'\');'
  )
})
test('INSERT supports dialect-specific quoting, boolean, bigint and backslashes', () => {
  assert.equal(
    insertStatements(
      ['flag', 'n', 'path'],
      [[true, 9007199254740993n, 'a\\b']],
      't',
      'public',
      'postgresql'
    ),
    `INSERT INTO "public"."t" ("flag", "n", "path") VALUES (TRUE, 9007199254740993, E'a\\\\b');`
  )
  assert.match(insertStatements(['a]b'], [['中文']], 't', 'dbo', 'mssql'), /\[a\]\]b\].*N'中文'/)
  assert.match(
    insertStatements(['a`b'], [['a\\b']], 't', '', 'mysql'),
    /`a``b`.*CONVERT\(X'615c62' USING utf8mb4\)/
  )
})
test('INSERT rejects missing targets and unsafe numeric data', () => {
  assert.throws(() => insertStatements(['x'], [[1]], '', '', 'sqlite'), /表名/)
  for (const value of [Infinity, NaN, 9007199254740992])
    assert.throws(() => insertStatements(['x'], [[value]], 't', '', 'sqlite'), /无法可靠/)
})
test('SQLite INSERT encodes binary values as hex literals', () => {
  assert.equal(
    insertStatements(['bin'], [[new Uint8Array([0, 255])]], 't', '', 'sqlite'),
    `INSERT INTO "t" ("bin") VALUES (X'00ff');`
  )
})
