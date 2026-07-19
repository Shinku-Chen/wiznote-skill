import { execRequest } from './request.js'

const DEFAULT_AS = 'https://as.wiz.cn'

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
}
