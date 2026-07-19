import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

const dir = process.argv[2] || process.env.T_WIN
if (!dir) { console.error('usage: probe-hash <dir>'); process.exit(1) }
for (const f of fs.readdirSync(dir)) {
  const buf = fs.readFileSync(path.join(dir, f))
  const b64url = crypto.createHash('sha256').update(buf).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  console.log(`${f}  size=${buf.length}  sha256(b64url)=${b64url}`)
}
