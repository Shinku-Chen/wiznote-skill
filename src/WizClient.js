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
  constructor ({ token, kbGuid, kbServer, userId, accountBaseUrl } = {}) {
    if (!token) throw new Error('WizClient requires a token. Use WizClient.login() or WizClient.fromStored().')
    if (!kbGuid || !kbServer) throw new Error('WizClient requires kbGuid and kbServer.')
    this.userId = userId
    this.token = token
    this.kbGuid = kbGuid
    this.kbServer = kbServer
    this.account = new AccountServerApi({ baseUrl: accountBaseUrl })
    this.kb = new KnowledgeBaseApi({ baseUrl: kbServer, kbGuid, token })
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
  static async login ({ userId, password, accountBaseUrl, persist = true }) {
    if (!userId || !password) throw new Error('login requires userId and password')
    const account = new AccountServerApi({ baseUrl: accountBaseUrl })
    const result = await account.login({ userId, password })
    if (persist) {
      await saveSession({
        userId,
        token: result.token,
        kbGuid: result.kbGuid,
        kbServer: result.kbServer
      })
    }
    return new WizClient({
      userId,
      token: result.token,
      kbGuid: result.kbGuid,
      kbServer: result.kbServer,
      accountBaseUrl
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
