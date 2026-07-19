// High-level helper: upload one-or-more local files as legacy-note resources
// and splice them into the note's HTML body in one call. Wraps
// kb.uploadResource + getNoteContent + updateNote so agents don't hand-roll
// the three-step dance for the common cases (image / audio / video / link).

import fs from 'node:fs/promises'
import path from 'node:path'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|ico)$/i
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi)$/i

function detectKind (name) {
  if (IMAGE_EXT.test(name)) return 'image'
  if (AUDIO_EXT.test(name)) return 'audio'
  if (VIDEO_EXT.test(name)) return 'video'
  return 'link'
}

function esc (s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function renderEmbed ({ kind, url, displayName }) {
  switch (kind) {
    case 'image':
      return `<p><img src="${esc(url)}" alt="${esc(displayName)}"></p>`
    case 'audio':
      return `<p><audio controls src="${esc(url)}"></audio></p>`
    case 'video':
      return `<p><video controls src="${esc(url)}"></video></p>`
    case 'link':
    default:
      return `<p><a href="${esc(url)}" download="${esc(displayName)}">${esc(displayName)}</a></p>`
  }
}

/**
 * Normalise the caller-provided items array. Accepts:
 *   - string (path)
 *   - { path, name?, kind? }
 */
function normalise (item) {
  if (typeof item === 'string') return { path: item }
  if (!item?.path) throw new Error('uploadAndEmbed: each item needs `path`')
  return item
}

const BODY_OPEN_RE = /<div class="wiz-note-html"[^>]*>/i
const BODY_CLOSE_RE = /<\/div>\s*<\/div>\s*$/i  // closes .wiz-note-html + .wiz-note-body

/**
 * Insert `snippet` (already HTML) into `existingHtml` at the requested position.
 * If the note follows WizNote's `wiz-note-body > wiz-note-html` shell, splice
 * inside; otherwise fall back to wrapping. Returns the new full HTML.
 */
function splice (existingHtml, snippet, position) {
  const html = existingHtml || ''
  const open = html.match(BODY_OPEN_RE)
  const close = html.match(BODY_CLOSE_RE)
  if (open && close && close.index > open.index) {
    const before = html.slice(0, open.index + open[0].length)
    const inner = html.slice(open.index + open[0].length, close.index)
    const after = html.slice(close.index)
    return position === 'prepend'
      ? before + snippet + inner + after
      : before + inner + snippet + after
  }
  // Fallback shell — new note, or non-standard body.
  const body = html || ''
  const combined = position === 'prepend' ? snippet + body : body + snippet
  return `<div class="wiz-note-body"><div class="wiz-note-html">${combined}</div></div>`
}

function humanSize (n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB'
}

/**
 * Upload local files as first-class attachments (the ones that show up in
 * WizNote's attachment panel) AND drop a matching download link into the
 * note body.
 *
 * The body link's `href` is the raw KS download URL. WizNote clients that
 * open the note with an authenticated session render it as a clickable
 * download; a bare browser tab needs `X-Wiz-Token` in the request header
 * and will 401 otherwise — that's a WizNote limitation, not ours. If you
 * need a shareable body link, use `uploadAndEmbed` (resource channel), which
 * returns pre-signed URLs.
 *
 * @param {WizClient} wiz
 * @param {string}    docGuid
 * @param {Array<string | {path:string, name?:string}>} items
 * @param {object}    [opts]
 * @param {'append'|'prepend'} [opts.position='append']
 * @param {string}    [opts.heading]
 * @returns {Promise<{docGuid: string, uploaded: Array<{path,name,attGuid,size,url}>}>}
 */
export async function attachAndLink (wiz, docGuid, items, opts = {}) {
  if (!docGuid) throw new Error('attachAndLink: docGuid required')
  if (!Array.isArray(items) || !items.length) throw new Error('attachAndLink: items must be a non-empty array')
  const position = opts.position === 'prepend' ? 'prepend' : 'append'

  const uploaded = []
  for (const raw of items) {
    const it = normalise(raw)
    const displayName = it.name || path.basename(it.path)
    const buf = await fs.readFile(it.path)
    const r = await wiz.kb.uploadAttachment(docGuid, buf, displayName)
    const attGuid = r?.att?.attGuid
    if (!attGuid) throw new Error(`uploadAttachment returned no attGuid for ${it.path}: ${JSON.stringify(r)}`)
    uploaded.push({
      path: it.path,
      name: displayName,
      attGuid,
      size: r.att.dataSize || buf.length,
      url: wiz.kb.getAttachmentUrl(docGuid, attGuid)
    })
  }

  const heading = opts.heading ? `<h3>${esc(opts.heading)}</h3>` : ''
  const snippet = heading + uploaded.map(u =>
    `<p>📎 <a href="${esc(u.url)}" data-wiz-att-guid="${esc(u.attGuid)}" download="${esc(u.name)}">${esc(u.name)}</a>` +
    ` <span style="color:#888">(${humanSize(u.size)})</span></p>`
  ).join('')

  const detail = await wiz.kb.getNoteContent(docGuid, { downloadInfo: 1, downloadData: 1 })
  const info = detail?.info || {}
  const html = splice(detail?.html, snippet, position)
  const existing = Array.isArray(detail?.resources)
    ? detail.resources.map(r => r?.name).filter(Boolean)
    : []

  await wiz.kb.updateNote(docGuid, {
    kbGuid: wiz.kbGuid,
    docGuid,
    html,
    url: info.url || '',
    tags: info.tags || '',
    author: info.author || wiz.userId,
    resources: existing  // attachments live on their own channel; preserve resource manifest
  })

  return { docGuid, uploaded }
}

/**
 * Upload `items` (local file paths, or {path, name?, kind?}) to `docGuid`'s
 * resource storage, then splice a matching HTML snippet into the note body.
 *
 * @param {WizClient} wiz
 * @param {string}    docGuid
 * @param {Array<string | {path:string, name?:string, kind?:'image'|'audio'|'video'|'link'}>} items
 * @param {object}    [opts]
 * @param {'append'|'prepend'} [opts.position='append']  where to place the new block
 * @param {string}    [opts.heading]  optional `<h3>` inserted before the block
 * @returns {Promise<{ uploaded: Array<{path,name,serverName,url,kind}>, docGuid: string }>}
 */
export async function uploadAndEmbed (wiz, docGuid, items, opts = {}) {
  if (!docGuid) throw new Error('uploadAndEmbed: docGuid required')
  if (!Array.isArray(items) || !items.length) throw new Error('uploadAndEmbed: items must be a non-empty array')
  const position = opts.position === 'prepend' ? 'prepend' : 'append'

  const uploaded = []
  for (const raw of items) {
    const it = normalise(raw)
    const displayName = it.name || path.basename(it.path)
    const kind = it.kind || detectKind(displayName)
    const buf = await fs.readFile(it.path)
    const r = await wiz.kb.uploadResource(docGuid, buf, displayName)
    if (!r?.url) throw new Error(`uploadResource returned no url for ${it.path}: ${JSON.stringify(r)}`)
    uploaded.push({
      path: it.path,
      name: displayName,
      serverName: r.name,
      url: r.url,
      kind
    })
  }

  const heading = opts.heading ? `<h3>${esc(opts.heading)}</h3>` : ''
  const snippet = heading + uploaded.map(u =>
    renderEmbed({ kind: u.kind, url: u.url, displayName: u.name })
  ).join('')

  const detail = await wiz.kb.getNoteContent(docGuid, { downloadInfo: 1, downloadData: 1 })
  const info = detail?.info || {}
  const html = splice(detail?.html, snippet, position)

  // Register the new resources into the note's manifest. Without this the
  // server keeps `resources` on the note empty, no signed URLs are issued,
  // and other WizNote clients (desktop / mobile / web viewer) can't resolve
  // the `index_files/…` refs when they open the note. Preserve any resources
  // that were already on the note so we don't drop images from earlier edits.
  const existing = Array.isArray(detail?.resources)
    ? detail.resources.map(r => r?.name).filter(Boolean)
    : []
  const merged = [...new Set([...existing, ...uploaded.map(u => u.serverName)])]

  await wiz.kb.updateNote(docGuid, {
    kbGuid: wiz.kbGuid,
    docGuid,
    html,
    url: info.url || '',
    tags: info.tags || '',
    author: info.author || wiz.userId,
    resources: merged
  })

  return { docGuid, uploaded }
}
