// Tests for `wiz doctor` (src/doctor.js): title normalization, resource-ref checks and
// the scan loop. The scan is testable without a server by injecting a fake WizClient
// (document / markdown notes only — collaboration notes need a live WS session).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTitle, findResourceRefs, findBrokenResourceRefs, runDoctor, inspectNote } from '../src/doctor.js'

test('normalizeTitle strips stray .md suffixes', () => {
  assert.deepEqual(normalizeTitle('周报 2020-11-06（TapAD 技术周会）.md'), { clean: '周报 2020-11-06（TapAD 技术周会）', changed: true, suffix: '.md' })
  assert.deepEqual(normalizeTitle('个人账号密码.md.md'), { clean: '个人账号密码', changed: true, suffix: '.md.md' })
  assert.deepEqual(normalizeTitle('大连西路·md'), { clean: '大连西路', changed: true, suffix: '·md' })
  assert.deepEqual(normalizeTitle('海康nas.MD'), { clean: '海康nas', changed: true, suffix: '.MD' })
})

test('normalizeTitle leaves real titles alone', () => {
  assert.deepEqual(normalizeTitle('海康nas'), { clean: '海康nas', changed: false, suffix: '' })
  assert.deepEqual(normalizeTitle('readme.md 说明'), { clean: 'readme.md 说明', changed: false, suffix: '' })
  assert.deepEqual(normalizeTitle(null), { clean: '', changed: false, suffix: '' })
  // 纯后缀不产生空标题
  assert.equal(normalizeTitle('.md').changed, false)
})

test('findResourceRefs collects and decodes index_files references', () => {
  const html = '<img src="index_files/1598535232669.png"><a href="index_files/a%20b.pdf">x</a><img src="index_files/1598535232669.png">'
  assert.deepEqual(findResourceRefs(html), ['1598535232669.png', 'a b.pdf'])
  assert.deepEqual(findResourceRefs(''), [])
})

test('findBrokenResourceRefs reports references missing from the manifest', () => {
  assert.deepEqual(findBrokenResourceRefs(['a.png', 'z.png'], ['a.png', 'b.png']), ['z.png'])
  assert.deepEqual(findBrokenResourceRefs(['a.png'], []), ['a.png'])
  assert.deepEqual(findBrokenResourceRefs([], ['a.png']), [])
})

/** 只含 document / markdown 笔记的假 client。 */
function fakeWiz () {
  const calls = { renamed: [] }
  const notes = {
    '/A/': [
      { docGuid: 'd-md', title: '带后缀.md', type: 'document', attachmentCount: 0 },
      { docGuid: 'd-broken', title: '断链笔记', type: 'document', attachmentCount: 0 },
      { docGuid: 'd-empty', title: '空笔记', type: 'lite/markdown', attachmentCount: 0 },
      { docGuid: 'd-ok', title: '正常笔记', type: 'document', attachmentCount: 0 }
    ]
  }
  const contents = {
    'd-md': { html: '<div><p>有内容</p></div>', resources: [] },
    'd-broken': { html: '<div><img src="index_files/missing.png"><p>有内容</p></div>', resources: [{ name: 'other.png' }] },
    'd-empty': { html: '<div></div>', resources: [] },
    'd-ok': { html: '<div><img src="index_files/ok.png"><p>有内容</p></div>', resources: [{ name: 'ok.png' }] }
  }
  return {
    calls,
    kb: {
      getCategories: async () => ({ result: ['/A/'] }),
      getCategoryNotes: async ({ category }) => notes[category] || [],
      getNoteContent: async (docGuid) => contents[docGuid],
      renameNote: async (docGuid, title) => { calls.renamed.push({ docGuid, title }); return { returnCode: 200 } }
    }
  }
}

test('inspectNote flags the three problem shapes, not the healthy note', async () => {
  const wiz = fakeWiz()
  const byGuid = Object.fromEntries((await wiz.kb.getCategoryNotes({ category: '/A/' })).map((n) => [n.docGuid, n]))
  assert.deepEqual((await inspectNote(wiz, byGuid['d-ok'], { category: '/A/' })), [])
  assert.deepEqual((await inspectNote(wiz, byGuid['d-md'], { category: '/A/' })).map((i) => i.kind), ['title-suffix'])
  assert.deepEqual((await inspectNote(wiz, byGuid['d-broken'], { category: '/A/' })).map((i) => i.kind), ['broken-resource-refs'])
  assert.deepEqual((await inspectNote(wiz, byGuid['d-empty'], { category: '/A/' })).map((i) => i.kind), ['empty-body'])
})

test('runDoctor scans and groups issues by kind', async () => {
  const wiz = fakeWiz()
  const r = await runDoctor(wiz, { delayMs: 0 })
  assert.equal(r.scanned, 4)
  assert.deepEqual(r.byKind, { 'title-suffix': 1, 'broken-resource-refs': 1, 'empty-body': 1 })
  assert.equal(r.issues.length, 3)
  assert.equal(r.fixedCount, 0)
  assert.deepEqual(wiz.calls.renamed, []) // 默认只读
})

test('runDoctor --fix-titles renames and drops the title issue', async () => {
  const wiz = fakeWiz()
  const r = await runDoctor(wiz, { fixTitles: true, delayMs: 0 })
  assert.deepEqual(wiz.calls.renamed, [{ docGuid: 'd-md', title: '带后缀' }])
  assert.equal(r.byKind['title-suffix'], undefined)
  assert.equal(r.fixedCount, 1)
  assert.deepEqual(r.byKind, { 'broken-resource-refs': 1, 'empty-body': 1 })
})

test('runDoctor can be scoped to a category and limited', async () => {
  const wiz = fakeWiz()
  const r = await runDoctor(wiz, { category: '/A/', limit: 2, delayMs: 0 })
  assert.equal(r.scanned, 2)
  const none = await runDoctor(wiz, { category: '/NOPE/', delayMs: 0 })
  assert.equal(none.scanned, 0)
  assert.deepEqual(none.byKind, {})
})

test('lite/markdown notes written in document-wrapper form still count as having content', async () => {
  // 历史工具把 markdown 笔记改写成 <div class="wiz-note-body"> 形式,unwrapMarkdown 取不到源,
  // 不能因此误判成空笔记。
  const wiz = {
    kb: {
      getCategories: async () => ({ result: ['/B/'] }),
      getCategoryNotes: async () => [{ docGuid: 'd1', title: '历史形态', type: 'lite/markdown', attachmentCount: 0 }],
      getNoteContent: async () => ({
        html: '<div class="wiz-note-body"><div class="wiz-note-html"><pre><code></code></pre><p>CBC模式</p><p>pkcs7pandding填充</p></div></div>',
        resources: []
      }),
      renameNote: async () => ({})
    }
  }
  const r = await runDoctor(wiz, { delayMs: 0 })
  assert.equal(r.scanned, 1)
  assert.deepEqual(r.byKind, {})
})

test('a genuinely empty markdown shell is still reported', async () => {
  const wiz = {
    kb: {
      getCategories: async () => ({ result: ['/B/'] }),
      getCategoryNotes: async () => [{ docGuid: 'd2', title: '真空笔记', type: 'lite/markdown', attachmentCount: 0 }],
      getNoteContent: async () => ({
        html: '<!doctype html><html><head><meta charset="utf-8"></head><body><pre>   </pre></body></html>',
        resources: []
      }),
      renameNote: async () => ({})
    }
  }
  const r = await runDoctor(wiz, { delayMs: 0 })
  assert.deepEqual(r.byKind, { 'empty-body': 1 })
})
