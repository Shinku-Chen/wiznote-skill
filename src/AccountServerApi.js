import { execRequest } from './request.js'

// Public-cloud account server default. Historically as.wiz.cn; switched to
// note.wiz.cn (the brand domain, same AS API) — as.wiz.cn's cert has lapsed
// between ZeroSSL renewals. Override pre-login via --endpoint / WIZ_ENDPOINT /
// accountBaseUrl for on-premise or to pin the legacy host.
const DEFAULT_AS = 'https://note.wiz.cn'

export class AccountServerApi {
  constructor ({ baseUrl = DEFAULT_AS } = {}) {
    this.baseUrl = baseUrl
  }

  setBaseUrl (url) { this.baseUrl = url || DEFAULT_AS }

  /** POST /as/user/login  → { token, kbGuid, kbServer, userGuid, ... } */
  async login ({ userId, password }) {
    return execRequest('POST', `${this.baseUrl}/as/user/login`, {
      body: { userId, password }
    })
  }

  /** POST /as/user/login/token  → user info */
  async getUserInfo ({ token }) {
    return execRequest('POST', `${this.baseUrl}/as/user/login/token`, {
      body: { token }, token
    })
  }

  /** GET /as/user/avatar/:userGuid */
  async getUserAvatar ({ userGuid, token }) {
    return execRequest('GET', `${this.baseUrl}/as/user/avatar/${userGuid}`, { token })
  }

  /** GET /as/user/logout */
  async logout ({ token }) {
    return execRequest('GET', `${this.baseUrl}/as/user/logout`, { token })
  }

  /** GET /as/user/keep — refresh token TTL */
  async keepTokenAlive ({ token }) {
    return execRequest('GET', `${this.baseUrl}/as/user/keep`, { token })
  }

  // ── User account info ─────────────────────────────────────────────────

  /** GET /as/user/info — current-user info (name/email/quota/etc.) */
  async getMe ({ token }) {
    return execRequest('GET', `${this.baseUrl}/as/user/info`, { token })
  }

  /**
   * GET /as/user/kb/info/all — every kb the user can see (personal + groups).
   * Returns an array of `{kbGuid, noteCount, storageUsage, docVersion, …}`.
   * Server response does NOT include `kbServer` — use `getGroup(kbGuid)` for
   * a team kb to discover its KS host.
   */
  async listKbs ({ token }) {
    return execRequest('GET', `${this.baseUrl}/as/user/kb/info/all`, { token })
  }

  /** GET /as/user/kb/info/:kbGuid  — single-kb metadata (same shape as one entry from listKbs). */
  async getKb ({ kbGuid, token }) {
    return execRequest('GET', `${this.baseUrl}/as/user/kb/info/${kbGuid}`, { token })
  }

  /**
   * GET /as/user/groups/:kbGuid  — group / KB descriptor. Returns `kbServer`
   * (KS host), `type` ('person' | 'group'), `name`, `ownerGuid`, `isEncrypt`,
   * `myWizEmail`, etc. Works for both personal and team kbs.
   */
  async getGroup ({ kbGuid, token }) {
    return execRequest('GET', `${this.baseUrl}/as/user/groups/${kbGuid}`, { token })
  }

  // ── Sharing (public/team share links — LIVE ON AS, not KS) ────────────
  // /share/api/* endpoints per the official docs. Previous impl put them on
  // KS and 404'd. See https://www.wiz.cn/docs/restapi/as.html.

  /** GET /share/api/shares  — list your shares (paginated) OR fetch by docGuid. */
  listShares ({ token, page, size, kbGuid, docGuid } = {}) {
    return execRequest('GET', `${this.baseUrl}/share/api/shares`, {
      query: { page, size, kbGuid, docGuid }, token
    })
  }

  /** POST /share/api/shares  — create a share. Server assigns shareId + shareUrl. */
  createShare ({ token, kbGuid, docGuid, password, readCountLimit, expiredAt, friends }) {
    return execRequest('POST', `${this.baseUrl}/share/api/shares`, {
      body: { kbGuid, docGuid, password, readCountLimit, expiredAt, friends }, token
    })
  }

  /** PUT /share/api/shares/:shareId  — modify an existing share. */
  updateShare ({ token, shareId, password, readCountLimit, expiredAt, friends }) {
    return execRequest('PUT', `${this.baseUrl}/share/api/shares/${shareId}`, {
      body: { password, readCountLimit, expiredAt, friends }, token
    })
  }

  /** DELETE /share/api/shares/:shareId  — stop sharing. */
  cancelShare ({ token, shareId }) {
    return execRequest('DELETE', `${this.baseUrl}/share/api/shares/${shareId}`, { token })
  }

  /** GET /share/api/shares/:shareId  — read the shared content. */
  getShare ({ token, shareId }) {
    return execRequest('GET', `${this.baseUrl}/share/api/shares/${shareId}`, { token })
  }

  /** GET /share/api/shares/:shareId/clone  — save the shared note into your kb. */
  cloneShare ({ token, shareId }) {
    return execRequest('GET', `${this.baseUrl}/share/api/shares/${shareId}/clone`, { token })
  }
}
