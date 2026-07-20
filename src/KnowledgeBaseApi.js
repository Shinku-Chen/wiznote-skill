import { execRequest } from './request.js'

// Every method takes an explicit token; the WizClient wrapper injects it automatically.
export class KnowledgeBaseApi {
  constructor ({ baseUrl, kbGuid, token }) {
    this.baseUrl = baseUrl
    this.kbGuid = kbGuid
    this.token = token
  }

  setBaseUrl (url) { this.baseUrl = url }
  setToken (token) { this.token = token }

  _kb (path) { return `${this.baseUrl}${path}` }
  _t () { return this.token }

  // ── KB metadata ─────────────────────────────────────────────────────────

  /**
   * KB info — includes `noteCount`, `storageUsage`, `noteCountLimit`,
   * `uploadSizeLimit`, several `docVersion` / `attVersion` / `tagVersion`
   * counters (useful for incremental sync).
   *
   * Note: `/ks/kb/:kb/document/count` in the official docs is IP-whitelisted
   * on the public server (returns "ip not in white ip list") — and its
   * `noteCount` is already in this response. Prefer this endpoint.
   */
  getKbInfo () {
    return execRequest('GET', this._kb(`/ks/kb/info/${this.kbGuid}`), {
      query: { clientType: 'web', clientVersion: '4.0' }, token: this._t()
    })
  }

  // ── Categories ──────────────────────────────────────────────────────────

  getCategories () {
    return execRequest('GET', this._kb(`/ks/category/all/${this.kbGuid}`), {
      token: this._t(), returnFullResult: true
    })
  }

  getCategoryNotes (data) {
    return execRequest('GET', this._kb(`/ks/note/list/category/${this.kbGuid}`), {
      query: data, token: this._t()
    })
  }

  createCategory (data) {
    return execRequest('POST',
      this._kb(`/ks/category/create/${this.kbGuid}?clientType=web&clientVersion=3.0&lang=zh-cn`),
      { body: data, token: this._t() })
  }

  deleteCategory (data) {
    return execRequest('DELETE', this._kb(`/ks/category/delete/${this.kbGuid}`), {
      query: data, token: this._t()
    })
  }

  renameCategory (data) {
    return execRequest('PUT', this._kb(`/ks/category/rename/${this.kbGuid}`), {
      body: data, token: this._t()
    })
  }

  /**
   * Reorder folders. `positions` is an object mapping category path → sort key.
   * Example: { '/My Notes/': 0, '/Work/': 1, '/Archive/': 2 }.
   */
  sortCategories (positions) {
    return execRequest('PUT', this._kb(`/ks/category/sort/${this.kbGuid}`), {
      body: positions, token: this._t()
    })
  }

  // ── Notes ───────────────────────────────────────────────────────────────

  getNoteInfo (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/note/info/${this.kbGuid}/${docGuid}?clientType=web&clientVersion=3.0&lang=zh-cn`),
      { token: this._t() })
  }

  getNoteContent (docGuid, { downloadInfo = 1, downloadData = 1 } = {}) {
    return execRequest('GET', this._kb(`/ks/note/download/${this.kbGuid}/${docGuid}`), {
      query: { downloadInfo, downloadData }, token: this._t()
    })
  }

  createNote (data) {
    return execRequest('POST', this._kb(`/ks/note/create/${this.kbGuid}`), {
      body: data, token: this._t()
    })
  }

  updateNote (docGuid, data) {
    return execRequest('PUT',
      this._kb(`/ks/note/save/${this.kbGuid}/${docGuid}?clientType=web&clientVersion=3.0&lang=zh-cn`),
      { body: data, token: this._t() })
  }

  /**
   * Raw metadata upload. ⚠️ `/ks/note/upload` is a FULL-OBJECT OVERWRITE, not a
   * partial patch: any writable field you omit is reset (e.g. `type`,
   * `attachmentCount`, `protected` → null). New clients reject notes whose
   * `attachmentCount` is null instead of a number. Also requires `kbGuid` +
   * `docGuid` in the body (else the server answers `kbGuid is not match`).
   *
   * Pass a COMPLETE metadata object here, or use {@link patchNoteInfo} to change
   * a few fields while preserving the rest.
   */
  updateNoteInfo (docGuid, data) {
    return execRequest('POST', this._kb(`/ks/note/upload/${this.kbGuid}/${docGuid}`), {
      body: data, token: this._t()
    })
  }

  /**
   * Safely change a few metadata fields on a note. Fetches the current info,
   * merges `patch` over it, and re-uploads the complete object — so unrelated
   * fields (`type`, `attachmentCount`, `protected`, `owner`, `tags`, …) survive.
   *
   * ⚠️ `tags` MUST be echoed back: `/ks/note/upload` is a full overwrite, so a
   * body without `tags` wipes the note's tag associations (verified 2026-07-20).
   * @param {string} docGuid
   * @param {object} patch  fields to override, e.g. `{ category }` or `{ title }`
   */
  async patchNoteInfo (docGuid, patch = {}) {
    const detail = await this.getNoteContent(docGuid, { downloadInfo: 1, downloadData: 0 })
    const info = detail?.info || {}
    const body = {
      kbGuid: this.kbGuid,
      docGuid,
      title: info.title,
      category: info.category,
      owner: info.owner,
      protected: info.protected ?? 0,
      readCount: info.readCount ?? 0,
      attachmentCount: info.attachmentCount ?? 0,
      type: info.type || 'lite/markdown',
      fileType: info.fileType ?? '',
      created: info.created,
      tags: info.tags ?? '',
      keywords: info.keywords ?? '',
      url: info.url ?? '',
      ...patch
    }
    return this.updateNoteInfo(docGuid, body)
  }

  deleteNote (docGuid) {
    return execRequest('DELETE', this._kb(`/ks/note/delete/${this.kbGuid}/${docGuid}`), {
      token: this._t()
    })
  }

  copyNote (docGuid, data) {
    return execRequest('POST', this._kb(`/ks/note/copy/${this.kbGuid}/${docGuid}`), {
      body: data, token: this._t()
    })
  }

  searchNote (data) {
    return execRequest('GET', this._kb(`/ks/note/search/${this.kbGuid}`), {
      query: data, token: this._t()
    })
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  getAllTags () {
    return execRequest('GET', this._kb(`/ks/tag/all/${this.kbGuid}`), { token: this._t() })
  }

  getTagNotes (data) {
    return execRequest('GET', this._kb(`/ks/note/list/tag/${this.kbGuid}`), {
      query: data, token: this._t()
    })
  }

  createTag (data) {
    return execRequest('POST', this._kb(`/ks/tag/create/${this.kbGuid}`), {
      body: data, token: this._t()
    })
  }

  renameTag (data) {
    return execRequest('PUT', this._kb(`/ks/tag/rename/${this.kbGuid}`), {
      body: data, token: this._t()
    })
  }

  moveTag (data) {
    return execRequest('PUT', this._kb(`/ks/tag/move/${this.kbGuid}`), {
      body: data, token: this._t()
    })
  }

  deleteTag (tagGuid) {
    return execRequest('DELETE', this._kb(`/ks/tag/delete/${this.kbGuid}/${tagGuid}`), {
      token: this._t()
    })
  }

  // ── Note convenience wrappers ──────────────────────────────────────────

  /** Move a note to a new category (preserves all other metadata). */
  moveNote (docGuid, category) {
    return this.patchNoteInfo(docGuid, { category })
  }

  /** Rename a note's title without changing its category/tags/other metadata. */
  renameNote (docGuid, title) {
    return this.patchNoteInfo(docGuid, { title })
  }

  // ── Resources (images embedded in note HTML) ───────────────────────────

  /**
   * Upload a binary as a note resource (image, file — any blob).
   * Server returns `{ name, url }` where `url` is a relative path (e.g.
   * `index_files/<name>`) to be embedded in the note HTML.
   *
   * Per official docs: multipart field is `data` (not `file`); the form
   * MUST also carry `kbGuid` and `docGuid` fields, else the server rejects
   * with `kbGuid is not match`.
   *
   * @param {string} docGuid
   * @param {Buffer|Blob} fileData
   * @param {string} name  filename (e.g. `pic.png`); used as multipart filename
   */
  uploadResource (docGuid, fileData, name) {
    if (!name) throw new Error('uploadResource requires a name')
    const form = new FormData()
    let blob = fileData
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(fileData)) blob = new Blob([fileData])
    form.append('kbGuid', this.kbGuid)
    form.append('docGuid', docGuid)
    form.append('data', blob, name)
    return execRequest('POST',
      this._kb(`/ks/resource/upload/${this.kbGuid}/${docGuid}`),
      { body: form, query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  /** Alias, historical name — same call. */
  uploadImage (docGuid, fileData, name) {
    return this.uploadResource(docGuid, fileData, name)
  }

  /**
   * List all resources embedded in a note (images, css, files).
   * Each item: { name, size, time, url } — url is a signed download URL and
   * needs NO auth header; plain fetch(url) works.
   */
  async listResources (docGuid) {
    const detail = await this.getNoteContent(docGuid, { downloadInfo: 1, downloadData: 1 })
    return detail?.resources || []
  }

  /**
   * Get the signed download URL for a single resource by name.
   * Returns null if the resource isn't found on the note.
   */
  async getResourceUrl (docGuid, name) {
    const list = await this.listResources(docGuid)
    const hit = list.find(r => r.name === name)
    return hit?.url || null
  }

  /**
   * Download a resource by name.
   * @returns {Promise<Buffer>}
   */
  async downloadResource (docGuid, name) {
    const url = await this.getResourceUrl(docGuid, name)
    if (!url) throw new Error(`resource "${name}" not found on note ${docGuid}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`resource download failed: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  // ── Comments ───────────────────────────────────────────────────────────
  // Paths per official docs (was broken with fabricated /ks/comment/list|create paths):
  //   GET    /ks/note/comments/:kb/:doc                     list
  //   POST   /ks/comment/add/:kb/:doc      body {body,…}    create (field is `body`, not `text`)
  //   DELETE /ks/comment/delete/:kb/:doc   ?sn=<n>          delete by sn
  //   GET    /ks/note/comments/count/:kb/:doc               count only

  getComments (docGuid, { extra = false } = {}) {
    return execRequest('GET',
      this._kb(`/ks/note/comments/${this.kbGuid}/${docGuid}`),
      { query: { extra: extra ? 'true' : 'false', clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  /** @param {string} body  Comment text (WizNote calls it `body`). */
  addComment (docGuid, body) {
    return execRequest('POST',
      this._kb(`/ks/comment/add/${this.kbGuid}/${docGuid}`),
      {
        body: { kbGuid: this.kbGuid, docGuid, body },
        query: { clientType: 'web', clientVersion: '4.0' },
        token: this._t()
      })
  }

  /** @param {number|string} sn  The comment's `sn` (sequence) — returned in the list. */
  deleteComment (docGuid, sn) {
    return execRequest('DELETE',
      this._kb(`/ks/comment/delete/${this.kbGuid}/${docGuid}`),
      { query: { sn, clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  getCommentCount (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/note/comments/count/${this.kbGuid}/${docGuid}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  // ── Note history / versions ────────────────────────────────────────────
  // Official: GET /ks/history/list/:kb/:doc?objType=document|attachment&objGuid=<guid>
  // (previous impl used non-existent /ks/note/history and /ks/note/version paths.)

  getNoteHistory (docGuid, { objType = 'document', objGuid } = {}) {
    return execRequest('GET',
      this._kb(`/ks/history/list/${this.kbGuid}/${docGuid}`),
      {
        query: { objType, objGuid: objGuid || docGuid, clientType: 'web', clientVersion: '4.0' },
        token: this._t(), returnFullResult: true
      })
  }

  /** History of a specific attachment (per-object timeline). */
  getAttachmentHistory (docGuid, attGuid) {
    return this.getNoteHistory(docGuid, { objType: 'attachment', objGuid: attGuid })
  }

  // ── Favorites (likes) ──────────────────────────────────────────────────
  // GET/POST/DELETE /ks/favor/:kb/:doc

  listFavors (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/favor/${this.kbGuid}/${docGuid}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  addFavor (docGuid) {
    return execRequest('POST',
      this._kb(`/ks/favor/${this.kbGuid}/${docGuid}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  removeFavor (docGuid) {
    return execRequest('DELETE',
      this._kb(`/ks/favor/${this.kbGuid}/${docGuid}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  // ── Note abstract (thumbnail image) ───────────────────────────────────

  /**
   * Fetch the note's thumbnail image (PNG). Some notes don't have one — this
   * returns null on 404 instead of throwing.
   * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
   */
  async getNoteAbstract (docGuid) {
    const url = this._kb(`/ks/note/abstract/${this.kbGuid}/${docGuid}`) +
      '?clientType=web&clientVersion=4.0'
    const res = await fetch(url, { headers: { 'X-Wiz-Token': this._t() } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`abstract fetch failed: HTTP ${res.status}`)
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream'
    }
  }

  // ── Unified object download ───────────────────────────────────────────

  /**
   * Generic download endpoint that works for document / attachment / resource /
   * abstract via `objType`. Returns a Buffer.
   *
   * @param {string} docGuid
   * @param {{objType: 'document'|'attachment'|'resource'|'abstract', objId?: string}} opts
   */
  async downloadObject (docGuid, { objType, objId } = {}) {
    if (!objType) throw new Error('downloadObject: objType required')
    const url = this._kb(`/ks/object/download/${this.kbGuid}/${docGuid}`) +
      `?objType=${encodeURIComponent(objType)}` +
      (objId ? `&objId=${encodeURIComponent(objId)}` : '') +
      '&clientType=web&clientVersion=4.0'
    const res = await fetch(url, { headers: { 'X-Wiz-Token': this._t() } })
    if (!res.ok) throw new Error(`object download failed: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  // ── Attachments (first-class file attachments) ─────────────────────────

  /** List a note's attachments (metadata: name/size/hash/attGuid). */
  listAttachments (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/note/attachments/${this.kbGuid}/${docGuid}`),
      { query: { extra: 1, clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  /**
   * Upload a local file as a note attachment. Returns the server response
   * including the new `att.attGuid` which subsequent download/delete calls
   * need.
   *
   * The endpoint is `attachment/create` (not `upload`). Form MUST carry
   * `kbGuid` + `docGuid` fields alongside the file — WizNote validates
   * those against the path segments before accepting the blob.
   *
   * @param {string} docGuid
   * @param {Buffer|Blob} fileData
   * @param {string} name attachment filename
   */
  uploadAttachment (docGuid, fileData, name) {
    if (!name) throw new Error('uploadAttachment requires a name')
    const form = new FormData()
    let blob = fileData
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(fileData)) blob = new Blob([fileData])
    form.append('kbGuid', this.kbGuid)
    form.append('docGuid', docGuid)
    form.append('data', blob, name)
    return execRequest('POST',
      this._kb(`/ks/attachment/create/${this.kbGuid}/${docGuid}`),
      { body: form, query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  /**
   * Download an attachment as a Buffer.
   * @returns {Promise<Buffer>}
   */
  async downloadAttachment (docGuid, attGuid) {
    const url = this._kb(`/ks/attachment/download/${this.kbGuid}/${docGuid}/${attGuid}`) +
      '?clientType=web&clientVersion=4.0'
    const res = await fetch(url, { headers: { 'X-Wiz-Token': this._t() } })
    if (!res.ok) throw new Error(`attachment download failed: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  /** Raw download URL. Note: browsers can't use this directly — needs X-Wiz-Token header. */
  getAttachmentUrl (docGuid, attGuid) {
    return `${this.baseUrl}/ks/attachment/download/${this.kbGuid}/${docGuid}/${attGuid}`
  }

  /** Delete an attachment by attGuid. */
  deleteAttachment (docGuid, attGuid) {
    return execRequest('DELETE',
      this._kb(`/ks/attachment/delete/${this.kbGuid}/${docGuid}/${attGuid}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }
}
