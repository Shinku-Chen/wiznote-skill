import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadAndEmbed, attachAndLink } from '../src/embed.js'

// Stand-in that captures kb calls and returns canned responses.
function makeStubClient ({ existingHtml = '', existingResources = [] } = {}) {
  const uploads = []
  const attachments = []
  const updates = []
  return {
    kbGuid: 'kb-fake',
    userId: 'stub@test',
    calls: { uploads, attachments, updates },
    kb: {
      uploadResource (docGuid, buf, name) {
        uploads.push({ docGuid, name, size: buf.length })
        const serverName = `srv-${uploads.length}${name.endsWith('.png') ? '.png' : ''}`
        return { name: serverName, url: `index_files/${serverName}` }
      },
      uploadAttachment (docGuid, buf, name) {
        attachments.push({ docGuid, name, size: buf.length })
        return { att: { attGuid: `att-${attachments.length}`, name, dataSize: buf.length } }
      },
      getAttachmentUrl (docGuid, attGuid) {
        return `https://stub/ks/attachment/download/kb-fake/${docGuid}/${attGuid}`
      },
      async getNoteContent () {
        return {
          html: existingHtml,
          info: { url: '', tags: '', author: 'stub@test' },
          resources: existingResources
        }
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

test('uploadAndEmbed: registers new server names into note manifest', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    writeFileSync(join(tmp, 'a.png'), Buffer.from('png'))
    writeFileSync(join(tmp, 'b.wav'), Buffer.from('wav'))
    const c = makeStubClient({
      existingHtml: '<div class="wiz-note-body"><div class="wiz-note-html"><p>x</p></div></div>'
    })
    await uploadAndEmbed(c, 'd', [join(tmp, 'a.png'), join(tmp, 'b.wav')])
    const resources = c.calls.updates[0].payload.resources
    // Both server slugs must be in the manifest — otherwise other WizNote
    // clients can't resolve the `index_files/…` refs.
    assert.deepEqual(resources, ['srv-1.png', 'srv-2'])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('attachAndLink: uploads to attachment channel and links each in body', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    writeFileSync(join(tmp, 'a.zip'), Buffer.from('zipbytes'))
    writeFileSync(join(tmp, 'b.mp3'), Buffer.alloc(2048, 0))
    const c = makeStubClient({
      existingHtml: '<div class="wiz-note-body"><div class="wiz-note-html"><p>seed</p></div></div>'
    })
    const r = await attachAndLink(c, 'd', [
      join(tmp, 'a.zip'), join(tmp, 'b.mp3')
    ], { heading: '附件' })

    // Two attach uploads happened, no resource uploads.
    assert.equal(c.calls.attachments.length, 2)
    assert.equal(c.calls.uploads.length, 0)
    // Both attGuids surface on the return payload.
    assert.deepEqual(r.uploaded.map(u => u.attGuid), ['att-1', 'att-2'])

    const payload = c.calls.updates[0].payload
    // Body links point at the raw attachment URL and carry the attGuid marker.
    assert.match(payload.html, /https:\/\/stub\/ks\/attachment\/download\/kb-fake\/d\/att-1/)
    assert.match(payload.html, /data-wiz-att-guid="att-2"/)
    // Size renders in human form.
    assert.match(payload.html, /\(8 B\)/)   // "zipbytes" = 8 bytes
    assert.match(payload.html, /\(2\.0 KB\)/)
    // Attachments do NOT go into resources[] — they're on their own channel.
    assert.deepEqual(payload.resources, [])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('attachAndLink: preserves pre-existing resources array in updateNote', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    writeFileSync(join(tmp, 'a.zip'), Buffer.from('zip'))
    const c = makeStubClient({
      existingHtml: '<div class="wiz-note-body"><div class="wiz-note-html"><p>x</p></div></div>',
      existingResources: [{ name: 'old-1.png' }]
    })
    await attachAndLink(c, 'd', [join(tmp, 'a.zip')])
    // Existing resources kept as-is; no new resource names appended.
    assert.deepEqual(c.calls.updates[0].payload.resources, ['old-1.png'])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('uploadAndEmbed: preserves pre-existing resources on subsequent uploads', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wiz-embed-'))
  try {
    writeFileSync(join(tmp, 'a.png'), Buffer.from('png'))
    const c = makeStubClient({
      existingHtml: '<div class="wiz-note-body"><div class="wiz-note-html"><p>x</p></div></div>',
      existingResources: [
        { name: 'old-1.png' },
        { name: 'old-2' }
      ]
    })
    await uploadAndEmbed(c, 'd', [join(tmp, 'a.png')])
    const resources = c.calls.updates[0].payload.resources
    // Old resources must survive; the new upload must be appended once.
    assert.deepEqual(resources, ['old-1.png', 'old-2', 'srv-1.png'])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
