---
name: wiznote-api
description: WizNote (为知笔记) REST API skill. Trigger when the user asks about WizNote / 为知 login, note CRUD, categories, tags, resource upload, search, kbGuid, kbServer, X-Wiz-Token. Covers auth flow, credential storage (OS Keychain > env > 0600 file), and every documented endpoint. This skill ships runnable Node scripts in the same directory — invoke them as `node ${SKILL_DIR}/scripts/wiz.js <cmd>`. Do NOT hardcode credentials, do NOT ask the user to paste passwords into chat; always route through the login script which stores tokens in the OS Keychain.
---

# WizNote API Skill

This skill is a **self-contained folder** — cloned into `~/.claude/skills/wiznote-api/` (or `.cursor/skills/wiznote-api/`). All code lives beside this file; no npm install needed to run.

Node 18+ is required (uses built-in `fetch`). `keytar` is optional; without it, tokens fall back to a `0600` file.

## Install (for the user)

```bash
# Claude Code
git clone https://github.com/Shinku-Chen/wiznote-skill.git ~/.claude/skills/wiznote-api

# Cursor
git clone https://github.com/Shinku-Chen/wiznote-skill.git .cursor/skills/wiznote-api
```

Optional (recommended, enables OS Keychain):
```bash
cd ~/.claude/skills/wiznote-api && npm run setup
```

## First-time login (interactive, once per machine)

Tell the user to run this **in their own terminal** — never accept a password in chat:

```bash
node ~/.claude/skills/wiznote-api/scripts/wiz.js login
```

The password is exchanged for a `token` via the WizNote account server and immediately discarded. Only the token is persisted:

1. **OS Keychain** (macOS Keychain / Windows Credential Manager / libsecret) via `keytar` — preferred
2. `~/.config/wiznote/session.json` (mode `0600`) — fallback

Non-secret metadata (`userId`, `kbGuid`, `kbServer`) always goes to the config file.

## Using the API from code

Inside the skill folder, import the modules with a relative path:

```js
import { WizClient } from './src/index.js'   // when your script is at skill root
// or, from an arbitrary path:
import { WizClient } from '/absolute/path/to/wiznote-api/src/index.js'

const wiz = await WizClient.fromStored()
const notes = await wiz.kb.getCategoryNotes({ category: '', start: 0, count: 20 })
```

If you're writing a script that the user will run, put it in `scripts/` and reference `../src/index.js`.

## Credential resolution order (`resolveCredentials`)

1. Explicit args to `WizClient`
2. Environment: `WIZ_TOKEN`, `WIZ_KB_GUID`, `WIZ_KB_SERVER`, `WIZ_USER`
3. OS Keychain
4. `~/.config/wiznote/session.json`

If `WizClient.fromStored()` throws "token not found", instruct the user to run `wiz login`. **Do NOT prompt for the password inside the chat.** Full rationale: [skill/references/credentials.md](skill/references/credentials.md).

## API surface

`wiz.account` — `AccountServerApi`:
`login({userId,password})`, `logout({token})`, `keepTokenAlive({token})`, `getUserInfo({token})`, `getUserAvatar({userGuid,token})`.

`wiz.kb` — `KnowledgeBaseApi`:

### Notes
| Method | Endpoint | Purpose |
|---|---|---|
| `kb.getNoteInfo(docGuid)` | `GET /ks/note/info/:kb/:doc` | metadata |
| `kb.getNoteContent(docGuid, { downloadInfo, downloadData })` | `GET /ks/note/download/:kb/:doc` | full HTML + resources |
| `kb.getCategoryNotes({ category, start, count, withAbstract, orderBy, ascending })` | `GET /ks/note/list/category/:kb` | list under folder |
| `kb.createNote({ title, category, owner, html, type })` | `POST /ks/note/create/:kb` | `type='document'` \| `'lite/markdown'` |
| `kb.updateNote(docGuid, { html, title, type })` | `PUT /ks/note/save/:kb/:doc` | content |
| `kb.updateNoteInfo(docGuid, { title, tags, category })` | `POST /ks/note/upload/:kb/:doc` | metadata (⚠️ `category` = move) |
| `kb.deleteNote(docGuid)` | `DELETE /ks/note/delete/:kb/:doc` | |
| `kb.copyNote(docGuid, { targetKbGuid, targetCategory })` | `POST /ks/note/copy/:kb/:doc` | |
| `kb.searchNote({ ss })` | `GET /ks/note/search/:kb` | full-text |

### Categories
| Method | Endpoint |
|---|---|
| `kb.getCategories()` | `GET /ks/category/all/:kb` |
| `kb.createCategory({ parent, child, pos })` | `POST /ks/category/create/:kb` |
| `kb.deleteCategory({ category })` | `DELETE /ks/category/delete/:kb` |
| `kb.renameCategory({ category, newCategory })` | `PUT /ks/category/rename/:kb` |

### Tags
| Method | Endpoint |
|---|---|
| `kb.getAllTags()` | `GET /ks/tag/all/:kb` |
| `kb.getTagNotes({ tag, start, count, withAbstract, orderBy, ascending })` | `GET /ks/note/list/tag/:kb` |
| `kb.createTag({ name, parentTagGuid })` | `POST /ks/tag/create/:kb` |
| `kb.renameTag({ tagGuid, name })` | `PUT /ks/tag/rename/:kb` |
| `kb.moveTag({ tagGuid, parentTagGuid })` | `PUT /ks/tag/move/:kb` |
| `kb.deleteTag(tagGuid)` | `DELETE /ks/tag/delete/:kb/:tag` |

### Resources
```js
const form = new FormData()
form.append('file', blob, 'image.png')
await wiz.kb.uploadImage(docGuid, form)
```

## Error handling

Non-200 `returnCode` throws `WizApiError` with `.code` / `.externCode`.
`kbGuid is not match` → note was moved; clear local `docGuid` and treat as local-only.
Auth expired → `wiz.account.keepTokenAlive({ token })`; if it fails, re-run `wiz login`.

## Verify the install (verification steps)

Run these in the user's terminal and report status back:

```bash
node ~/.claude/skills/wiznote-api/scripts/wiz.js whoami   # prints userId/kbGuid/kbServer
node ~/.claude/skills/wiznote-api/scripts/wiz.js ls       # first page of root notes
```

If both succeed, the skill is ready.

## Full protocol reference

Language-agnostic URL / field / curl reference: [skill/references/api.md](skill/references/api.md).
