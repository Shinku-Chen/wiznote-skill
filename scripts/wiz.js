#!/usr/bin/env node
import { WizClient } from '../src/index.js'
import { resolveCredentials } from '../src/credentials.js'
import readline from 'node:readline'

const [, , cmd, ...rest] = process.argv

function usage () {
  console.log(`wiz <command>

  login              Authenticate and store token (OS Keychain preferred)
  logout             Clear stored token
  whoami             Show current session
  ls [category] [--start=N] [--count=N] [--all]
                     List notes in a category. Default: root, count=50.
                     --start=N   offset for pagination (default 0)
                     --count=N   page size (default 50, max 1000)
                     --all       auto-continue until exhausted
  cat <docGuid>      Print note content
  tags               List all tags
  categories         List category tree
  search <keyword>   Search notes

Environment overrides: WIZ_USER, WIZ_TOKEN, WIZ_KB_GUID, WIZ_KB_SERVER`)
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

async function main () {
  try {
    switch (cmd) {
      case 'login': {
        const userId = await ask('WizNote userId (email): ')
        const password = await ask('Password: ', { silent: true })
        const wiz = await WizClient.login({ userId: userId.trim(), password })
        console.log(`\nLogged in as ${wiz.userId}`)
        console.log(`  kbGuid   : ${wiz.kbGuid}`)
        console.log(`  kbServer : ${wiz.kbServer}`)
        console.log(`  token    : stored in OS Keychain (or ~/.config/wiznote/session.json if keytar unavailable)`)
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
      default:
        usage()
    }
  } catch (e) {
    console.error('Error:', e.message)
    process.exit(1)
  }
}

main()
