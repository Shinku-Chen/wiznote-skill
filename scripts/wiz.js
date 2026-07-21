#!/usr/bin/env node
import { WizClient } from '../src/index.js'
import {
  resolveCredentials,
  setInsecureTlsUntil, getInsecureTlsUntil, clearInsecureTlsUntil
} from '../src/credentials.js'
import readline from 'node:readline'
import fs from 'node:fs/promises'
import path from 'node:path'

// Escape hatch for when WizNote's own server cert has expired (e.g. as.wiz.cn
// lapsing between ZeroSSL renewals). Three ways to skip TLS verification, all
// off by default (they weaken transport security, so must be turned on
// deliberately): the one-shot `--insecure` flag, the WIZ_INSECURE_TLS env var,
// or a persisted time-boxed window set via `wiz insecure-tls on` (see below).
// Consume `--insecure` here so it's never mistaken for the command/positional.
const argv = process.argv.slice(2).filter(a => a !== '--insecure')
const insecureFlag = argv.length !== process.argv.length - 2 ||
  /^(1|true|yes)$/i.test(process.env.WIZ_INSECURE_TLS || '')
const [cmd, ...rest] = argv

// Turn off cert verification for this process, once. `why` explains the source
// so the stderr warning is actionable.
function disableTls (why) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  console.error(`⚠  TLS certificate verification DISABLED (${why}). Use only to work around an expired server cert.`)
}

function fmtRemaining (ms) {
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Resolve the effective insecure state, honouring (in order): the one-shot flag
// / env var, then the persisted auto-expiring window. Called at the top of
// main() so TLS is relaxed before any request fires.
async function applyInsecureTls () {
  if (insecureFlag) { disableTls('--insecure / WIZ_INSECURE_TLS'); return }
  const until = await getInsecureTlsUntil()
  if (!until) return
  const left = until - Date.now()
  if (left <= 0) { await clearInsecureTlsUntil(); return } // window elapsed — self-heal
  disableTls(`insecure-tls window active, ${fmtRemaining(left)} left → expires ${new Date(until).toLocaleString()}`)
}

function usage () {
  console.log(`wiz <command>

  login [--endpoint=URL] [--no-save-password]
                     Authenticate. Token + password both stored in OS Keychain
                     by default; auto-reauth kicks in when token expires.
                     --no-save-password: store only the token, no auto-reauth.
  logout             Clear stored token AND stored password
  save-password      Re-enable auto-reauth by storing password now
  forget-password    Disable auto-reauth by clearing the stored password only
  insecure-tls <on [--days=N] | off | status>
                     Global switch to ignore TLS cert errors (default 3 days,
                     auto-expires). Use only while a WizNote server cert is
                     lapsed; run 'insecure-tls off' once it's renewed.
  whoami             Show current session
  keep               Refresh the token's TTL (GET /as/user/keep)
  ls [category] [--start=N] [--count=N] [--all]
                     List notes in a category. Default: root, count=50.
                     --start=N   offset for pagination (default 0)
                     --count=N   page size (default 50, max 1000)
                     --all       auto-continue until exhausted
  cat <docGuid>      Print note content
  tags               List all tags
  categories         List category tree
  search <keyword>   Search notes

  mv <docGuid> <category>       Move note to a different folder
  rename <docGuid> <title>      Change note title

  attach ls <docGuid>                     List a note's attachments
  attach put <docGuid> <file> [name]      Upload a local file as attachment
  attach get <docGuid> <attGuid> [-o out] Download attachment (stdout if no -o)
  attach rm  <docGuid> <attGuid>          Delete an attachment
  attach url <docGuid> <attGuid>          Print raw download URL (needs X-Wiz-Token header)
  attach embed <docGuid> <file>...        Upload as attachment AND add a download
                                          link into note body. [--prepend] [--heading=".."]

  res ls <docGuid>                        List a note's embedded resources (images/files)
  res get <docGuid> <name> [-o out]       Download one resource
  res all <docGuid> [-o dir] [--user]     Download all resources to a dir
                                          --user: skip WizNote editor assets (editor_/scrollbar_/wiz*)
  res upload <docGuid> <file>...          Upload files AND embed into note body.
                                          Auto-picks <img>/<audio>/<video>/<a download>
                                          by extension. --prepend to insert at top.
                                          --heading="…" wraps the block in <h3>.

  md new "<title>" [-f md.md] [--category=/x/] [--created=<ms|date>] [--modified=<ms|date>]
                                          Create a lite/markdown note (single-user; HTML shell).
                                          --created/--modified backdate the note (applied via a
                                          post-create metadata patch; create ignores them inline).
  md read <docGuid>                       Read markdown note as raw markdown
  md update <docGuid> -f md.md [--title="new"]
                                          Overwrite markdown note with Markdown file

  collab new "<title>" [-f md.md] [--category=/x/] [--tags=a,b] [--created=<ms|date>] [--modified=<ms|date>]
                                          Create a collaboration note from Markdown
                                          (--created/--modified backdate via post-create patch)
  collab read <docGuid>                   Read collab note as Markdown
  collab update <docGuid> -f md.md [--title="new"]
                                          Overwrite collab note with Markdown file
  collab embed <docGuid> <file>... [--prepend]
                                          Upload files to collab note and insert
                                          <img>/<audio>/<video>/<file-card> blocks

Global flags:
  --insecure         Skip TLS cert verification for THIS run only (or set
                     WIZ_INSECURE_TLS=1). For a persistent, auto-expiring
                     switch use 'wiz insecure-tls on'. Normal use: leave off.

Environment overrides: WIZ_USER, WIZ_TOKEN, WIZ_KB_GUID, WIZ_KB_SERVER, WIZ_INSECURE_TLS`)
}

function ask (question, { silent = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    if (silent) {
      const stdin = process.openStdin()
      process.stdin.on('data', () => {
        process.stdout.write('\x1b[2K\x1b[200D' + question)
      })
    }
    rl.question(question, ans => { rl.close(); resolve(ans) })
  })
}

// Parse a timestamp flag into ms, or exit on an unparseable value.
// Accepts a millisecond epoch (`1700000000000`) or any Date-parseable string
// (`2023-05-01`, `2023/05/01 08:00`).
function parseStamp (raw, flag) {
  const ms = /^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(raw)
  if (!Number.isFinite(ms)) { console.error(`invalid ${flag}: ${raw}`); process.exit(1) }
  return ms
}

// Build the `{ created?, dataModified? }` overrides from --created / --modified
// flags. Absent/empty flags contribute nothing (server keeps its default: now).
function parseTimeFlags (flags) {
  const out = {}
  if (flags.created !== undefined && flags.created !== true && flags.created !== '') {
    out.created = parseStamp(flags.created, '--created')
  }
  if (flags.modified !== undefined && flags.modified !== true && flags.modified !== '') {
    out.dataModified = parseStamp(flags.modified, '--modified')
  }
  return out
}

async function main () {
  try {
    await applyInsecureTls()
    switch (cmd) {
      case 'insecure-tls': {
        // Persisted, auto-expiring switch to ignore TLS cert errors.
        //   wiz insecure-tls on [--days=N]   (default 3)
        //   wiz insecure-tls off
        //   wiz insecure-tls status
        const sub = rest[0] || 'status'
        const flags = {}
        for (const a of rest.slice(1)) {
          const m = a.match(/^--([^=]+)(?:=(.*))?$/)
          if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
        }
        if (sub === 'on') {
          const days = Number(flags.days) > 0 ? Number(flags.days) : 3
          const until = Date.now() + Math.round(days * 86400000)
          await setInsecureTlsUntil(until)
          console.log(`Insecure-TLS enabled for ${days} day(s). Certificate errors will be ignored until ${new Date(until).toLocaleString()}.`)
          console.log('⚠  This weakens transport security. Run `wiz insecure-tls off` once WizNote renews its cert.')
        } else if (sub === 'off') {
          await clearInsecureTlsUntil()
          console.log('Insecure-TLS disabled. Certificate verification is back on.')
        } else if (sub === 'status') {
          const until = await getInsecureTlsUntil()
          const left = until - Date.now()
          if (until && left > 0) console.log(`Insecure-TLS: ON, ${fmtRemaining(left)} left (expires ${new Date(until).toLocaleString()}).`)
          else console.log('Insecure-TLS: OFF.')
        } else {
          console.error('usage: wiz insecure-tls <on [--days=N] | off | status>')
          process.exit(1)
        }
        break
      }
      case 'login': {
        // Support: wiz login [--endpoint=URL] [--save-password]
        const flags = {}
        for (const a of rest) {
          const m = a.match(/^--([^=]+)(?:=(.*))?$/)
          if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
        }
        const endpoint = flags.endpoint || process.env.WIZ_ENDPOINT
        // Default: save password so token can auto-refresh. Opt-out with --no-save-password.
        const doSavePassword = flags['no-save-password'] ? false : true
        if (endpoint) console.log(`Using endpoint: ${endpoint}`)
        if (doSavePassword) {
          console.log('Password will be stored in OS Keychain to enable auto-reauth')
          console.log('(pass --no-save-password to skip).')
        } else {
          console.log('Password will NOT be stored. Token expires ~every 15 min; you\'ll need to re-run `wiz login`.')
        }
        const userId = await ask('WizNote userId (email): ')
        const password = await ask('Password: ', { silent: true })
        const wiz = await WizClient.login({
          userId: userId.trim(), password, endpoint,
          savePassword: doSavePassword
        })
        console.log(`\nLogged in as ${wiz.userId}`)
        console.log(`  kbGuid       : ${wiz.kbGuid}`)
        console.log(`  kbServer     : ${wiz.kbServer}`)
        console.log(`  accountBaseUrl: ${wiz.accountBaseUrl}`)
        console.log(`  token        : stored in OS Keychain (or ~/.config/wiznote/session.json if keytar unavailable)`)
        if (doSavePassword) console.log('  password     : stored in OS Keychain (auto-reauth enabled)')
        break
      }
      case 'save-password': {
        // Opt-in without doing a full login. Useful if user forgot --save-password.
        const c = await resolveCredentials().catch(() => null)
        if (!c || !c.userId) { console.error('Run `wiz login` first.'); process.exit(1) }
        console.log('⚠  This will store your WizNote password in OS Keychain.')
        console.log('   The SDK will use it to silently re-login when the token expires.')
        const password = await ask('Password: ', { silent: true })
        const { WizClient } = await import('../src/index.js')
        await WizClient.savePassword(c.userId, password)
        console.log(`Password saved for ${c.userId}. Auto-reauth is now enabled.`)
        break
      }
      case 'forget-password': {
        const c = await resolveCredentials().catch(() => null)
        if (c?.userId) {
          const { WizClient } = await import('../src/index.js')
          await WizClient.clearStoredPassword(c.userId)
        }
        console.log('Stored password cleared. Auto-reauth is now disabled.')
        break
      }
      case 'logout': {
        const c = await resolveCredentials().catch(() => null)
        if (c) {
          const wiz = new WizClient(c)
          await wiz.logout()
        }
        console.log('Logged out.')
        break
      }
      case 'whoami': {
        const c = await resolveCredentials()
        console.log(JSON.stringify({ userId: c.userId, kbGuid: c.kbGuid, kbServer: c.kbServer }, null, 2))
        break
      }
      case 'keep': {
        const wiz = await WizClient.fromStored()
        const r = await wiz.keepAlive()
        console.log(JSON.stringify(r, null, 2))
        break
      }
      case 'ls': {
        // Positional: [category]. Flags: --start=N --count=N --all
        const flags = {}
        const positional = []
        for (const a of rest) {
          const m = a.match(/^--([^=]+)(?:=(.*))?$/)
          if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
          else positional.push(a)
        }
        const category = positional[0] || ''
        const count = Math.max(1, Math.min(1000, parseInt(flags.count, 10) || 50))
        const fetchAll = !!flags.all
        let start = parseInt(flags.start, 10) || 0

        const wiz = await WizClient.fromStored()
        let total = 0
        let lastStart = start
        for (;;) {
          const notes = await wiz.kb.getCategoryNotes({
            category, start: lastStart, count,
            withAbstract: false,
            orderBy: 'modified', ascending: 'desc'
          }) || []
          for (const n of notes) {
            console.log(`${n.docGuid || n.guid}  ${n.title}  [${n.category}]`)
          }
          total += notes.length
          const done = notes.length < count
          if (fetchAll && !done) {
            lastStart += count
            continue
          }
          console.error(`— ${total} shown (start=${start}, count=${count}${fetchAll ? ', --all' : ''})`)
          if (!done && !fetchAll) {
            console.error(`  more available: rerun with --start=${start + count}, or add --all to fetch everything`)
          }
          break
        }
        break
      }
      case 'cat': {
        if (!rest[0]) { console.error('need docGuid'); process.exit(1) }
        const wiz = await WizClient.fromStored()
        const r = await wiz.kb.getNoteContent(rest[0])
        console.log(r.html || r)
        break
      }
      case 'tags': {
        const wiz = await WizClient.fromStored()
        const tags = await wiz.kb.getAllTags()
        for (const t of tags || []) console.log(`${t.tagGuid}  ${t.name}`)
        break
      }
      case 'categories': {
        const wiz = await WizClient.fromStored()
        const c = await wiz.kb.getCategories()
        console.log(JSON.stringify(c, null, 2))
        break
      }
      case 'search': {
        if (!rest[0]) { console.error('need keyword'); process.exit(1) }
        const wiz = await WizClient.fromStored()
        const r = await wiz.kb.searchNote({ ss: rest.join(' ') })
        for (const n of r || []) console.log(`${n.docGuid || n.guid}  ${n.title}`)
        break
      }
      case 'mv': {
        if (rest.length < 2) { console.error('usage: wiz mv <docGuid> <category>'); process.exit(1) }
        const wiz = await WizClient.fromStored()
        await wiz.kb.moveNote(rest[0], rest[1])
        console.log(`Moved ${rest[0]} → ${rest[1]}`)
        break
      }
      case 'rename': {
        if (rest.length < 2) { console.error('usage: wiz rename <docGuid> <newTitle>'); process.exit(1) }
        const wiz = await WizClient.fromStored()
        await wiz.kb.renameNote(rest[0], rest.slice(1).join(' '))
        console.log(`Renamed ${rest[0]}`)
        break
      }
      case 'md': {
        const sub = rest[0]
        const flags = {}
        const positional = []
        for (const a of rest.slice(1)) {
          const m = a.match(/^--([^=]+)(?:=(.*))?$/)
          if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
          else positional.push(a)
        }
        const wiz = await WizClient.fromStored()
        const readFileFlag = async () => {
          const fIdx = rest.indexOf('-f')
          if (fIdx < 0) return ''
          return await fs.readFile(rest[fIdx + 1], 'utf8')
        }
        switch (sub) {
          case 'new': {
            const title = positional[0]
            if (!title) { console.error('usage: wiz md new "<title>" [-f md.md] [--category=/x/] [--created=<ms|date>] [--modified=<ms|date>]'); process.exit(1) }
            const markdown = await readFileFlag()
            const r = await wiz.createMarkdownNote({
              title, markdown,
              category: flags.category || '/My Notes/',
              ...parseTimeFlags(flags)
            })
            console.log(JSON.stringify({ docGuid: r.docGuid, title: r.title, type: r.type, category: r.category }, null, 2))
            break
          }
          case 'read': {
            if (!positional[0]) { console.error('usage: wiz md read <docGuid>'); process.exit(1) }
            const md = await wiz.readMarkdownNote(positional[0])
            process.stdout.write(md)
            break
          }
          case 'update': {
            if (!positional[0]) { console.error('usage: wiz md update <docGuid> -f md.md [--title="new"]'); process.exit(1) }
            const markdown = await readFileFlag()
            if (!markdown) { console.error('need -f <path/to/md>'); process.exit(1) }
            await wiz.updateMarkdownNote({ docGuid: positional[0], markdown, title: flags.title })
            console.log('updated ' + positional[0])
            break
          }
          default:
            console.error('unknown md subcommand:', sub)
            process.exit(1)
        }
        break
      }
      case 'collab': {
        const sub = rest[0]
        const flags = {}
        const positional = []
        for (const a of rest.slice(1)) {
          const m = a.match(/^--([^=]+)(?:=(.*))?$/)
          if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
          else positional.push(a)
        }
        const wiz = await WizClient.fromStored()
        if (!wiz.userGuid) {
          console.error('Collab notes require userGuid — re-run `wiz login` to refresh session (older logins may not have captured it).')
          process.exit(1)
        }
        const readFileFlag = async () => {
          const fIdx = rest.indexOf('-f')
          if (fIdx < 0) return ''
          return await fs.readFile(rest[fIdx + 1], 'utf8')
        }
        switch (sub) {
          case 'new': {
            const title = positional[0]
            if (!title) { console.error('usage: wiz collab new "<title>" [-f md.md] [--category=/x/] [--tags=a,b] [--created=<ms|date>] [--modified=<ms|date>]'); process.exit(1) }
            const markdown = await readFileFlag()
            const r = await wiz.createCollaborationNote({
              title, markdown,
              category: flags.category || '/My Notes/',
              tags: flags.tags || '',
              ...parseTimeFlags(flags)
            })
            console.log(JSON.stringify(r, null, 2))
            break
          }
          case 'read': {
            if (!positional[0]) { console.error('usage: wiz collab read <docGuid>'); process.exit(1) }
            const md = await wiz.readCollaborationNote(positional[0])
            process.stdout.write(md)
            break
          }
          case 'update': {
            if (!positional[0]) { console.error('usage: wiz collab update <docGuid> -f md.md [--title="new"]'); process.exit(1) }
            const markdown = await readFileFlag()
            if (!markdown) { console.error('need -f <path/to/md>'); process.exit(1) }
            const r = await wiz.updateCollaborationNote({
              docGuid: positional[0], markdown, title: flags.title
            })
            console.log(JSON.stringify(r, null, 2))
            break
          }
          case 'embed': {
            if (positional.length < 2) { console.error('usage: wiz collab embed <docGuid> <file>... [--prepend]'); process.exit(1) }
            const [docGuid, ...files] = positional
            const r = await wiz.collabUploadAndEmbed(docGuid, files, {
              position: flags.prepend ? 'prepend' : 'append'
            })
            for (const u of r.uploaded) {
              const tag = u.deduped ? '(deduped, no upload)' : '(new upload)'
              console.log(`  ${u.fileName}  ${u.fileSize}B  ${u.fileType}  src=${u.src}  ${tag}`)
            }
            const dedup = r.uploaded.filter(u => u.deduped).length
            console.error(`— ${r.uploaded.length} embedded into ${docGuid} (${dedup} deduped, ${r.uploaded.length - dedup} bytes uploaded)`)
            break
          }
          default:
            console.error('unknown collab subcommand:', sub)
            process.exit(1)
        }
        break
      }
      case 'res': {
        const sub = rest[0]
        const wiz = await WizClient.fromStored()
        // Detect note type once — collab notes use a different resource endpoint.
        const detectCollab = async (docGuid) => {
          // getNoteInfo returns empty for collab notes on some servers; use content-with-no-data.
          const d = await wiz.kb.getNoteContent(docGuid, { downloadInfo: 1, downloadData: 0 }).catch(() => null)
          return d?.info?.type === 'collaboration'
        }
        switch (sub) {
          case 'ls': {
            if (!rest[1]) { console.error('usage: wiz res ls <docGuid>'); process.exit(1) }
            const isCollab = await detectCollab(rest[1])
            if (isCollab) {
              const list = await wiz.listCollaborationResources(rest[1])
              for (const r of list) console.log(`${r.name}  [${r.blockType}]`)
              console.error(`— ${list.length} collaboration resource(s)`)
            } else {
              const list = await wiz.kb.listResources(rest[1])
              for (const r of list) {
                console.log(`${r.name}  ${r.size ?? '?'}B  ${new Date(r.time || 0).toISOString().slice(0, 10)}`)
              }
              console.error(`— ${list.length} resource(s)`)
            }
            break
          }
          case 'get': {
            if (rest.length < 3) { console.error('usage: wiz res get <docGuid> <name> [-o out]'); process.exit(1) }
            const oIdx = rest.indexOf('-o')
            const outPath = oIdx > -1 ? rest[oIdx + 1] : rest[2]
            const isCollab = await detectCollab(rest[1])
            let buf
            if (isCollab) {
              const r = await wiz.downloadCollaborationResource(rest[1], rest[2])
              buf = r.buffer
            } else {
              buf = await wiz.kb.downloadResource(rest[1], rest[2])
            }
            await fs.writeFile(outPath, buf)
            console.log(`Wrote ${buf.length} B → ${outPath}`)
            break
          }
          case 'all': {
            if (!rest[1]) { console.error('usage: wiz res all <docGuid> [-o dir] [--user]'); process.exit(1) }
            const oIdx = rest.indexOf('-o')
            const outDir = oIdx > -1 ? rest[oIdx + 1] : `./resources-${rest[1].slice(0, 8)}`
            const userOnly = rest.includes('--user')
            const isCollab = await detectCollab(rest[1])
            await fs.mkdir(outDir, { recursive: true })
            let ok = 0, fail = 0, bytes = 0
            if (isCollab) {
              const list = await wiz.listCollaborationResources(rest[1])
              for (const r of list) {
                try {
                  const { buffer } = await wiz.downloadCollaborationResource(rest[1], r.name)
                  await fs.writeFile(path.join(outDir, r.name), buffer)
                  bytes += buffer.length; ok++
                  console.log(`  ${r.name}  ${buffer.length}B  [${r.blockType}]`)
                } catch (e) {
                  fail++
                  console.error(`  ${r.name}  FAIL: ${e.message}`)
                }
              }
            } else {
              const list = await wiz.kb.listResources(rest[1])
              const filtered = userOnly
                ? list.filter(r => !/^(editor_|scrollbar_|wiz[A-Z]|Icons)/.test(r.name))
                : list
              for (const r of filtered) {
                try {
                  const buf = await wiz.kb.downloadResource(rest[1], r.name)
                  await fs.writeFile(path.join(outDir, r.name), buf)
                  bytes += buf.length; ok++
                  console.log(`  ${r.name}  ${buf.length}B`)
                } catch (e) {
                  fail++
                  console.error(`  ${r.name}  FAIL: ${e.message}`)
                }
              }
            }
            console.error(`— ${ok} downloaded (${bytes} B), ${fail} failed → ${outDir}`)
            break
          }
          case 'upload': {
            const flags = {}
            const positional = []
            for (const a of rest.slice(1)) {
              const m = a.match(/^--([^=]+)(?:=(.*))?$/)
              if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
              else positional.push(a)
            }
            if (positional.length < 2) { console.error('usage: wiz res upload <docGuid> <file>... [--prepend] [--heading=".."]'); process.exit(1) }
            const [docGuid, ...files] = positional
            const r = await wiz.uploadAndEmbed(docGuid, files, {
              position: flags.prepend ? 'prepend' : 'append',
              heading: flags.heading
            })
            for (const u of r.uploaded) {
              console.log(`  ${u.name}  →  ${u.url}  [${u.kind}]`)
            }
            console.error(`— ${r.uploaded.length} uploaded and embedded into ${docGuid}`)
            break
          }
          default:
            console.error('unknown res subcommand:', sub)
            process.exit(1)
        }
        break
      }
      case 'attach': {
        const sub = rest[0]
        const wiz = await WizClient.fromStored()
        switch (sub) {
          case 'ls': {
            if (!rest[1]) { console.error('usage: wiz attach ls <docGuid>'); process.exit(1) }
            const list = await wiz.kb.listAttachments(rest[1])
            for (const a of list || []) {
              console.log(`${a.attGuid || a.guid}  ${a.name}  ${a.size ?? '?'}B`)
            }
            break
          }
          case 'put': {
            if (rest.length < 3) { console.error('usage: wiz attach put <docGuid> <file> [name]'); process.exit(1) }
            const filePath = rest[2]
            const name = rest[3] || path.basename(filePath)
            const buf = await fs.readFile(filePath)
            const r = await wiz.kb.uploadAttachment(rest[1], buf, name)
            console.log(JSON.stringify(r, null, 2))
            break
          }
          case 'get': {
            if (rest.length < 3) { console.error('usage: wiz attach get <docGuid> <attGuid> [-o out]'); process.exit(1) }
            const oIdx = rest.indexOf('-o')
            const outPath = oIdx > -1 ? rest[oIdx + 1] : null
            const buf = await wiz.kb.downloadAttachment(rest[1], rest[2])
            if (outPath) {
              await fs.writeFile(outPath, buf)
              console.log(`Wrote ${buf.length} B → ${outPath}`)
            } else {
              process.stdout.write(buf)
            }
            break
          }
          case 'rm': {
            if (rest.length < 3) { console.error('usage: wiz attach rm <docGuid> <attGuid>'); process.exit(1) }
            await wiz.kb.deleteAttachment(rest[1], rest[2])
            console.log(`Deleted ${rest[2]}`)
            break
          }
          case 'url': {
            if (rest.length < 3) { console.error('usage: wiz attach url <docGuid> <attGuid>'); process.exit(1) }
            console.log(wiz.kb.getAttachmentUrl(rest[1], rest[2]))
            console.log('# Requires: X-Wiz-Token: <token>')
            break
          }
          case 'embed': {
            const flags = {}
            const positional = []
            for (const a of rest.slice(1)) {
              const m = a.match(/^--([^=]+)(?:=(.*))?$/)
              if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
              else positional.push(a)
            }
            if (positional.length < 2) { console.error('usage: wiz attach embed <docGuid> <file>... [--prepend] [--heading=".."]'); process.exit(1) }
            const [docGuid, ...files] = positional
            const r = await wiz.attachAndLink(docGuid, files, {
              position: flags.prepend ? 'prepend' : 'append',
              heading: flags.heading
            })
            for (const u of r.uploaded) {
              console.log(`  ${u.name}  attGuid=${u.attGuid}  ${u.size}B`)
            }
            console.error(`— ${r.uploaded.length} attached and linked into ${docGuid}`)
            break
          }
          default:
            console.error('unknown attach subcommand:', sub)
            process.exit(1)
        }
        break
      }
      default:
        usage()
    }
  } catch (e) {
    console.error('Error:', e.message)
    process.exit(1)
  }
}

main()
