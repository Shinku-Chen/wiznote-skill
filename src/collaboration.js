// WizNote collaboration-note WebSocket protocol (sharejs JSONv1-ish).
// Requires the `ws` package (npm i ws). Ported from wiz_open_api.py.

import crypto from 'node:crypto'
import { execRequest } from './request.js'
import { markdownToBlocks, blocksToMarkdown } from './blocks.js'

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

/**
 * Get an editor token for a collaboration note (needed for WS handshake).
 */
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

/** Await one message from a WebSocket. */
function nextMessage (ws, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('WS recv timeout')), timeoutMs)
    ws.once('message', data => { clearTimeout(to); resolve(data.toString()) })
    ws.once('error', err => { clearTimeout(to); reject(err) })
    ws.once('close', () => { clearTimeout(to); reject(new Error('WS closed before message')) })
  })
}

async function openHandshake ({ kbServer, kbGuid, docGuid, userGuid, editorToken }) {
  const WS = await getWS()
  const ws = new WS(wsUrl(kbServer, kbGuid, docGuid))
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({
    a: 'hs', id: null,
    auth: { appId: kbGuid, docId: docGuid, userId: userGuid, permission: 'w', token: editorToken }
  }))
  await nextMessage(ws) // init
  return ws
}

/** Read the current collaboration document. Returns raw JSON string. */
export async function fetchCollaborationContent (opts) {
  const ws = await openHandshake(opts)
  try {
    ws.send(JSON.stringify({ a: 'f', c: opts.kbGuid, d: opts.docGuid, v: null }))
    await nextMessage(ws) // ack
    const content = await nextMessage(ws)
    ws.send(JSON.stringify({ a: 's', c: opts.kbGuid, d: opts.docGuid, v: null }))
    try { await nextMessage(ws, 2000) } catch {}
    return content
  } finally {
    ws.close()
  }
}

/**
 * Write blocks into a collaboration note.
 * @param {object} opts  { kbServer, kbGuid, docGuid, userGuid, editorToken, blocks, extras, version, deleteFirst }
 */
export async function writeCollaborationBlocks (opts) {
  const ws = await openHandshake(opts)
  try {
    // sync first
    ws.send(JSON.stringify({ a: 'f', c: opts.kbGuid, d: opts.docGuid, v: null }))
    await nextMessage(ws)
    const syncRaw = await nextMessage(ws)
    let v = opts.version ?? 0
    try {
      const serverV = JSON.parse(syncRaw)?.data?.v ?? 0
      if (serverV > v) v = serverV
    } catch {}

    const src = crypto.randomUUID().slice(0, 20)
    let seq = 1

    if (opts.deleteFirst) {
      ws.send(JSON.stringify({
        a: 'op', c: opts.kbGuid, d: opts.docGuid,
        v, src, seq, del: true
      }))
      await nextMessage(ws)
      seq++; v++
    }

    // Merge extras into a flat map keyed by __id, alongside the ordered `blocks` list
    const docData = {
      blocks: opts.blocks || [],
      comments: [], meta: {}, authors: [], commentators: []
    }
    // Extras (code cells, table cells) live at the top level keyed by __id
    for (const [id, extra] of Object.entries(opts.extras || {})) {
      docData[id] = extra
    }

    ws.send(JSON.stringify({
      a: 'op', c: opts.kbGuid, d: opts.docGuid,
      v, src, seq,
      create: {
        type: 'http://sharejs.org/types/JSONv1',
        data: docData
      }
    }))
    await nextMessage(ws)

    ws.send(JSON.stringify({ a: 's', c: opts.kbGuid, d: opts.docGuid, v: null }))
    try { await nextMessage(ws, 2000) } catch {}
  } finally {
    ws.close()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// High-level helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a collaboration note from a Markdown string.
 * Requires the wiznote-sdk WizClient (for kbServer + userGuid + token).
 */
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

/**
 * Overwrite a collaboration note with new Markdown (del + create).
 */
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
  const raw = await fetchCollaborationContent({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken
  })
  let currentV = 0, docType
  try {
    const parsed = JSON.parse(raw)
    currentV = parsed?.data?.v ?? 0
    docType = parsed?.data?.type
  } catch {}
  const { blocks, extras } = markdownToBlocks(markdown || '')
  const deleteFirst = !(docType === undefined || currentV === 0)
  await writeCollaborationBlocks({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken,
    blocks, extras, version: currentV, deleteFirst
  })
  return { docGuid, status: 'updated' }
}

/**
 * Fetch a collaboration note and return it as Markdown.
 * Auto-detects note type via getNoteContent; falls back to HTML for legacy notes.
 */
export async function readCollaborationNote (wiz, docGuid) {
  const detail = await wiz.kb.getNoteContent(docGuid)
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
