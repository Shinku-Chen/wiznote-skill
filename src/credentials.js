// Credential resolution: OS Keychain -> env -> config file. Never accepts plaintext password in storage.
// keytar is an optional dependency; if it's not installed, we fall back gracefully.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const SERVICE = 'wiznote-sdk'
const PASSWORD_SERVICE = 'wiznote-sdk-password'
const CONFIG_DIR = path.join(os.homedir(), '.config', 'wiznote')
const CONFIG_FILE = path.join(CONFIG_DIR, 'session.json')

async function loadKeytar () {
  try {
    const mod = await import('keytar')
    return mod.default || mod
  } catch {
    return null
  }
}

async function readConfigFile () {
  try {
    const buf = await fs.readFile(CONFIG_FILE, 'utf8')
    return JSON.parse(buf)
  } catch {
    return null
  }
}

async function writeConfigFile (obj) {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 })
}

/**
 * Resolve credentials, in priority order:
 *   1. explicit args
 *   2. process.env  (WIZ_TOKEN / WIZ_KB_GUID / WIZ_KB_SERVER / WIZ_USER / WIZ_ENDPOINT / WIZ_ACCOUNT_URL)
 *   3. OS Keychain (via keytar)
 *   4. ~/.config/wiznote/session.json (non-secret metadata only)
 *
 * WIZ_ENDPOINT is a shortcut for on-premise deployments where account server and
 * knowledge base share the same host — if set, it fills in both accountBaseUrl
 * and kbServer defaults.
 *
 * Returns { token, kbGuid, kbServer, userId, accountBaseUrl } or throws.
 */
export async function resolveCredentials ({ userId, token, kbGuid, kbServer, accountBaseUrl, endpoint } = {}) {
  const envEndpoint = endpoint || process.env.WIZ_ENDPOINT
  const out = {
    userId: userId || process.env.WIZ_USER,
    token: token || process.env.WIZ_TOKEN,
    kbGuid: kbGuid || process.env.WIZ_KB_GUID,
    kbServer: kbServer || process.env.WIZ_KB_SERVER || envEndpoint,
    accountBaseUrl: accountBaseUrl || process.env.WIZ_ACCOUNT_URL || envEndpoint
  }

  out.userGuid = process.env.WIZ_USER_GUID

  const cfg = await readConfigFile()
  if (cfg) {
    out.userId = out.userId || cfg.userId
    out.userGuid = out.userGuid || cfg.userGuid
    out.kbGuid = out.kbGuid || cfg.kbGuid
    out.kbServer = out.kbServer || cfg.kbServer
    out.accountBaseUrl = out.accountBaseUrl || cfg.accountBaseUrl
  }

  if (!out.token && out.userId) {
    const keytar = await loadKeytar()
    if (keytar) {
      try {
        out.token = await keytar.getPassword(SERVICE, out.userId)
      } catch {
        // ignore keychain errors, fall through
      }
    }
  }

  // File fallback: when keytar is unavailable, saveSession stores the token in
  // the config file. Read it back here as the last resort (after env + keychain).
  if (!out.token && cfg && cfg.token) out.token = cfg.token

  if (!out.token) {
    throw new Error(
      'WizNote token not found. Options:\n' +
      '  1. Run `wiz login` to authenticate and store token in OS Keychain\n' +
      '  2. Set env: WIZ_TOKEN=... WIZ_KB_GUID=... WIZ_KB_SERVER=...\n' +
      '  3. Pass { token, kbGuid, kbServer } explicitly to WizClient'
    )
  }
  return out
}

/**
 * Persist a session after successful login.
 * Token -> OS Keychain (if available) or falls back to config file with 0600.
 * Non-secret metadata (userId/kbGuid/kbServer) -> config file.
 */
export async function saveSession ({ userId, token, kbGuid, kbServer, accountBaseUrl, userGuid }) {
  if (!userId || !token) throw new Error('saveSession requires userId and token')

  const keytar = await loadKeytar()
  let stored = 'keychain'
  if (keytar) {
    await keytar.setPassword(SERVICE, userId, token)
  } else {
    stored = 'file'
    await writeConfigFile({ userId, userGuid, kbGuid, kbServer, accountBaseUrl, token, _warning: 'keytar not installed; token stored in plaintext file. Install keytar to upgrade.' })
    return { stored }
  }
  await writeConfigFile({ userId, userGuid, kbGuid, kbServer, accountBaseUrl })
  return { stored }
}

export async function clearSession ({ userId } = {}) {
  const keytar = await loadKeytar()
  if (keytar && userId) {
    try { await keytar.deletePassword(SERVICE, userId) } catch {}
    try { await keytar.deletePassword(PASSWORD_SERVICE, userId) } catch {}
  }
  try { await fs.unlink(CONFIG_FILE) } catch {}
}

// ────────────────────────────────────────────────────────────────────────────
// Optional password storage (for auto-reauth on token expiry)
//
// Storing the password enables the SDK to silently re-login when the server
// rejects the token. This is a security trade-off: keychain is OS-encrypted
// and scoped per-user, but any process running as the user can call keytar to
// read it. Only enable if you understand this.
// ────────────────────────────────────────────────────────────────────────────

/** Persist a password to OS Keychain. Requires keytar. Throws if unavailable. */
export async function savePassword (userId, password) {
  if (!userId || !password) throw new Error('savePassword requires userId and password')
  const keytar = await loadKeytar()
  if (!keytar) {
    throw new Error(
      'savePassword requires keytar (OS Keychain). Install it:\n' +
      '  cd <skill-dir> && npm i --no-save keytar\n' +
      'We refuse to store passwords in the plain-text config file.'
    )
  }
  await keytar.setPassword(PASSWORD_SERVICE, userId, password)
  return { stored: 'keychain' }
}

/** Read a stored password from OS Keychain. Returns null if not set. */
export async function getStoredPassword (userId) {
  if (!userId) return null
  const keytar = await loadKeytar()
  if (!keytar) return null
  try { return await keytar.getPassword(PASSWORD_SERVICE, userId) } catch { return null }
}

/** Remove a stored password from OS Keychain. */
export async function clearStoredPassword (userId) {
  if (!userId) return
  const keytar = await loadKeytar()
  if (!keytar) return
  try { await keytar.deletePassword(PASSWORD_SERVICE, userId) } catch {}
}

export { CONFIG_FILE, SERVICE, PASSWORD_SERVICE }
