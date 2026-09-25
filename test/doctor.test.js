// Tests for `wiz doctor` (src/doctor.js): title normalization, resource-ref checks and
// the scan loop. The scan is testable without a server by injecting a fake WizClient
// (document / markdown notes only — collaboration notes need a live WS session).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTitle, findResourceRefs, findBrokenResourceRefs, runDoctor, inspectNote,
  hasMarkdownShell, isMarkdownLike, htmlToMarkdown
} from '../src/doctor.js'

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
  assert.deepEqual((await inspectNote(wiz, byGuid['d-md'], { category: '/A/' })).map((i) => i.kind).sort(), ['markdown-shell-missing', 'title-suffix'])
  assert.deepEqual((await inspectNote(wiz, byGuid['d-broken'], { category: '/A/' })).map((i) => i.kind), ['broken-resource-refs'])
  assert.deepEqual((await inspectNote(wiz, byGuid['d-empty'], { category: '/A/' })).map((i) => i.kind), ['empty-body'])
})

test('runDoctor scans and groups issues by kind', async () => {
  const wiz = fakeWiz()
  const r = await runDoctor(wiz, { delayMs: 0 })
  assert.equal(r.scanned, 4)
  assert.deepEqual(r.byKind, { 'title-suffix': 1, 'markdown-shell-missing': 1, 'broken-resource-refs': 1, 'empty-body': 1 })
  assert.equal(r.issues.length, 4)
  assert.equal(r.fixedCount, 0)
  assert.deepEqual(wiz.calls.renamed, []) // 默认只读
})

test('runDoctor --fix-titles renames and drops the title issue', async () => {
  const wiz = fakeWiz()
  const r = await runDoctor(wiz, { fixTitles: true, delayMs: 0 })
  assert.deepEqual(wiz.calls.renamed, [{ docGuid: 'd-md', title: '带后缀' }])
  assert.equal(r.byKind['title-suffix'], undefined)
  assert.equal(r.fixedCount, 1)
  assert.deepEqual(r.byKind, { 'markdown-shell-missing': 1, 'broken-resource-refs': 1, 'empty-body': 1 })
})

test('runDoctor can be scoped to a category and limited', async () => {
  const wiz = fakeWiz()
  const r = await runDoctor(wiz, { category: '/A/', limit: 2, delayMs: 0 })
  assert.equal(r.scanned, 2)
  const none = await runDoctor(wiz, { category: '/NOPE/', delayMs: 0 })
  assert.equal(none.scanned, 0)
  assert.deepEqual(none.byKind, {})
})

test('lite/markdown notes written in document-wrapper form report the missing shell (not empty)', async () => {
  // 历史工具把 markdown 笔记改写成 <div class="wiz-note-body"> 形式,unwrapMarkdown 取不到源:
  // 报 markdown-shell-missing(可修),而不是误判成空笔记。
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
  assert.deepEqual(r.byKind, { 'markdown-shell-missing': 1 })
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

// ── markdown 笔记外壳（客户端按 Markdown 打开，正文没有外壳就显示空白） ──────────

test('hasMarkdownShell detects the markdown HTML5 shell', () => {
  assert.equal(hasMarkdownShell('<!doctype html><html><body><pre>x</pre></body></html>'), true)
  assert.equal(hasMarkdownShell('  <html><body><pre>x</pre></body></html>'), true)
  assert.equal(hasMarkdownShell('<div class="wiz-note-body"><p>x</p></div>'), false)
  assert.equal(hasMarkdownShell(''), false)
})

test('isMarkdownLike follows the client rule (type suffix or .md title)', () => {
  assert.equal(isMarkdownLike({ type: 'lite/markdown', title: '普通标题' }), true)
  assert.equal(isMarkdownLike({ type: 'document', title: '周报.md' }), true)
  assert.equal(isMarkdownLike({ type: 'document', title: 'readme.md 说明' }), true)
  // 客户端只认带斜杠的后缀：type 'markdown' 不算（会被当普通文档渲染）
  assert.equal(isMarkdownLike({ type: 'markdown', title: '员工通讯录' }), false)
  assert.equal(isMarkdownLike({ type: 'document', title: '普通标题' }), false)
})

test('htmlToMarkdown converts wrapper html back to markdown', () => {
  const html = '<div class="wiz-note-body"><div class="wiz-note-html"><h1>标题</h1><p>正文</p><p><a href="https://a.b/c?x=1&amp;y=2">https://a.b/c?x=1&amp;y=2</a></p><p><strong>加粗</strong></p><ul><li>条目</li></ul></div></div>'
  const md = htmlToMarkdown(html)
  assert.match(md, /^# 标题$/m)
  assert.match(md, /^正文$/m)
  assert.match(md, /^https:\/\/a\.b\/c\?x=1&y=2$/m)   // 链接文字与 URL 相同 → 只输出 URL
  assert.match(md, /^\*\*加粗\*\*$/m)
  assert.match(md, /^- 条目$/m)
  assert.ok(!md.includes('<'))
  assert.ok(!md.includes('&amp;'))
})

test('htmlToMarkdown keeps a labelled link as a markdown link', () => {
  const md = htmlToMarkdown('<p><a href="https://ex.com">点这里</a></p>')
  assert.match(md, /\[点这里\]\(https:\/\/ex\.com\)/)
})

test('inspectNote flags markdown notes whose body lost the shell', async () => {
  const wrapper = '<div class="wiz-note-body"><div class="wiz-note-html"><h1>标题</h1><p>有内容</p></div></div>'
  const wiz = {
    kb: {
      getCategories: async () => ({ result: ['/C/'] }),
      getCategoryNotes: async () => [
        { docGuid: 'm1', title: '缺外壳', type: 'lite/markdown', attachmentCount: 0 },
        { docGuid: 'm2', title: '已正常', type: 'lite/markdown', attachmentCount: 0 }
      ],
      getNoteContent: async (docGuid) => (docGuid === 'm1'
        ? { html: wrapper, resources: [] }
        : { html: '<!doctype html><html><body><pre># 正常</pre></body></html>', resources: [] }),
      renameNote: async () => ({})
    }
  }
  const notes = await wiz.kb.getCategoryNotes({ category: '/C/' })
  assert.deepEqual((await inspectNote(wiz, notes[0], { category: '/C/' })).map((i) => i.kind), ['markdown-shell-missing'])
  assert.deepEqual((await inspectNote(wiz, notes[1], { category: '/C/' })), [])
})

test('runDoctor --fix rewrites the missing shell and clears the issue', async () => {
  const wrapper = '<div class="wiz-note-body"><div class="wiz-note-html"><h1>标题</h1><p>有内容</p></div></div>'
  const store = { 'm1': wrapper }
  const calls = []
  const wiz = {
    kb: {
      getCategories: async () => ({ result: ['/C/'] }),
      getCategoryNotes: async () => [{ docGuid: 'm1', title: '缺外壳', type: 'lite/markdown', attachmentCount: 0 }],
      getNoteContent: async (docGuid) => ({ html: store[docGuid], resources: [] }),
      renameNote: async () => ({})
    },
    updateMarkdownNote: async ({ docGuid, markdown }) => {
      calls.push(markdown)
      store[docGuid] = '<!doctype html><html><head><meta charset="utf-8"></head><body><pre>' + markdown + '</pre></body></html>'
      return { returnCode: 200 }
    }
  }
  const r = await runDoctor(wiz, { fix: true, delayMs: 0 })
  assert.deepEqual(r.byKind, {})
  assert.equal(r.fixedCount, 1)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^# 标题/m)
  assert.match(calls[0], /有内容/)
  // 修完再体检一次应为干净
  const again = await runDoctor(wiz, { delayMs: 0 })
  assert.deepEqual(again.byKind, {})
})

test('markdown 类型笔记的 .md 标题不算问题，非 markdown 类型才算', async () => {
  const wiz = {
    kb: {
      getCategories: async () => ({ result: ['/D/'] }),
      getCategoryNotes: async () => [
        { docGuid: 'md1', title: '周报.md', type: 'lite/markdown', attachmentCount: 0 },
        { docGuid: 'doc1', title: '周报.md', type: 'document', attachmentCount: 0 }
      ],
      getNoteContent: async () => ({ html: '<!doctype html><html><body><pre>x</pre></body></html>', resources: [] }),
      renameNote: async () => ({})
    }
  }
  const notes = await wiz.kb.getCategoryNotes({ category: '/D/' })
  assert.deepEqual(await inspectNote(wiz, notes[0], { category: '/D/' }), [])            // markdown 类型 + 外壳 → 干净
  assert.deepEqual((await inspectNote(wiz, notes[1], { category: '/D/' })).map((i) => i.kind), ['title-suffix']) // document 类型 + .md 标题 → 提示
})
