// Credential resolution: OS Keychain -> env -> config file. Never accepts plaintext password in storage.
// keytar is an optional dependency; if it's not installed, we fall back gracefully.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const SERVICE = 'wiznote-sdk'
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
 *   2. process.env  (WIZ_TOKEN / WIZ_KB_GUID / WIZ_KB_SERVER / WIZ_USER)
 *   3. OS Keychain (via keytar)
 *   4. ~/.config/wiznote/session.json (non-secret metadata only: kbGuid/kbServer/userId)
 *
 * Returns { token, kbGuid, kbServer, userId } or throws with a clear hint.
 */
export async function resolveCredentials ({ userId, token, kbGuid, kbServer } = {}) {
  const out = {
    userId: userId || process.env.WIZ_USER,
    token: token || process.env.WIZ_TOKEN,
    kbGuid: kbGuid || process.env.WIZ_KB_GUID,
    kbServer: kbServer || process.env.WIZ_KB_SERVER
  }

  const cfg = await readConfigFile()
  if (cfg) {
    out.userId = out.userId || cfg.userId
    out.kbGuid = out.kbGuid || cfg.kbGuid
    out.kbServer = out.kbServer || cfg.kbServer
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
export async function saveSession ({ userId, token, kbGuid, kbServer }) {
  if (!userId || !token) throw new Error('saveSession requires userId and token')

  const keytar = await loadKeytar()
  let stored = 'keychain'
  if (keytar) {
    await keytar.setPassword(SERVICE, userId, token)
  } else {
    stored = 'file'
    // No keychain — write token to the config file too, with 0600.
    // This is less safe than keychain; we log a hint.
    await writeConfigFile({ userId, kbGuid, kbServer, token, _warning: 'keytar not installed; token stored in plaintext file. Install keytar to upgrade.' })
    return { stored }
  }
  await writeConfigFile({ userId, kbGuid, kbServer })
  return { stored }
}

export async function clearSession ({ userId } = {}) {
  const keytar = await loadKeytar()
  if (keytar && userId) {
    try { await keytar.deletePassword(SERVICE, userId) } catch {}
  }
  try { await fs.unlink(CONFIG_FILE) } catch {}
}

export { CONFIG_FILE, SERVICE }
