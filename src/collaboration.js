// WizNote collaboration-note WebSocket protocol (sharejs JSON).
// Requires the `ws` package. Ported from wiz_open_api.py.
//
// Message ordering: we attach a persistent listener at open time and queue every
// incoming frame; helpers consume by SHAPE, not by position. This is robust to
// servers that ack/init in unexpected orders or skip acks for empty docs.

import crypto from 'node:crypto'
import { execRequest } from './request.js'
import { markdownToBlocks, blocksToMarkdown } from './blocks.js'

const DEBUG = !!process.env.WIZ_WS_DEBUG

let _WebSocket = null
async function getWS () {
  if (_WebSocket) return _WebSocket
  try {
    const mod = await import('ws')
    _WebSocket = mod.default || mod.WebSocket || mod
    return _WebSocket
  } catch {
    throw new Error(
      'Collaboration notes need the `ws` package. Install it inside the skill dir:\n' +
      '  cd ~/.claude/skills/wiznote-api && npm i --no-save ws'
    )
  }
}

export function getCollaborationToken ({ kbServer, kbGuid, docGuid, token }) {
  return execRequest('POST',
    `${kbServer}/ks/note/${kbGuid}/${docGuid}/tokens`,
    { token, body: {} })
}

function wsUrl (kbServer, kbGuid, docGuid) {
  const scheme = kbServer.startsWith('https') ? 'wss' : 'ws'
  const host = kbServer.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `${scheme}://${host}/editor/${kbGuid}/${docGuid}`
}

/**
 * A lightweight WS session with a persistent message queue.
 * All frames received after `open` are appended to `.queue`; helpers pull from
 * the head, waiting up to `timeoutMs` for a frame that matches a predicate.
 */
class WsSession {
  constructor (ws) {
    this.ws = ws
    this.queue = []
    this.waiters = []
    this.closed = false
    ws.on('message', data => {
      const s = data.toString()
      if (DEBUG) console.error('[ws recv]', s.slice(0, 200))
      this.queue.push(s)
      this._pump()
    })
    ws.on('close', () => { this.closed = true; this._pump() })
    ws.on('error', err => { this.error = err; this._pump() })
  }

  _pump () {
    while (this.waiters.length) {
      const w = this.waiters[0]
      // find a queued message matching predicate
      const idx = w.predicate
        ? this.queue.findIndex(m => { try { return w.predicate(JSON.parse(m)) } catch { return false } })
        : (this.queue.length ? 0 : -1)
      if (idx >= 0) {
        this.waiters.shift()
        const [msg] = this.queue.splice(idx, 1)
        clearTimeout(w.timer)
        w.resolve(msg)
        continue
      }
      if (this.closed) {
        this.waiters.shift()
        clearTimeout(w.timer)
        w.reject(this.error || new Error('WS closed before matching message'))
        continue
      }
      break
    }
  }

  send (obj) {
    const s = JSON.stringify(obj)
    if (DEBUG) console.error('[ws send]', s.slice(0, 200))
    this.ws.send(s)
  }

  /** Wait for the next frame, or one matching the predicate. */
  recv ({ predicate, timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject, predicate, timer: null }
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new Error(`WS recv timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      this.waiters.push(w)
      this._pump()
    })
  }

  close () { try { this.ws.close() } catch {} }
}

/**
 * Open a WS, wait for connection, send handshake, wait for the server's init
 * frame. Returns a WsSession with the connection ready for further ops.
 */
async function openSession ({ kbServer, kbGuid, docGuid, userGuid, editorToken }) {
  const WS = await getWS()
  const raw = new WS(wsUrl(kbServer, kbGuid, docGuid))
  await new Promise((resolve, reject) => {
    raw.once('open', resolve)
    raw.once('error', reject)
  })
  const s = new WsSession(raw)
  s.send({
    a: 'hs', id: null,
    auth: { appId: kbGuid, docId: docGuid, userId: userGuid, permission: 'w', token: editorToken }
  })
  // Server's handshake response has {a:"hs",protocol:1,...} — consume it explicitly.
  await s.recv({ predicate: m => m.a === 'hs', timeoutMs: 5000 })
  return s
}

/** Read the current collaboration document. Returns raw JSON string. */
export async function fetchCollaborationContent (opts) {
  const s = await openSession(opts)
  try {
    s.send({ a: 'f', c: opts.kbGuid, d: opts.docGuid, v: null })
    // Wait for a frame that carries the document data ('data.data' or 'data.blocks').
    // Empty notes may only respond with an ack — accept anything with 'data' after
    // a short window.
    const raw = await s.recv({
      predicate: m => m.data !== undefined,
      timeoutMs: 8000
    })
    return raw
  } finally {
    s.close()
  }
}

/**
 * Write blocks into a collaboration note.
 */
export async function writeCollaborationBlocks (opts) {
  const s = await openSession(opts)
  try {
    // Fetch current state so we know the version and whether to delete-first.
    s.send({ a: 'f', c: opts.kbGuid, d: opts.docGuid, v: null })
    let v = opts.version ?? 0
    let hasDoc = false
    try {
      const syncRaw = await s.recv({ predicate: m => m.data !== undefined, timeoutMs: 5000 })
      const parsed = JSON.parse(syncRaw)
      const serverV = parsed?.data?.v ?? 0
      if (serverV > v) v = serverV
      hasDoc = parsed?.data?.type !== undefined && serverV > 0
    } catch {
      // Empty doc; no sync response — that's fine, we'll create.
    }

    const src = crypto.randomUUID().slice(0, 20)
    let seq = 1
    const deleteFirst = opts.deleteFirst ?? hasDoc

    if (deleteFirst) {
      s.send({ a: 'op', c: opts.kbGuid, d: opts.docGuid, v, src, seq, del: true })
      await s.recv({ timeoutMs: 5000 })
      seq++; v++
    }

    const docData = {
      blocks: opts.blocks || [],
      comments: [], meta: {}, authors: [], commentators: []
    }
    for (const [id, extra] of Object.entries(opts.extras || {})) {
      docData[id] = extra
    }

    s.send({
      a: 'op', c: opts.kbGuid, d: opts.docGuid,
      v, src, seq,
      create: {
        type: 'http://sharejs.org/types/JSONv1',
        data: docData
      }
    })
    // Wait for the server's ack of OUR op — the frame echoes back src/seq or
    // carries `v: v+1`. Without this the WS is closed in `finally` before the
    // create bytes finish flushing on a freshly-minted note, and the write
    // never lands (doc stays at v:0). Time out generously; if the server
    // never acks, do a follow-up fetch to force a round trip that guarantees
    // our op reached the server side.
    try {
      await s.recv({
        predicate: m => (m.a === 'op' && (m.src === src || m.v === v)) || m.v > v,
        timeoutMs: 8000
      })
    } catch {
      s.send({ a: 'f', c: opts.kbGuid, d: opts.docGuid, v: null })
      await s.recv({ predicate: m => m.data !== undefined, timeoutMs: 5000 }).catch(() => {})
    }
  } finally {
    s.close()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// High-level helpers
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Collab resource upload — the two-step, content-addressed flow that WizNote's
// web editor uses when the user drags a file into a collab note.
//
//   1. POST /editor/:kb/:doc/resources/<hash>          Content-Type: JSON
//        body: {"name": "<user filename>", "size": N}
//      → 201 [] (registers a "resource slot" for this doc+hash)
//   2. POST /editor/:kb/:doc/resources                 Content-Type: multipart
//        fields: file-size (byte count),
//                file-hash (base64url(sha256(bytes)), no extension),
//                file      (the bytes, filename preserved)
//      → 201 ["<hash>.<ext>"]  (final `src` for the embed block)
//
// Both steps require BOTH headers:
//   x-live-editor-token: <editorToken from getCollaborationToken>
//   x-live-editor-base-url: <base64(kbServer + '/editor/' + kbGuid + '/' + docGuid)>
// The token goes in a HEADER, NOT the cookie the download path uses.
// ────────────────────────────────────────────────────────────────────────────

function hashBytes (buf) {
  return crypto.createHash('sha256').update(buf).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function guessMime (name, buf) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || ''
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
    heic: 'image/heic', ico: 'image/x-icon',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    zip: 'application/x-zip-compressed', pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', json: 'application/json', xml: 'application/xml'
  }
  return map[ext] || 'application/octet-stream'
}

function pickEmbedType (mime) {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'office'  // WizNote's generic downloadable-file card kind
}

async function collabHeaders (wiz, docGuid) {
  const tokRes = await getCollaborationToken({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid, token: wiz.token
  })
  const editorToken = tokRes?.editorToken || tokRes
  const base = `${wiz.kbServer}/editor/${wiz.kbGuid}/${docGuid}`
  const b64Base = Buffer.from(base).toString('base64')
  return {
    editorToken,
    base,
    headers: {
      'accept': 'application/json, text/plain, */*',
      'origin': 'https://www.wiz.cn',
      'referer': 'https://www.wiz.cn/',
      'user-agent': 'Mozilla/5.0',
      'x-live-editor-token': editorToken,
      'x-live-editor-base-url': b64Base
    }
  }
}

/**
 * Upload a file into a collaboration note's resource bucket.
 * Returns metadata suitable for an `embed` block's `embedData`.
 *
 * Server-side content-addressed dedupe: `src` = `base64url(sha256(bytes)) + '.' + ext`,
 * bytes are stored once per hash across the whole KS instance. This helper
 * detects dedupe via the Step 1 response and skips Step 2 when the bytes
 * are already stored.
 *
 * @param {WizClient} wiz
 * @param {string}    docGuid
 * @param {Buffer}    buffer
 * @param {string}    fileName    original filename (used for MIME + display)
 * @returns {Promise<{src, fileName, fileSize, fileType, hash, deduped: boolean}>}
 *   `deduped: true` means the server already had these bytes (from any note,
 *   any user) — Step 2 was skipped, no bytes went over the wire.
 */
export async function uploadCollabResource (wiz, docGuid, buffer, fileName) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer)
  const hash = hashBytes(buffer)
  const mime = guessMime(fileName, buffer)
  const { headers, base } = await collabHeaders(wiz, docGuid)

  // Step 1 — register slot for this doc + hash.
  // Response body signals dedupe status:
  //   []                → server does NOT have these bytes yet; MUST run Step 2.
  //   ["<hash>.<ext>"]  → server already has bytes (from an earlier upload
  //                       anywhere on this KS); Step 2 is redundant, and the
  //                       resource is immediately downloadable on this doc.
  const r1 = await fetch(`${base}/resources/${hash}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: fileName, size: buffer.length })
  })
  if (r1.status !== 201 && r1.status !== 200) {
    throw new Error(`collab upload step 1 failed: HTTP ${r1.status} ${await r1.text()}`)
  }
  let src
  let deduped = false
  try {
    const step1 = await r1.json()
    if (Array.isArray(step1) && step1[0]) { src = step1[0]; deduped = true }
  } catch {}

  if (!deduped) {
    // Step 2 — send bytes.
    const form = new FormData()
    form.append('file-size', String(buffer.length))
    form.append('file-hash', hash)
    form.append('file', new Blob([buffer], { type: mime }), fileName)
    const r2 = await fetch(`${base}/resources`, { method: 'POST', headers, body: form })
    if (r2.status !== 201 && r2.status !== 200) {
      throw new Error(`collab upload step 2 failed: HTTP ${r2.status} ${await r2.text()}`)
    }
    try {
      const parsed = await r2.json()
      if (Array.isArray(parsed) && parsed[0]) src = parsed[0]
    } catch {}
  }

  if (!src) {
    const ext = (fileName.match(/\.([^.]+)$/) || [])[1]
    src = ext ? `${hash}.${ext.toLowerCase()}` : hash
  }
  return { src, fileName, fileSize: buffer.length, fileType: mime, hash, deduped }
}

/**
 * Cheap yes/no probe: is this resource ALREADY registered on THIS doc (i.e.
 * downloadable from `/editor/:kb/:doc/resources/<hash>`)?
 *
 * ⚠ Doc-scoped, NOT global. A GET here returns 404 when the doc has no slot
 * for this hash — even if the KS instance stores the bytes for another doc.
 * To learn "does the server have these bytes globally", you must POST step 1
 * (which is what `uploadCollabResource` does; it returns `deduped: true`
 * when the server responds `["hash.ext"]` on that call).
 *
 * @param {WizClient} wiz
 * @param {string}    docGuid  collab doc to probe against
 * @param {Buffer|string} bufferOrHash
 * @returns {Promise<{exists: boolean, hash: string, size?: number, contentType?: string}>}
 */
export async function hasCollabResource (wiz, docGuid, bufferOrHash) {
  const hash = Buffer.isBuffer(bufferOrHash) ? hashBytes(bufferOrHash) : bufferOrHash
  const { headers, base } = await collabHeaders(wiz, docGuid)
  const r = await fetch(`${base}/resources/${hash}`, { headers })
  const size = Number(r.headers.get('content-length')) || undefined
  return {
    exists: r.status === 200,
    hash,
    size,
    contentType: r.headers.get('content-type') || undefined
  }
}

/**
 * Append embed blocks to an existing collab note. Preserves current content —
 * fetches the doc, splices in new blocks, then rewrites via the sharejs
 * delete+create flow that writeCollaborationBlocks already uses.
 *
 * @param {WizClient} wiz
 * @param {string}    docGuid
 * @param {Array<{src, fileName, fileSize, fileType}>} items  (from uploadCollabResource)
 * @param {object}    [opts]
 * @param {'append'|'prepend'} [opts.position='append']
 */
export async function appendCollabEmbeds (wiz, docGuid, items, opts = {}) {
  if (!Array.isArray(items) || !items.length) return { docGuid, embedded: [] }
  const position = opts.position === 'prepend' ? 'prepend' : 'append'

  // Fetch current blocks — same protocol as fetchCollaborationContent, but we
  // need the parsed structure so we can splice.
  const { headers: _h, editorToken } = await collabHeaders(wiz, docGuid)
  const raw = await fetchCollaborationContent({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken
  })
  const parsed = JSON.parse(raw)
  const inner = parsed?.data?.data
  const currentBlocks = inner?.blocks || []
  const version = parsed?.data?.v ?? 0

  const newBlocks = items.map(u => ({
    id: crypto.randomBytes(4).toString('hex'),
    type: 'embed',
    embedType: pickEmbedType(u.fileType || ''),
    align: 'center',
    quoted: false,
    embedData: {
      src: u.src,
      fileName: u.fileName,
      fileSize: u.fileSize,
      fileType: u.fileType,
      previewType: 'card'
    }
  }))

  const mergedBlocks = position === 'prepend'
    ? [...newBlocks, ...currentBlocks]
    : [...currentBlocks, ...newBlocks]

  // Preserve any custom top-level fields the doc has (comments/meta/authors/…).
  const extras = {}
  if (inner) {
    for (const [k, v] of Object.entries(inner)) {
      if (k === 'blocks') continue
      extras[k] = v
    }
  }

  await writeCollaborationBlocks({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken,
    blocks: mergedBlocks, extras,
    version,
    deleteFirst: currentBlocks.length > 0 || version > 0
  })
  return { docGuid, embedded: newBlocks }
}

/**
 * One-shot: upload files into a collab note AND insert matching embed blocks
 * at the end (or start) of the note. Matches WizNote's client behaviour when
 * the user drags a file in.
 *
 * @param {WizClient} wiz
 * @param {string}    docGuid
 * @param {Array<string|{path,name?}>} items
 * @param {object}    [opts]
 */
export async function collabUploadAndEmbed (wiz, docGuid, items, opts = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('collabUploadAndEmbed: items required')
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const uploaded = []
  for (const raw of items) {
    const it = typeof raw === 'string' ? { path: raw } : raw
    if (!it?.path) throw new Error('collabUploadAndEmbed: each item needs `path`')
    const buf = await fs.readFile(it.path)
    const name = it.name || path.basename(it.path)
    const info = await uploadCollabResource(wiz, docGuid, buf, name)
    uploaded.push(info)
  }
  const r = await appendCollabEmbeds(wiz, docGuid, uploaded, opts)
  return { docGuid, uploaded, embedded: r.embedded }
}

export async function createCollaborationNote (wiz, {
  title, markdown = '', category = '/My Notes/', tags = ''
}) {
  const createRes = await execRequest('POST',
    `${wiz.kbServer}/ks/note/create/${wiz.kbGuid}`,
    {
      token: wiz.token,
      query: { clientType: 'web', clientVersion: '4.0', lang: 'zh-cn' },
      body: {
        kbGuid: wiz.kbGuid, html: '', category,
        owner: wiz.userId, tags, title, type: 'collaboration'
      },
      returnFullResult: true
    })
  const docGuid = createRes.result?.docGuid
  if (!docGuid) {
    throw new Error(`create collaboration note failed: ${JSON.stringify(createRes)}`)
  }
  if (markdown.trim()) {
    // create-note REST 返回的 editorToken 对 WS 握手无效,必须再走
    // /ks/note/{kb}/{doc}/tokens 换发一个 WS 有效 token;否则文档停在 v:0(空壳)。
    const tokenRes = await getCollaborationToken({
      kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid, token: wiz.token
    })
    const editorToken = tokenRes?.editorToken || tokenRes
    const { blocks, extras } = markdownToBlocks(markdown)
    await writeCollaborationBlocks({
      kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
      userGuid: wiz.userGuid, editorToken,
      blocks, extras, version: 0
    })
  }
  return { docGuid, title, category }
}

export async function updateCollaborationNote (wiz, { docGuid, markdown, title }) {
  if (title) {
    await execRequest('PUT',
      `${wiz.kbServer}/ks/note/save/${wiz.kbGuid}/${docGuid}`,
      {
        token: wiz.token,
        query: { infoOnly: 1, clientType: 'web', clientVersion: '4.0', lang: 'zh-cn' },
        body: {
          category: '', docGuid, kbGuid: wiz.kbGuid,
          title, html: '', resources: []
        }
      })
  }
  const tokenRes = await getCollaborationToken({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid, token: wiz.token
  })
  const editorToken = tokenRes?.editorToken || tokenRes
  const { blocks, extras } = markdownToBlocks(markdown || '')
  await writeCollaborationBlocks({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken,
    blocks, extras
  })
  return { docGuid, status: 'updated' }
}

/**
 * List image/file resources embedded in a collaboration note.
 * Returns [{ name, blockType }] — names come from image blocks' embedData.src.
 * The list is inferred by walking the block tree; NOT a first-class API.
 */
export async function listCollaborationResources (wiz, docGuid) {
  const tokenRes = await getCollaborationToken({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid, token: wiz.token
  })
  const editorToken = tokenRes?.editorToken || tokenRes
  const raw = await fetchCollaborationContent({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken
  })
  let inner
  try { inner = JSON.parse(raw)?.data?.data } catch {}
  if (!inner?.blocks) return []
  const out = []
  const seen = new Set()
  for (const b of inner.blocks) {
    // image embed
    if (b.type === 'embed' && b.embedType === 'image') {
      const name = b.embedData?.src
      if (name && !seen.has(name)) { seen.add(name); out.push({ name, blockType: 'image' }) }
    }
    // audio / file / drawio embeds also store src pointing to internal resources
    if (b.type === 'embed' && ['audio', 'file', 'drawio'].includes(b.embedType)) {
      const name = b.embedData?.src
      if (name && !seen.has(name)) { seen.add(name); out.push({ name, blockType: b.embedType }) }
    }
  }
  return out
}

/**
 * Download a single resource embedded in a collaboration note.
 * @returns {Promise<{buffer: Buffer, contentType: string, name: string}>}
 */
export async function downloadCollaborationResource (wiz, docGuid, name) {
  const tokenRes = await getCollaborationToken({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid, token: wiz.token
  })
  const editorToken = tokenRes?.editorToken || tokenRes
  const url = `${wiz.kbServer}/editor/${wiz.kbGuid}/${docGuid}/resources/${encodeURIComponent(name)}`
  const res = await fetch(url, {
    headers: {
      cookie: `x-live-editor-token=${editorToken}`,
      'user-agent': 'Mozilla/5.0'
    }
  })
  if (!res.ok) throw new Error(`collab resource download failed: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType: res.headers.get('content-type') || '', name }
}

export async function readCollaborationNote (wiz, docGuid) {
  const detail = await wiz.kb.getNoteContent(docGuid, { downloadInfo: 1, downloadData: 0 })
  const type = detail?.info?.type
  if (type !== 'collaboration') return detail?.html || ''
  const tokenRes = await getCollaborationToken({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid, token: wiz.token
  })
  const editorToken = tokenRes?.editorToken || tokenRes
  const raw = await fetchCollaborationContent({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken
  })
  return blocksToMarkdown(raw)
}
