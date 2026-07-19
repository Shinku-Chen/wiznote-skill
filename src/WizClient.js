import { AccountServerApi } from './AccountServerApi.js'
import { KnowledgeBaseApi } from './KnowledgeBaseApi.js'
import { resolveCredentials, saveSession, clearSession } from './credentials.js'

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
  constructor ({ token, kbGuid, kbServer, userId, accountBaseUrl, endpoint } = {}) {
    if (!token) throw new Error('WizClient requires a token. Use WizClient.login() or WizClient.fromStored().')
    const finalKbServer = kbServer || endpoint
    const finalAsUrl = accountBaseUrl || endpoint
    if (!kbGuid || !finalKbServer) throw new Error('WizClient requires kbGuid and kbServer (or endpoint).')
    this.userId = userId
    this.token = token
    this.kbGuid = kbGuid
    this.kbServer = finalKbServer
    this.accountBaseUrl = finalAsUrl
    this.account = new AccountServerApi({ baseUrl: finalAsUrl })
    this.kb = new KnowledgeBaseApi({ baseUrl: finalKbServer, kbGuid, token })
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
  static async login ({ userId, password, accountBaseUrl, endpoint, persist = true }) {
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
        accountBaseUrl: asUrl
      })
    }
    return new WizClient({
      userId,
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
