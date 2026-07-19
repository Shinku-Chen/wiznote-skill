// Low-level HTTP for WizNote. Node 18+ built-in fetch, no axios.
// Decoupled from any project storage/event-bus — token is injected explicitly.

export class WizApiError extends Error {
  constructor (message, { returnCode, externCode } = {}) {
    super(message)
    this.name = 'WizApiError'
    this.code = returnCode
    this.externCode = externCode
  }
}

/**
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} url
 * @param {object} opts
 * @param {any}    [opts.body]           request body (object -> JSON, FormData -> multipart)
 * @param {object} [opts.query]          query string params
 * @param {string} [opts.token]          X-Wiz-Token
 * @param {object} [opts.headers]        extra headers
 * @param {number} [opts.timeout=50000]  ms
 * @param {boolean}[opts.returnFullResult=false] return whole body vs `.result`
 * @param {boolean}[opts.ignoreStatusCode=false] don't throw on returnCode !== 200
 */
export async function execRequest (method, url, opts = {}) {
  const {
    body,
    query,
    token,
    headers = {},
    timeout = 50000,
    returnFullResult = false,
    ignoreStatusCode = false
  } = opts

  let finalUrl = url
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.append(k, String(v))
    }
    finalUrl += (url.includes('?') ? '&' : '?') + qs.toString()
  }

  const finalHeaders = { ...headers }
  if (token) finalHeaders['X-Wiz-Token'] = token

  let finalBody
  if (body != null) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      finalBody = body // fetch sets multipart boundary automatically
    } else {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json'
      finalBody = typeof body === 'string' ? body : JSON.stringify(body)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  let data
  try {
    const res = await fetch(finalUrl, {
      method,
      headers: finalHeaders,
      body: finalBody,
      signal: controller.signal
    })
    const text = await res.text()
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text }
    }
  } finally {
    clearTimeout(timer)
  }

  if (!ignoreStatusCode && data && data.returnCode !== 200 && data.code !== 200) {
    throw new WizApiError(data.returnMessage || 'WizNote API error', {
      returnCode: data.returnCode,
      externCode: data.externCode
    })
  }

  return typeof data === 'object' && 'result' in data && !returnFullResult
    ? data.result
    : data
}
