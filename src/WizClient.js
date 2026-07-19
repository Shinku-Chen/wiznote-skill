import { AccountServerApi } from './AccountServerApi.js'
import { KnowledgeBaseApi } from './KnowledgeBaseApi.js'
import {
  resolveCredentials, saveSession, clearSession,
  savePassword, getStoredPassword, clearStoredPassword
} from './credentials.js'
import { WizApiError } from './request.js'
import {
  createCollaborationNote, updateCollaborationNote, readCollaborationNote,
  getCollaborationToken, fetchCollaborationContent,
  listCollaborationResources, downloadCollaborationResource,
  uploadCollabResource, appendCollabEmbeds, collabUploadAndEmbed,
  hasCollabResource
} from './collaboration.js'
import { uploadAndEmbed, attachAndLink } from './embed.js'
import { createMarkdownNote, updateMarkdownNote, readMarkdownNote } from './markdown.js'

/**
 * High-level client. Two ways to construct:
 *
 *   1. Already-authenticated:
 *        const wiz = await WizClient.fromStored()        // load from keychain/env
 *        const wiz = new WizClient({ token, kbGuid, kbServer })
 *
 *   2. Interactive login (persists on success):
 *        const wiz = await WizClient.login({ userId, password })
 */
export class WizClient {
  /**
   * @param {object} opts
   * @param {string} opts.token       X-Wiz-Token
   * @param {string} opts.kbGuid
   * @param {string} [opts.kbServer]  KS host, e.g. https://kshttps0.wiz.cn (or endpoint fallback)
   * @param {string} [opts.userId]
   * @param {string} [opts.accountBaseUrl]  AS host; defaults to endpoint or https://as.wiz.cn
   * @param {string} [opts.endpoint]  On-premise shortcut: fills accountBaseUrl AND kbServer.
   */
  constructor ({ token, kbGuid, kbServer, userId, userGuid, accountBaseUrl, endpoint } = {}) {
    if (!token) throw new Error('WizClient requires a token. Use WizClient.login() or WizClient.fromStored().')
    const finalKbServer = kbServer || endpoint
    const finalAsUrl = accountBaseUrl || endpoint
    if (!kbGuid || !finalKbServer) throw new Error('WizClient requires kbGuid and kbServer (or endpoint).')
    this.userId = userId
    this.userGuid = userGuid
    this.token = token
    this.kbGuid = kbGuid
    this.kbServer = finalKbServer
    this.accountBaseUrl = finalAsUrl
    this.account = new AccountServerApi({ baseUrl: finalAsUrl })
    this._kbInner = new KnowledgeBaseApi({ baseUrl: finalKbServer, kbGuid, token })
    // Expose kb via a Proxy that auto-retries on auth failure IF the user has
    // opted into password storage (savePassword). Otherwise pass through.
    this.kb = new Proxy(this._kbInner, {
      get: (target, prop) => {
        const orig = target[prop]
        if (typeof orig !== 'function') return orig
        return (...args) => {
          let result
          try { result = orig.apply(target, args) }
          catch (err) { throw err }
          // Sync methods (URL builders etc.) pass through unwrapped — else
          // callers get a Promise where a plain string is expected.
          if (!result || typeof result.then !== 'function') return result
          return result.catch(async err => {
            if (isAuthError(err) && await this._tryReauth()) {
              return orig.apply(target, args)
            }
            throw err
          })
        }
      }
    })
  }

  /**
   * Attempt to refresh credentials using a stored password (opt-in).
   * Returns true if reauth succeeded and this client's token was updated.
   */
  async _tryReauth () {
    if (this._reauthInFlight) return await this._reauthInFlight
    this._reauthInFlight = (async () => {
      if (!this.userId) return false
      const password = await getStoredPassword(this.userId)
      if (!password) return false
      try {
        const result = await this.account.login({ userId: this.userId, password })
        this.token = result.token
        this.userGuid = result.userGuid || this.userGuid
        // kbServer/kbGuid rarely change but refresh anyway
        this.kbGuid = result.kbGuid || this.kbGuid
        this.kbServer = result.kbServer || this.kbServer
        this._kbInner.setToken(this.token)
        // Persist the new token (best-effort)
        await saveSession({
          userId: this.userId,
          userGuid: this.userGuid,
          token: this.token,
          kbGuid: this.kbGuid,
          kbServer: this.kbServer,
          accountBaseUrl: this.accountBaseUrl
        }).catch(() => {})
        return true
      } catch {
        return false
      }
    })()
    try { return await this._reauthInFlight }
    finally { this._reauthInFlight = null }
  }

  /**
   * Upload local files as note resources AND splice them into the note HTML
   * in one shot. Auto-picks `<img>` / `<audio>` / `<video>` / `<a download>`
   * by file extension. See src/embed.js for options.
   */
  uploadAndEmbed (docGuid, items, opts) {
    return uploadAndEmbed(this, docGuid, items, opts)
  }

  /**
   * Upload local files as first-class attachments (they appear in the
   * WizNote attachment panel) AND add a download link into the note body.
   * See src/embed.js for options.
   */
  attachAndLink (docGuid, items, opts) {
    return attachAndLink(this, docGuid, items, opts)
  }

  // ── Sharing (public/team share links — AS domain) ─────────────────────

  /** Create a share link. Returns `{shareId, shareUrl, …}`. */
  createShare ({ docGuid, password, readCountLimit, expiredAt, friends } = {}) {
    return this.account.createShare({
      token: this.token, kbGuid: this.kbGuid,
      docGuid, password, readCountLimit, expiredAt, friends
    })
  }
  /** Look up shares — no args = list yours; `{docGuid}` = fetch that doc's share. */
  listShares (opts = {}) {
    return this.account.listShares({
      token: this.token, kbGuid: this.kbGuid, ...opts
    })
  }
  /** Stop a share by id. */
  cancelShare (shareId) { return this.account.cancelShare({ token: this.token, shareId }) }
  /** Modify an existing share (password / expiry / read limit / friends). */
  updateShare (shareId, patch) { return this.account.updateShare({ token: this.token, shareId, ...(patch || {}) }) }
  /** Read the shared content. */
  getShare (shareId) { return this.account.getShare({ token: this.token, shareId }) }
  /** Save someone's shared note into your own kb. */
  cloneShare (shareId) { return this.account.cloneShare({ token: this.token, shareId }) }

  // ── Markdown notes (type='lite/markdown') ────────────────────────────
  // WizNote's markdown editor requires a full <!doctype html>…<pre>…</pre>
  // shell; raw markdown alone or the document-note wrapper renders blank.

  /** Create a `lite/markdown` note from a markdown string. */
  createMarkdownNote (opts) { return createMarkdownNote(this, opts) }

  /** Overwrite a markdown note's body (and optionally its title). */
  updateMarkdownNote (opts) { return updateMarkdownNote(this, opts) }

  /** Read a markdown note back as raw markdown source. */
  readMarkdownNote (docGuid) { return readMarkdownNote(this, docGuid) }

  // ── Collaboration notes (require `ws` package; on-premise / modern WizNote) ──

  /** Create a collaboration note from Markdown. */
  createCollaborationNote (opts) { return createCollaborationNote(this, opts) }

  /** Overwrite an existing collaboration note. */
  updateCollaborationNote (opts) { return updateCollaborationNote(this, opts) }

  /** Read a collaboration note as Markdown (auto-falls back to HTML for legacy notes). */
  readCollaborationNote (docGuid) { return readCollaborationNote(this, docGuid) }

  /** List images/files embedded in a collaboration note. */
  listCollaborationResources (docGuid) { return listCollaborationResources(this, docGuid) }

  /** Download a single collab-note resource (returns { buffer, contentType, name }). */
  downloadCollaborationResource (docGuid, name) { return downloadCollaborationResource(this, docGuid, name) }

  /** Upload one file into a collab note's resource bucket. Returns embed metadata. */
  uploadCollabResource (docGuid, buffer, name) { return uploadCollabResource(this, docGuid, buffer, name) }

  /** Append embed blocks (from `uploadCollabResource` results) to a collab note. */
  appendCollabEmbeds (docGuid, items, opts) { return appendCollabEmbeds(this, docGuid, items, opts) }

  /** One-shot: upload files AND insert matching embed blocks in a collab note. */
  collabUploadAndEmbed (docGuid, items, opts) { return collabUploadAndEmbed(this, docGuid, items, opts) }

  /** Cheap dedupe probe: does the KS already have these bytes? */
  hasCollabResource (docGuid, bufferOrHash) { return hasCollabResource(this, docGuid, bufferOrHash) }

  /** Low-level: get an editor token. */
  getCollaborationToken (docGuid) {
    return getCollaborationToken({ kbServer: this.kbServer, kbGuid: this.kbGuid, docGuid, token: this.token })
  }

  /** Low-level: raw fetch of the WS document JSON. */
  fetchCollaborationContent (docGuid, editorToken) {
    return fetchCollaborationContent({
      kbServer: this.kbServer, kbGuid: this.kbGuid, docGuid,
      userGuid: this.userGuid, editorToken
    })
  }

  /** Load from OS Keychain / env / config file. */
  static async fromStored (overrides = {}) {
    const c = await resolveCredentials(overrides)
    return new WizClient(c)
  }

  /**
   * Interactive login. Password is sent once to the account server, never persisted.
   * On success: token -> OS Keychain, kbGuid/kbServer/userId -> ~/.config/wiznote/session.json
   */
  /** Helper for callers who want to save/clear password out of band. */
  static async savePassword (userId, password) { return savePassword(userId, password) }
  static async clearStoredPassword (userId) { return clearStoredPassword(userId) }

  static async login ({ userId, password, accountBaseUrl, endpoint, persist = true, savePassword: doSavePassword = true }) {
    if (!userId || !password) throw new Error('login requires userId and password')
    const asUrl = accountBaseUrl || endpoint
    const account = new AccountServerApi({ baseUrl: asUrl })
    const result = await account.login({ userId, password })
    // If server returned an on-premise kbServer that matches the endpoint host, keep endpoint for consistency
    const kbServer = result.kbServer || endpoint
    if (persist) {
      await saveSession({
        userId,
        token: result.token,
        kbGuid: result.kbGuid,
        kbServer,
        accountBaseUrl: asUrl,
        userGuid: result.userGuid
      })
    }
    if (doSavePassword) {
      // Password storage requires keytar. If unavailable, warn and continue
      // rather than fail login — auto-reauth just won't work until keytar is installed.
      try { await savePassword(userId, password) }
      catch (e) { console.error(`[wiz] password not stored: ${e.message.split('\n')[0]}`) }
    }
    return new WizClient({
      userId,
      userGuid: result.userGuid,
      token: result.token,
      kbGuid: result.kbGuid,
      kbServer,
      accountBaseUrl: asUrl
    })
  }

  async logout () {
    try { await this.account.logout({ token: this.token }) } catch {}
    await clearSession({ userId: this.userId })
  }

  async keepAlive () {
    return this.account.keepTokenAlive({ token: this.token })
  }
}

/**
 * Classify an error as "the server rejected our token, try reauth".
 * WizNote's known auth-failure codes are 301 / 322 / 31001; we also match on
 * message text as a safety net.
 */
function isAuthError (err) {
  if (!err) return false
  if (err instanceof WizApiError) {
    if ([301, 322, 31001].includes(err.code)) return true
  }
  const msg = String(err.message || '').toLowerCase()
  return /invalid token|token.*expired|not logged|unauthorized|无效.*token|token.*失效/i.test(msg)
}
