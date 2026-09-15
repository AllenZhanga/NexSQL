const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../../packages/shared/src/sqlStatements.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', compiled)(mod.exports, require, mod)
const { splitSQL } = mod.exports
const cases = [
  ['ordinary statements', 'SELECT 1; SELECT 2;', 'mysql', 2],
  ['quoted semicolons', "SELECT ';', 'it''s;fine'; SELECT 2;", 'sql', 2],
  ['quoted identifiers', 'SELECT "a;b", `c;d`, [e;f]; SELECT 2;', 'sql', 2],
  ['comments', '-- heading;\nSELECT 1; /* ; */ SELECT 2; -- footer;', 'sql', 2],
  ['only comments', '-- heading;\n/* block; */;', 'sql', 0],
  ['mysql escapes', String.raw`SELECT 'a\';b'; SELECT 2;`, 'mysql', 2],
  ['mysql hash comments', 'SELECT 1; # comment;\nSELECT 2;', 'mysql', 2],
  ['mysql executable comments', '/*!40101 SET @x=1 */; SELECT @x;', 'mysql', 2],
  [
    'mysql delimiter',
    'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nCALL p();',
    'mysql',
    2
  ],
  [
    'postgres dollar quote',
    "DO $body$ BEGIN RAISE NOTICE ';'; END $body$; SELECT 1;",
    'postgresql',
    2
  ],
  ['postgres nested comments', '/* a /* b; */ c; */ SELECT 1; SELECT 2;', 'postgresql', 2],
  ['postgres arrays', 'SELECT ARRAY[1,2]; SELECT 2;', 'postgresql', 2],
  ['postgres E string', String.raw`SELECT E'a\';b'; SELECT 2;`, 'postgresql', 2],
  [
    'sqlite trigger',
    'CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES(1); INSERT INTO b VALUES(CASE WHEN 1 THEN 2 ELSE 3 END); END; SELECT 1;',
    'sqlite',
    2
  ],
  ['mssql GO batches', 'DECLARE @x int = 1; SELECT @x;\nGO\nSELECT 2;', 'mssql', 2],
  ['mssql GO in strings', "SELECT 'a\nGO\nb';\nGO\nSELECT 2;", 'mssql', 2],
  ['mssql variables stay in batch', 'DECLARE @x int = 1; SELECT @x;', 'mssql', 1]
]
for (const [name, sql, dialect, count] of cases)
  test(name, () => assert.equal(splitSQL(sql, dialect).length, count))
for (const sql of ["SELECT 'oops", 'SELECT "oops', 'SELECT 1; /* oops'])
  test(`reject incomplete: ${sql}`, () => assert.throws(() => splitSQL(sql)))
test('reject GO repetition without silently repeating writes', () =>
  assert.throws(() => splitSQL('SELECT 1;\nGO 5', 'mssql')))
test('comments do not alter the statement sent to the server', () =>
  assert.deepEqual(splitSQL("-- a\nSELECT 'a;b';", 'mysql'), ["-- a\nSELECT 'a;b'"]))
