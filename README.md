# wiznote-sdk

Minimal SDK + AI Skill for **WizNote (为知笔记)** REST API.
Extracted from [coolma / Memocast](https://github.com/TankNee/Neeto-Vue), decoupled and repackaged so any project — or any AI agent — can use it.

- Zero runtime dependencies (Node 18+ `fetch`)
- Optional `keytar` for OS Keychain
- Comes with a Claude Code / Cursor **skill** (`SKILL.md`) so AI assistants can call the API safely
- CLI (`wiz login / ls / cat / search`) for humans

## Install

```bash
npm i wiznote-sdk
# optional: for OS Keychain storage
npm i keytar
```

## Login (once, interactive)

```bash
npx wiz login
```

The password is exchanged for a `token`; only the token is persisted, to the OS Keychain (or `~/.config/wiznote/session.json` with mode `0600` if `keytar` is unavailable). **The password is never stored.**

## Use in code

```js
import { WizClient } from 'wiznote-sdk'

const wiz = await WizClient.fromStored()

// notes
const notes = await wiz.kb.getCategoryNotes({
  category: '', start: 0, count: 20,
  withAbstract: true, orderBy: 'modified', ascending: 'desc'
})

// search
const hits = await wiz.kb.searchNote({ ss: 'hello' })

// create
await wiz.kb.createNote({
  title: 'Note from SDK',
  category: '/inbox/',
  html: '<p>hi</p>',
  type: 'document',
  owner: wiz.userId
})
```

Full API surface: see [SKILL.md](SKILL.md) and [skill/references/api.md](skill/references/api.md).

## Credential storage — how & why

| Preference | Where |
|---|---|
| 1 | Explicit constructor args |
| 2 | `WIZ_TOKEN` / `WIZ_KB_GUID` / `WIZ_KB_SERVER` env vars |
| 3 | **OS Keychain** via `keytar` (recommended for desktop) |
| 4 | `~/.config/wiznote/session.json` (0600) — token only when keytar unavailable |

Password never enters storage. Threat model & AI-usage rules: [skill/references/credentials.md](skill/references/credentials.md).

## Use as a Claude Code / Cursor skill

Symlink (or copy) the repo into your agent's skill dir:

```bash
# Claude Code
ln -s "$PWD" ~/.claude/skills/wiznote-api

# Cursor
ln -s "$PWD" .cursor/skills/wiznote-api
```

The agent picks up `SKILL.md` at the root and reads `skill/references/*.md` on demand.

## CLI

```
wiz login              Interactive login; stores token in OS Keychain
wiz whoami             Print current session
wiz ls [category]      List notes
wiz cat <docGuid>      Print note HTML
wiz tags               List tags
wiz categories         List category tree
wiz search <keyword>   Search
wiz logout             Invalidate token and clear local state
```

## Layout

```
src/
  WizClient.js          — high-level facade
  AccountServerApi.js   — /as/* endpoints
  KnowledgeBaseApi.js   — /ks/* endpoints
  credentials.js        — keytar > env > file resolution
  request.js            — fetch wrapper, WizApiError
bin/wiz.js              — CLI
skill/references/       — protocol + credentials docs consumed by AI skills
SKILL.md                — the AI skill entrypoint
```

## License

MIT. Original API surface derived from the open-source Memocast / Neeto-Vue project.
