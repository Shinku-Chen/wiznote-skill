// High-level helpers for WizNote's `lite/markdown` note type.
//
// WizNote's editor stores markdown-flavoured notes as a full HTML5 document
// with the raw markdown wrapped in a single <pre> inside <body>:
//
//   <!doctype html>
//   <html>
//     <head><meta charset="utf-8"></head>
//     <body><pre>…markdown source…</pre></body>
//   </html>
//
// If you skip the shell (raw markdown in `html`) or use the wrong shell
// (`<div class="wiz-note-body">`, which is for `type: 'document'` notes),
// the WizNote client shows a blank body — the content is stored but the
// editor can't find the <pre> to render.

function esc (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Wrap raw markdown into the shell WizNote's `lite/markdown` editor expects.
 * Exported for tests and for callers who want the string without a REST call.
 */
export function wrapMarkdown (markdown) {
  return '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8">\n  </head>\n  <body>\n    <pre>' +
    esc(markdown || '') +
    '</pre>\n  </body>\n</html>'
}

const PRE_RE = /<pre[^>]*>([\s\S]*?)<\/pre>/i

/**
 * Extract the raw markdown source back out of a `lite/markdown` note's html
 * field. Falls back to returning the input if no `<pre>` is found (so notes
 * stored in a slightly different shell still round-trip something usable).
 */
export function unwrapMarkdown (html) {
  if (!html) return ''
  const m = PRE_RE.exec(html)
  if (!m) return html
  return m[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')  // last — the reverse of esc's escape order
}

/**
 * Create a new `lite/markdown` note from a markdown string.
 *
 * To backdate, pass `created` / `dataModified` (ms epoch). `/ks/note/create`
 * ignores these in its body (the server stamps "now"), so we apply them with a
 * follow-up `patchNoteInfo` — verified 2026-07-20 against `vipkshttps14.wiz.cn`.
 * Note `dataModified` must be the last write to a note: any later content save
 * resets it to now. `created` survives later edits.
 * @param {WizClient} wiz
 * @param {{title:string, markdown?:string, category?:string, tags?:string, created?:number, dataModified?:number}} opts
 * @returns {Promise<object>} the createNote response
 */
export async function createMarkdownNote (wiz, { title, markdown = '', category = '/My Notes/', tags = '', created, dataModified }) {
  if (!title) throw new Error('createMarkdownNote: title required')
  const res = await wiz.kb.createNote({
    kbGuid: wiz.kbGuid,
    owner: wiz.userId,
    category,
    title,
    tags,
    type: 'lite/markdown',
    html: wrapMarkdown(markdown)
  })
  const patch = {}
  if (created != null) patch.created = created
  if (dataModified != null) patch.dataModified = dataModified
  if (Object.keys(patch).length) await wiz.kb.patchNoteInfo(res.docGuid, patch)
  return res
}

/**
 * Overwrite a `lite/markdown` note's body (and optionally its title).
 * @param {WizClient} wiz
 * @param {{docGuid:string, markdown?:string, title?:string}} opts
 */
export async function updateMarkdownNote (wiz, { docGuid, markdown = '', title }) {
  if (!docGuid) throw new Error('updateMarkdownNote: docGuid required')
  if (title) {
    await wiz.kb.patchNoteInfo(docGuid, { title })
  }
  return wiz.kb.updateNote(docGuid, {
    kbGuid: wiz.kbGuid,
    docGuid,
    html: wrapMarkdown(markdown),
    url: '',
    tags: '',
    author: wiz.userId,
    resources: []
  })
}

/**
 * Read a `lite/markdown` note and return the raw markdown source.
 * For `document`-type notes, returns the html unchanged (no shell to unwrap).
 */
export async function readMarkdownNote (wiz, docGuid) {
  const d = await wiz.kb.getNoteContent(docGuid, { downloadInfo: 1, downloadData: 1 })
  if (d?.info?.type === 'lite/markdown') return unwrapMarkdown(d.html)
  return d?.html || ''
}
