# wiznote-api skill

A **self-contained skill folder** for WizNote (为知笔记) REST API. Designed for Claude Code / Cursor / any AI agent that reads `SKILL.md` from a skills directory.

- Not published to npm. Install by `git clone` into your agent's skills dir.
- Runs on Node 18+ built-in `fetch`. No mandatory dependencies.
- Optional `keytar` for OS Keychain storage of the login token.

## Install

Tell your AI:

> Install the WizNote skill from `<this-repo-url>` into my Claude Code / Cursor skills folder.

Or do it yourself:

```bash
# Claude Code
git clone <this-repo-url> ~/.claude/skills/wiznote-api

# Cursor (per-project)
git clone <this-repo-url> .cursor/skills/wiznote-api

# Optional: enable OS Keychain storage
cd ~/.claude/skills/wiznote-api && npm run setup
```

## Login (once)

Run this in your own terminal — **do not** paste your password into a chat:

```bash
node ~/.claude/skills/wiznote-api/scripts/wiz.js login
```

The password is used exactly once to get a token, then discarded.
The token is stored in your OS Keychain (or `~/.config/wiznote/session.json` with mode `0600` if `keytar` is unavailable).

## CLI

```
node scripts/wiz.js login              # authenticate, store token
node scripts/wiz.js whoami             # print current session
node scripts/wiz.js ls [category]      # list notes
node scripts/wiz.js cat <docGuid>      # print note HTML
node scripts/wiz.js tags               # list tags
node scripts/wiz.js categories         # list category tree
node scripts/wiz.js search <keyword>   # search
node scripts/wiz.js logout             # invalidate token, clear state
```

## Use from your own code

```js
import { WizClient } from './src/index.js'   // relative from inside the skill dir

const wiz = await WizClient.fromStored()
const notes = await wiz.kb.getCategoryNotes({
  category: '', start: 0, count: 20, orderBy: 'modified', ascending: 'desc'
})
```

## Layout

```
SKILL.md                    ← AI entrypoint (frontmatter drives skill matching)
README.md                   ← this file
scripts/wiz.js              ← CLI
src/
  WizClient.js              ← high-level facade
  AccountServerApi.js       ← /as/* endpoints
  KnowledgeBaseApi.js       ← /ks/* endpoints
  credentials.js            ← keytar > env > 0600 file, never stores password
  request.js                ← fetch wrapper, WizApiError
  index.js                  ← re-exports
skill/references/
  api.md                    ← protocol / URL / field reference (SDK-agnostic)
  credentials.md            ← threat model + AI usage rules
```

## Credentials, in one sentence

Password is used once at login, never stored. Only the resulting token is persisted — to the OS Keychain when possible, otherwise to a `0600` file in `~/.config/wiznote/`. See [`skill/references/credentials.md`](skill/references/credentials.md) for the full model and the rules AI agents must follow.

## License

MIT.
