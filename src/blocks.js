// Markdown ↔ WizNote collaboration-note blocks converter.
// Ported from the Python skill's markdown_to_blocks / parse_collaboration_content
// (github.com/damoncui668/wiz-mcp, MIT).

import crypto from 'node:crypto'

const shortId = () => crypto.randomBytes(4).toString('hex')

// ────────────────────────────────────────────────────────────────────────────
// Markdown → blocks
// ────────────────────────────────────────────────────────────────────────────

const RE = {
  heading: /^(#{1,6})\s+(.+)$/,
  hr: /^(-{3,}|\*{3,}|_{3,})$/,
  check: /^(\s*)- \[([ xX])\] (.+)$/,
  ul: /^(\s*)[-*+]\s+(.+)$/,
  ol: /^(\s*)(\d+)\.\s+(.+)$/,
  img: /^!\[([^\]]*)\]\(([^)]+)\)$/,
  tableRow: /^\s*\|.+\|\s*$/,
  tableSep: /^\s*\|[\s\-:|]+\|\s*$/
}

const INLINE = new RegExp(
  '(\\*\\*\\*(.+?)\\*\\*\\*)' +           // ***bold-italic***
  '|(\\*\\*(.+?)\\*\\*)' +                 // **bold**
  '|(\\*(.+?)\\*)' +                       // *italic*
  '|(~~(.+?)~~)' +                         // ~~strike~~
  '|(`([^`]+)`)' +                         // `code`
  '|(\\[([^\\]]+)\\]\\(([^)]+)\\))' +      // [text](url)
  '|([^*~`\\[]+)',                         // plain
  'g'
)

/** Parse inline markdown into quill-like {insert, attributes} deltas. */
export function parseInline (text) {
  if (!text) return [{ insert: text || '' }]
  const out = []
  INLINE.lastIndex = 0
  let m
  while ((m = INLINE.exec(text)) !== null) {
    if (m[2] !== undefined) out.push({ insert: m[2], attributes: { 'style-bold': true, 'style-italic': true } })
    else if (m[4] !== undefined) out.push({ insert: m[4], attributes: { 'style-bold': true } })
    else if (m[6] !== undefined) out.push({ insert: m[6], attributes: { 'style-italic': true } })
    else if (m[8] !== undefined) out.push({ insert: m[8], attributes: { 'style-strikethrough': true } })
    else if (m[10] !== undefined) out.push({ insert: m[10], attributes: { 'style-code': true } })
    else if (m[12] !== undefined) out.push({ insert: m[12], attributes: { link: m[13] } })
    else if (m[14] !== undefined) out.push({ insert: m[14] })
  }
  return out.length ? out : [{ insert: text }]
}

/**
 * Convert a markdown string to a WizNote collaboration-note blocks array.
 * Returns { blocks, extras } — extras keyed by their __id go alongside blocks
 * in the final `data.blocks` array under the same key.
 */
export function markdownToBlocks (md) {
  if (!md || !md.trim()) return { blocks: [], extras: {} }
  const blocks = []
  const extras = {}
  const lines = md.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // blank
    if (!line.trim()) { i++; continue }

    // code fence
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]); i++
      }
      i++ // consume closing ```
      const codeId = shortId()
      const childId = `_code_${codeId}_0`
      blocks.push({ id: codeId, type: 'code', language: lang, children: [childId] })
      extras[childId] = { __id: childId, __type: 'code_cell', text: [{ insert: codeLines.join('\n') }] }
      continue
    }

    // heading
    const h = RE.heading.exec(line)
    if (h) {
      blocks.push({
        id: shortId(),
        type: 'text',
        text: parseInline(h[2]),
        heading: Math.min(h[1].length, 6)
      })
      i++; continue
    }

    // hr
    if (RE.hr.test(line.trim())) {
      blocks.push({ id: shortId(), type: 'embed', embedType: 'hr', embedData: {} })
      i++; continue
    }

    // quote
    if (line.trim().startsWith('>')) {
      const t = line.trim().replace(/^>\s*/, '')
      blocks.push({ id: shortId(), type: 'text', text: parseInline(t), quoted: true })
      i++; continue
    }

    // checkbox
    const cb = RE.check.exec(line)
    if (cb) {
      blocks.push({
        id: shortId(), type: 'list',
        text: parseInline(cb[3]),
        level: Math.floor(cb[1].length / 2) + 1,
        checkbox: cb[2] !== ' ' ? 'checked' : 'unchecked'
      })
      i++; continue
    }

    // unordered list
    const ul = RE.ul.exec(line)
    if (ul) {
      blocks.push({
        id: shortId(), type: 'list',
        text: parseInline(ul[2]),
        level: Math.floor(ul[1].length / 2) + 1
      })
      i++; continue
    }

    // ordered list
    const ol = RE.ol.exec(line)
    if (ol) {
      blocks.push({
        id: shortId(), type: 'list',
        text: parseInline(ol[3]),
        level: Math.floor(ol[1].length / 2) + 1,
        ordered: true,
        start: parseInt(ol[2], 10)
      })
      i++; continue
    }

    // table (header | separator | rows...)
    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const headers = line.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim())
      i += 2
      const rows = []
      while (i < lines.length && RE.tableRow.test(lines[i])) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim()))
        i++
      }
      const cols = headers.length
      const tableId = shortId()
      const cellIds = []
      // headers first, then rows flattened
      const allCells = headers.concat(...rows.map(r => {
        while (r.length < cols) r.push('')
        return r.slice(0, cols)
      }))
      allCells.forEach((cell, idx) => {
        const cid = `_table_${tableId}_${idx}`
        cellIds.push(cid)
        extras[cid] = { __id: cid, __type: 'table_cell', text: [{ insert: cell }] }
      })
      blocks.push({ id: tableId, type: 'table', cols, children: cellIds })
      continue
    }

    // image
    const img = RE.img.exec(line.trim())
    if (img) {
      blocks.push({
        id: shortId(), type: 'embed', embedType: 'image',
        embedData: { src: img[2], alt: img[1] }
      })
      i++; continue
    }

    // paragraph
    blocks.push({ id: shortId(), type: 'text', text: parseInline(line) })
    i++
  }

  return { blocks, extras }
}

// ────────────────────────────────────────────────────────────────────────────
// blocks → Markdown
// ────────────────────────────────────────────────────────────────────────────

function renderText (arr = []) {
  return arr.map(t => {
    const s = t.insert || ''
    const a = t.attributes || {}
    if (a['style-bold'] && a['style-italic']) return `***${s}***`
    if (a['style-bold']) return `**${s}**`
    if (a['style-italic']) return `*${s}*`
    if (a['style-strikethrough']) return `~~${s}~~`
    if (a['style-code']) return `\`${s}\``
    if (a.link) return `[${s}](${a.link})`
    return s
  }).join('')
}

/**
 * Resolve an extra-block payload keyed by id. Handles two shapes:
 *  - Legacy / SDK-created: single object { text: [...] } — a code cell / simple cell.
 *  - Real WizNote: array of nested blocks [ {type:'text',text:[...]}, {type:'list',...}, ... ].
 * Returns a flat string with sub-block texts joined by spaces (whitespace-collapsed).
 */
function extraText (full, id) {
  const raw = full[id]
  if (!raw) return ''
  if (Array.isArray(raw)) {
    const parts = raw
      .map(b => Array.isArray(b?.text) ? renderText(b.text) : '')
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    return parts.join(' ')
  }
  if (Array.isArray(raw.text)) return renderText(raw.text)
  return ''
}

/**
 * Like extraText but preserves line structure — for code-cell content where
 * each sub-block is one line.
 */
function extraLines (full, id) {
  const raw = full[id]
  if (!raw) return ''
  if (Array.isArray(raw)) {
    return raw
      .map(b => Array.isArray(b?.text) ? renderText(b.text) : '')
      .join('\n')
  }
  if (Array.isArray(raw.text) && raw.text.length) return raw.text[0].insert || ''
  return ''
}

function renderBlock (full, b) {
  switch (b.type) {
    case 'text': {
      const s = renderText(b.text)
      if (b.heading) return '#'.repeat(b.heading) + ' ' + s
      if (b.quoted) return '> ' + s
      return s
    }
    case 'list': {
      const s = renderText(b.text)
      const indent = '  '.repeat(Math.max(0, (b.level || 1) - 1))
      let prefix = ''
      if (b.checkbox === 'checked') prefix = '[x] '
      else if (b.checkbox === 'unchecked') prefix = '[ ] '
      return b.ordered
        ? `${indent}${b.start || 1}. ${prefix}${s}`
        : `${indent}- ${prefix}${s}`
    }
    case 'code': {
      const lines = (b.children || []).map(cid => extraLines(full, cid))
      return '```' + (b.language || '') + '\n' + lines.join('\n') + '\n```'
    }
    case 'table': {
      const cols = b.cols || 0
      if (!cols) return ''
      const cells = (b.children || []).map(cid => extraText(full, cid))
      const header = '| ' + cells.slice(0, cols).join(' | ') + ' |'
      const sep = '| ' + Array(cols).fill('---').join(' | ') + ' |'
      const body = cells.slice(cols)
      const rows = []
      for (let i = 0; i < body.length; i += cols) {
        const r = body.slice(i, i + cols)
        while (r.length < cols) r.push('')
        rows.push('| ' + r.join(' | ') + ' |')
      }
      return header + '\n' + sep + (rows.length ? '\n' + rows.join('\n') : '')
    }
    case 'embed': {
      if (b.embedType === 'hr') return '---'
      if (b.embedType === 'image') return `![${b.embedData?.alt || ''}](${b.embedData?.src || ''})`
      return `<!-- embed: ${b.embedType} -->`
    }
    default:
      return ''
  }
}

/**
 * Parse the raw JSON string returned by the WebSocket "f" (fetch) response
 * into a Markdown string.
 */
export function blocksToMarkdown (raw) {
  let data
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return String(raw) }
  const inner = data?.data?.data
  if (!inner || !Array.isArray(inner.blocks)) {
    return JSON.stringify(data, null, 2)
  }
  const full = inner
  return inner.blocks.map(b => renderBlock(full, b)).filter(Boolean).join('\n')
}
