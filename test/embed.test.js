import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadAndEmbed } from '../src/embed.js'

// Stand-in that captures kb calls and returns canned responses.
function makeStubClient ({ existingHtml = '' } = {}) {
  const uploads = []
  const updates = []
  return {
    kbGuid: 'kb-fake',
    userId: 'stub@test',
    calls: { uploads, updates },
    kb: {
      uploadResource (docGuid, buf, name) {
        uploads.push({ docGuid, name, size: buf.length })
        // Server hands out a slug; keep pic.png's `.png` suffix like the real API does.
        const serverName = `srv-${uploads.length}${name.endsWith('.png') ? '.png' : ''}`
        return { name: serverName, url: `index_files/${serverName}` }
      },
      async getNoteContent () {
        return { html: existingHtml, info: { url: '', tags: '', author: 'stub@test' } }
      },
      async updateNote (docGuid, payload) { updates.push({ docGuid, payload }) }
    }
  }
}

test('uploadAndEmbed: appends by default with kind-picked tags', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    writeFileSync(join(tmp, 'a.png'), Buffer.from('png'))
    writeFileSync(join(tmp, 'b.wav'), Buffer.from('wav'))
    writeFileSync(join(tmp, 'c.zip'), Buffer.from('zip'))
    const c = makeStubClient({
      existingHtml: '<div class="wiz-note-body"><div class="wiz-note-html"><p>seed</p></div></div>'
    })
    const r = await uploadAndEmbed(c, 'doc-1', [
      join(tmp, 'a.png'), join(tmp, 'b.wav'), join(tmp, 'c.zip')
    ])
    assert.equal(r.uploaded.length, 3)
    assert.deepEqual(r.uploaded.map(u => u.kind), ['image', 'audio', 'link'])
    const html = c.calls.updates[0].payload.html
    // seed body preserved
    assert.match(html, /<p>seed<\/p>/)
    // three embeds present, in order, AFTER seed
    const idxSeed = html.indexOf('<p>seed</p>')
    const idxImg = html.indexOf('<img')
    const idxAudio = html.indexOf('<audio')
    const idxLink = html.indexOf('<a href="index_files/srv-3"')
    assert.ok(idxSeed < idxImg && idxImg < idxAudio && idxAudio < idxLink,
      'embeds should follow seed in order')
    assert.match(html, /<audio controls src="index_files\/srv-2"/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('uploadAndEmbed: prepend + heading places block at top', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    writeFileSync(join(tmp, 'a.png'), Buffer.from('png'))
    const c = makeStubClient({
      existingHtml: '<div class="wiz-note-body"><div class="wiz-note-html"><p>seed</p></div></div>'
    })
    await uploadAndEmbed(c, 'doc-2', [join(tmp, 'a.png')], {
      position: 'prepend', heading: '新素材'
    })
    const html = c.calls.updates[0].payload.html
    const idxH3 = html.indexOf('<h3>新素材</h3>')
    const idxImg = html.indexOf('<img')
    const idxSeed = html.indexOf('<p>seed</p>')
    assert.ok(idxH3 >= 0 && idxImg > idxH3 && idxSeed > idxImg,
      'heading + embed should precede seed')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('uploadAndEmbed: fallback shell when note has no wiz-note-html wrapper', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    writeFileSync(join(tmp, 'a.png'), Buffer.from('png'))
    const c = makeStubClient({ existingHtml: '<p>bare seed</p>' })
    await uploadAndEmbed(c, 'doc-3', [join(tmp, 'a.png')])
    const html = c.calls.updates[0].payload.html
    assert.match(html, /^<div class="wiz-note-body"><div class="wiz-note-html">/)
    assert.match(html, /<p>bare seed<\/p>/)
    assert.match(html, /<img src="index_files\/srv-1\.png"/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('uploadAndEmbed: HTML-escapes display name in alt / href', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    // Windows-illegal chars in filenames, but the caller can override `name`.
    writeFileSync(join(tmp, 'safe.zip'), Buffer.from('zip'))
    const c = makeStubClient()
    await uploadAndEmbed(c, 'doc-4', [
      { path: join(tmp, 'safe.zip'), name: 'evil "><script>x</script>.zip' }
    ])
    const html = c.calls.updates[0].payload.html
    assert.doesNotMatch(html, /<script>/, 'raw script tag must not appear')
    assert.match(html, /&quot;/, 'quote should be entity-escaped')
    assert.match(html, /&lt;script&gt;/, 'angle brackets should be entity-escaped')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('uploadAndEmbed: rejects empty items or missing docGuid', async () => {
  const c = makeStubClient()
  await assert.rejects(() => uploadAndEmbed(c, '', ['x']), /docGuid required/)
  await assert.rejects(() => uploadAndEmbed(c, 'd', []), /non-empty array/)
})
