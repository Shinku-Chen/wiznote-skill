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

  updateNoteInfo (docGuid, data) {
    return execRequest('POST', this._kb(`/ks/note/upload/${this.kbGuid}/${docGuid}`), {
      body: data, token: this._t()
    })
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

  /** Move a note to a new category. */
  moveNote (docGuid, category) {
    return this.updateNoteInfo(docGuid, { category })
  }

  /** Rename a note's title without changing its category/tags. */
  renameNote (docGuid, title) {
    return this.updateNoteInfo(docGuid, { title })
  }

  // ── Resources (images embedded in note HTML) ───────────────────────────

  // NOTE: resource upload endpoint (`POST /ks/resource/upload/*`) returned
  // 500 / `kbGuid is not match` in probing against the public server; the
  // upstream contract is unclear, so we don't expose an upload method here.
  // Read-side (list / getUrl / download) works and is kept below.

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

  getComments (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/comment/list/${this.kbGuid}/${docGuid}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  addComment (docGuid, text) {
    return execRequest('POST',
      this._kb(`/ks/comment/create/${this.kbGuid}/${docGuid}`),
      {
        body: { text, docGuid, kbGuid: this.kbGuid },
        query: { clientType: 'web', clientVersion: '4.0' },
        token: this._t()
      })
  }

  deleteComment (docGuid, commentGuid) {
    return execRequest('DELETE',
      this._kb(`/ks/comment/delete/${this.kbGuid}/${docGuid}/${commentGuid}`),
      { token: this._t() })
  }

  // ── Note history / versions ────────────────────────────────────────────

  getNoteHistory (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/note/history/${this.kbGuid}/${docGuid}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  getNoteVersion (docGuid, versionId) {
    return execRequest('GET',
      this._kb(`/ks/note/version/${this.kbGuid}/${docGuid}/${versionId}`),
      { query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  // ── Sharing ────────────────────────────────────────────────────────────

  /**
   * @param {'read'|'edit'} access
   * @param {number} expireDays  0 = never expires
   */
  shareNote (docGuid, { access = 'read', expireDays = 30 } = {}) {
    return execRequest('POST',
      this._kb(`/ks/share/create/${this.kbGuid}/${docGuid}`),
      {
        body: {
          docGuid,
          kbGuid: this.kbGuid,
          access,
          expire: expireDays > 0 ? expireDays * 86400 : 0
        },
        token: this._t()
      })
  }

  listShares () {
    return execRequest('GET',
      this._kb(`/ks/share/list/${this.kbGuid}`),
      { token: this._t() })
  }

  cancelShare (shareId) {
    return execRequest('DELETE',
      this._kb(`/ks/share/delete/${this.kbGuid}/${shareId}`),
      { token: this._t() })
  }

  // ── Attachments (first-class file attachments) ─────────────────────────
  //
  // Only `listAttachments` is exposed. The `POST /ks/attachment/upload/*` and
  // `GET /ks/attachment/download/*` endpoints referenced by earlier revisions
  // return 404 on the public server (probed 2026-07-19). The correct upload/
  // download contract for attachments hasn't been reverse-engineered yet;
  // avoid exposing methods that never worked.

  /** List a note's attachments (metadata: name/size/hash/attGuid). */
  listAttachments (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/note/attachments/${this.kbGuid}/${docGuid}`),
      { query: { extra: 1, clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }
}
