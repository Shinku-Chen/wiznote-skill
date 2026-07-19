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

  // ── Resources ───────────────────────────────────────────────────────────

  /**
   * Upload image bound to a note.
   * @param {string} docGuid
   * @param {FormData} formData  must contain `file` field
   */
  uploadImage (docGuid, formData) {
    return execRequest('POST',
      this._kb(`/ks/resource/upload/${this.kbGuid}/${docGuid}`),
      { body: formData, token: this._t() })
  }
}
