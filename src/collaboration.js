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
    await s.recv({ timeoutMs: 5000 }).catch(() => {})
  } finally {
    s.close()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// High-level helpers
// ────────────────────────────────────────────────────────────────────────────

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
  const editorToken = createRes.editor?.editorToken
  if (!docGuid || !editorToken) {
    throw new Error(`create collaboration note failed: ${JSON.stringify(createRes)}`)
  }
  if (markdown.trim()) {
    const { blocks, extras } = markdownToBlocks(markdown)
    await writeCollaborationBlocks({
      kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
      userGuid: wiz.userGuid, editorToken,
      blocks, extras, version: 0
    })
  }
  return { docGuid, editorToken, title, category }
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
