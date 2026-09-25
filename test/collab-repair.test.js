// Tests for the legacy-desktop-client block-format repair helpers.
// The conversion itself is pure, so it is unit-testable without a server.
//
// Background: the WizNote desktop client (0.1.107, the last desktop build) only
// renders the *old* block format. Newer tools write cells as objects
// (`{"__id": "_table_x_0", "__type": "table_cell", "text": [...]}`) and tables
// without the `rows` field, which makes that client throw while rendering
// (`TypeError: ... reading 'setCell'` / `Assert Error`) and the note body spins.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { downgradeDocData, findLegacyRenderProblems } from '../src/collab-repair.js'

/** New-format table (no rows, object cells, one empty insert) + new-format code cell. */
function newFormatDoc () {
  return {
    blocks: [
      { id: 'h1', type: 'text', text: [{ insert: 'title' }], heading: 1 },
      { id: 'tbl', type: 'table', cols: 2, children: ['_table_tbl_0', '_table_tbl_1', '_table_tbl_2'] },
      { id: 'code1', type: 'code', language: '', children: ['_code_code1_0'] }
    ],
    comments: {},
    meta: { version: 7 },
    authors: ['u1'],
    commentators: [],
    _table_tbl_0: { __id: '_table_tbl_0', __type: 'table_cell', text: [{ insert: 'a' }, { insert: '' }] },
    _table_tbl_1: { __id: '_table_tbl_1', __type: 'table_cell', text: [{ insert: '' }] },
    _table_tbl_2: { __id: '_table_tbl_2', __type: 'table_cell', text: [{ insert: 'c', attributes: { link: 'https://ex.com' } }] },
    _code_code1_0: { __id: '_code_code1_0', __type: 'code_cell', text: [{ insert: 'line1\nline2' }] }
  }
}

/** Old-format doc: array cells, table with rows — what the desktop client writes. */
function oldFormatDoc () {
  return {
    blocks: [
      { id: 'tbl', type: 'table', cols: 2, rows: 2, children: ['_c0', '_c1', '_c2'], text: [], chart: false },
      { id: 'code1', type: 'code', language: 'txt', children: ['_k0'] }
    ],
    comments: {},
    meta: {},
    authors: [],
    commentators: [],
    _c0: [{ id: '_c0', type: 'text', level: 0, text: [{ insert: 'a' }] }],
    _c1: [{ id: '_c1', type: 'text', level: 0, text: [] }],
    _c2: [{ id: '_c2', type: 'text', level: 0, text: [{ insert: 'c' }] }],
    _k0: [{ id: '_k0', type: 'text', level: 0, text: [{ insert: 'code' }] }]
  }
}

test('findLegacyRenderProblems flags the new-format defects', () => {
  const problems = findLegacyRenderProblems(newFormatDoc())
  assert.deepEqual(problems.sort(), ['empty-insert', 'object-cell', 'table-missing-rows'])
})

test('findLegacyRenderProblems leaves old-format docs alone', () => {
  assert.deepEqual(findLegacyRenderProblems(oldFormatDoc()), [])
})

test('downgradeDocData turns object cells into block arrays', () => {
  const { data, stats } = downgradeDocData(newFormatDoc())
  assert.equal(stats.tables, 1)
  assert.equal(stats.cells, 4)
  assert.deepEqual(data._table_tbl_0, [{ id: '_table_tbl_0', type: 'text', level: 0, text: [{ insert: 'a' }] }])
  // link attribute survives the rewrite
  assert.deepEqual(data._table_tbl_2[0].text, [{ insert: 'c', attributes: { link: 'https://ex.com' } }])
  // code cell becomes a block array too, and the block gets a usable language
  assert.deepEqual(data._code_code1_0, [{ id: '_code_code1_0', type: 'text', level: 0, text: [{ insert: 'line1\nline2' }] }])
  assert.equal(data.blocks[2].language, 'txt')
})

test('downgradeDocData fills in the table fields the client needs', () => {
  const { data } = downgradeDocData(newFormatDoc())
  const table = data.blocks[1]
  assert.equal(table.rows, 2) // ceil(3 cells / 2 cols)
  assert.equal(table.cols, 2)
  assert.equal(table.colsWidth.length, 2)
  assert.equal(table.chart, false)
  assert.equal(table.noBorder, false)
  assert.deepEqual(table.text, [])
})

test('downgradeDocData drops empty inserts and keeps empty cells empty', () => {
  const { data } = downgradeDocData(newFormatDoc())
  assert.deepEqual(data._table_tbl_0[0].text, [{ insert: 'a' }])
  assert.deepEqual(data._table_tbl_1[0].text, []) // was [{insert:''}] — must not become the invalid form again
})

test('downgradeDocData is idempotent and problem-free afterwards', () => {
  const first = downgradeDocData(newFormatDoc()).data
  const second = downgradeDocData(first)
  assert.deepEqual(second.data, first)
  assert.deepEqual(second.stats, { tables: 1, cells: 0, emptyOpsDropped: 0, blocksAdded: 0 })
  assert.deepEqual(findLegacyRenderProblems(first), [])
  assert.deepEqual(findLegacyRenderProblems(second.data), [])
})

test('empty docs render fine but a missing blocks array does not', () => {
  // The desktop client throws `TypeError: ... reading 'length'` when data.blocks is undefined.
  assert.deepEqual(findLegacyRenderProblems(null), [])
  assert.deepEqual(findLegacyRenderProblems({ blocks: [] }), [])
  assert.deepEqual(findLegacyRenderProblems({ meta: { ctime: 1 } }), ['missing-blocks'])

  const { data, stats } = downgradeDocData({ meta: { ctime: 1 } })
  assert.deepEqual(data, { meta: { ctime: 1 }, blocks: [] })
  assert.equal(stats.blocksAdded, 1)
  assert.deepEqual(findLegacyRenderProblems(data), [])
})

test('downgradeDocData keeps the rest of the document intact', () => {
  const input = newFormatDoc()
  const { data } = downgradeDocData(input)
  assert.deepEqual(data.blocks[0], input.blocks[0])
  assert.deepEqual(data.meta, input.meta)
  assert.deepEqual(data.authors, input.authors)
  assert.deepEqual(data.comments, input.comments)
})

test('downgradeDocData does not mutate its input', () => {
  const input = newFormatDoc()
  const snapshot = JSON.stringify(input)
  downgradeDocData(input)
  assert.equal(JSON.stringify(input), snapshot)
})
