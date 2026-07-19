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

  /**
   * Upload an image (or any binary) as a note resource.
   * WizNote's "image" resource endpoint accepts arbitrary blobs; keep this name
   * for backward compatibility. For file attachments, prefer `uploadAttachment`.
   * @param {string} docGuid
   * @param {FormData} formData  must contain `file` field
   */
  uploadImage (docGuid, formData) {
    return execRequest('POST',
      this._kb(`/ks/resource/upload/${this.kbGuid}/${docGuid}`),
      { body: formData, token: this._t() })
  }

  /** Alias for uploadImage — clearer name when uploading non-image binaries. */
  uploadResource (docGuid, formData) {
    return this.uploadImage(docGuid, formData)
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

  /** List a note's attachments (metadata: name/size/hash/attGuid). */
  listAttachments (docGuid) {
    return execRequest('GET',
      this._kb(`/ks/note/attachments/${this.kbGuid}/${docGuid}`),
      { query: { extra: 1, clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  /**
   * Upload a local file as an attachment.
   * @param {string} docGuid
   * @param {Blob|Buffer} fileData
   * @param {string} name  attachment filename
   */
  async uploadAttachment (docGuid, fileData, name) {
    if (!name) throw new Error('uploadAttachment requires a name')
    const form = new FormData()
    // Node's built-in FormData accepts Blob; wrap Buffer if needed
    let blob = fileData
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(fileData)) {
      blob = new Blob([fileData])
    }
    form.append('file', blob, name)
    return execRequest('POST',
      this._kb(`/ks/attachment/upload/${this.kbGuid}/${docGuid}`),
      { body: form, query: { clientType: 'web', clientVersion: '4.0' }, token: this._t() })
  }

  /**
   * Get a signed URL for an attachment (embed in <a href> etc.).
   * Note: WizNote's attachment endpoint expects the token in the X-Wiz-Token
   * header, not a query param, so browser <img src>/<a href> won't work
   * directly — use `downloadAttachment` for actual bytes.
   */
  getAttachmentUrl (docGuid, attGuid) {
    return `${this.baseUrl}/ks/attachment/download/${this.kbGuid}/${docGuid}/${attGuid}`
  }

  /**
   * Download an attachment as a Buffer.
   * @returns {Promise<Buffer>}
   */
  async downloadAttachment (docGuid, attGuid) {
    const url = this.getAttachmentUrl(docGuid, attGuid) +
      '?clientType=web&clientVersion=4.0'
    const res = await fetch(url, { headers: { 'X-Wiz-Token': this._t() } })
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  }
}
