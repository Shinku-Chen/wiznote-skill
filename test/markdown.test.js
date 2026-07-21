import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  wrapMarkdown, unwrapMarkdown, ensureMdSuffix,
  createMarkdownNote, updateMarkdownNote, readMarkdownNote
} from '../src/markdown.js'

function makeStub ({ readback } = {}) {
  const calls = { create: [], update: [], updateInfo: [], getContent: [] }
  return {
    kbGuid: 'kb-fake',
    userId: 'stub@test',
    calls,
    kb: {
      createNote (data) { calls.create.push(data); return { ...data, docGuid: 'new-doc', dataSize: 100 } },
      updateNote (docGuid, payload) { calls.update.push({ docGuid, payload }) },
      updateNoteInfo (docGuid, payload) { calls.updateInfo.push({ docGuid, payload }) },
      getNoteContent (docGuid) { calls.getContent.push(docGuid); return readback },
      patchNoteInfo (docGuid, patch = {}) {
        const info = (readback || {}).info || {}
        this.updateNoteInfo(docGuid, { docGuid, ...info, ...patch })
      }
    }
  }
}

test('wrapMarkdown wraps in <!doctype html><body><pre>…</pre></body></html>', () => {
  const html = wrapMarkdown('# hi\n\nbody')
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<meta charset="utf-8">/)
  assert.match(html, /<pre># hi\n\nbody<\/pre>/)
  assert.match(html, /<\/body>\n<\/html>$/)
})

test('wrapMarkdown HTML-escapes markdown source', () => {
  const html = wrapMarkdown('<script>alert(1)</script>\n& < > lines')
  // no raw script tag in output
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&amp; &lt; &gt; lines/)
})

test('wrapMarkdown accepts empty markdown', () => {
  const html = wrapMarkdown('')
  assert.match(html, /<pre><\/pre>/)
})

test('unwrapMarkdown reverses wrapMarkdown', () => {
  const src = '# 标题\n\n<script>x</script> & 混合\n- 列表'
  const html = wrapMarkdown(src)
  assert.equal(unwrapMarkdown(html), src)
})

test('unwrapMarkdown returns input unchanged when no <pre> found', () => {
  const raw = '# no pre wrapper here'
  assert.equal(unwrapMarkdown(raw), raw)
})

test('createMarkdownNote passes lite/markdown + wrapped html to createNote', async () => {
  const c = makeStub()
  await createMarkdownNote(c, { title: 't', markdown: '# body', category: '/x/', tags: '' })
  assert.equal(c.calls.create.length, 1)
  const body = c.calls.create[0]
  assert.equal(body.type, 'lite/markdown')
  assert.equal(body.category, '/x/')
  assert.equal(body.title, 't.md')   // .md suffix enforced
  assert.match(body.html, /^<!doctype html>/)
  assert.match(body.html, /<pre># body<\/pre>/)
})

test('createMarkdownNote does not patch metadata when no created/dataModified given', async () => {
  const c = makeStub()
  await createMarkdownNote(c, { title: 't', markdown: 'x' })
  assert.equal(c.calls.updateInfo.length, 0)   // create-only; no follow-up patch
})

test('createMarkdownNote backdates created/dataModified via a post-create patch', async () => {
  // /ks/note/create ignores created inline, so the helper patches after creating.
  const c = makeStub({ readback: { info: { title: 't', type: 'lite/markdown' } } })
  await createMarkdownNote(c, { title: 't', created: 1682899200000, dataModified: 1577836800000 })
  assert.equal(c.calls.create.length, 1)
  assert.equal(c.calls.create[0].created, undefined)   // not sent inline
  assert.equal(c.calls.updateInfo.length, 1)
  const patched = c.calls.updateInfo[0].payload
  assert.equal(patched.docGuid, 'new-doc')
  assert.equal(patched.created, 1682899200000)
  assert.equal(patched.dataModified, 1577836800000)
})

test('ensureMdSuffix appends .md only when missing (case-insensitive)', () => {
  assert.equal(ensureMdSuffix('周报 2026-07-20'), '周报 2026-07-20.md')
  assert.equal(ensureMdSuffix('notes.md'), 'notes.md')
  assert.equal(ensureMdSuffix('README.MD'), 'README.MD')  // already has it, any case
})

test('createMarkdownNote appends .md to the title', async () => {
  const c = makeStub()
  await createMarkdownNote(c, { title: '周报 2026-07-20', markdown: 'x' })
  assert.equal(c.calls.create[0].title, '周报 2026-07-20.md')
})

test('createMarkdownNote does not double-append .md', async () => {
  const c = makeStub()
  await createMarkdownNote(c, { title: 'already.md', markdown: 'x' })
  assert.equal(c.calls.create[0].title, 'already.md')
})

test('createMarkdownNote requires a title', async () => {
  const c = makeStub()
  await assert.rejects(() => createMarkdownNote(c, { markdown: 'x' }), /title required/)
})

test('updateMarkdownNote wraps and updates; separately updates title', async () => {
  const c = makeStub()
  await updateMarkdownNote(c, { docGuid: 'd', markdown: '# new', title: 'newT' })
  assert.equal(c.calls.updateInfo[0].payload.title, 'newT.md')  // .md enforced on rename too
  const payload = c.calls.update[0].payload
  assert.match(payload.html, /<pre># new<\/pre>/)
  assert.equal(payload.docGuid, 'd')
})

test('readMarkdownNote unwraps for lite/markdown, returns html for others', async () => {
  const litHtml = wrapMarkdown('# hello world')
  const c1 = makeStub({ readback: { info: { type: 'lite/markdown' }, html: litHtml } })
  assert.equal(await readMarkdownNote(c1, 'd'), '# hello world')

  const c2 = makeStub({ readback: { info: { type: 'document' }, html: '<p>plain html</p>' } })
  assert.equal(await readMarkdownNote(c2, 'd'), '<p>plain html</p>')
})
