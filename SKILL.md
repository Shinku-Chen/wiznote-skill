---
name: wiznote-api
description: WizNote (为知笔记) REST API skill. Trigger when the user asks about WizNote / 为知 login, note CRUD, categories, tags, resource upload, search, kbGuid, kbServer, X-Wiz-Token, or when working with the `wiznote-sdk` package. Covers auth flow, credential storage (OS Keychain > env > config file), and every documented API endpoint. Do NOT hardcode credentials — always resolve via WizClient.fromStored() or environment variables.
---

# WizNote API Skill

## Quick start

```js
import { WizClient } from 'wiznote-sdk'

// 1. Load from OS Keychain / env / config file (recommended for scripts)
const wiz = await WizClient.fromStored()

// 2. Or interactive login (persists to keychain on success)
const wiz = await WizClient.login({ userId: 'a@b.com', password: '***' })

const notes = await wiz.kb.getCategoryNotes({ category: '', start: 0, count: 20 })
```

## Credential handling — READ THIS FIRST

**Never** put a WizNote password into code, memory, `CLAUDE.md`, chat logs, or a git commit.
Password is exchanged for a `token` on first login, and only the token is stored.

Resolution order (`resolveCredentials()`):

1. Explicit args passed to `WizClient`
2. Environment variables: `WIZ_TOKEN`, `WIZ_KB_GUID`, `WIZ_KB_SERVER`, `WIZ_USER`
3. **OS Keychain** via `keytar` (macOS Keychain / Windows Credential Manager / libsecret) — preferred
4. `~/.config/wiznote/session.json` — non-secret metadata (`userId`, `kbGuid`, `kbServer`).
   Token is only written here as a fallback when keytar is unavailable, with mode `0600`.

If you get "WizNote token not found", instruct the user to run `wiz login` (interactive) — do NOT ask them to paste the password into the chat.

See [references/credentials.md](skill/references/credentials.md) for the full rationale and threat model.

## API surface

Two clients on `wiz`:

- `wiz.account` — `AccountServerApi` (login, logout, token, user info, avatar)
- `wiz.kb` — `KnowledgeBaseApi` (notes, categories, tags, resources, search)

Every `kb.*` call reads `kbGuid` and `token` from the client — you only pass the operation-specific data.

### Notes

| Method | Endpoint | Purpose |
|---|---|---|
| `kb.getNoteInfo(docGuid)` | `GET /ks/note/info/:kb/:doc` | metadata only |
| `kb.getNoteContent(docGuid, { downloadInfo, downloadData })` | `GET /ks/note/download/:kb/:doc` | full HTML + resources |
| `kb.getCategoryNotes({ category, start, count, withAbstract, orderBy, ascending })` | `GET /ks/note/list/category/:kb` | list under a folder |
| `kb.createNote({ title, category, owner, html, type })` | `POST /ks/note/create/:kb` | create; `type='document'` or `'lite/markdown'` |
| `kb.updateNote(docGuid, { html, title, type })` | `PUT /ks/note/save/:kb/:doc` | content update |
| `kb.updateNoteInfo(docGuid, { title, tags, category })` | `POST /ks/note/upload/:kb/:doc` | metadata (⚠️ `category` = move) |
| `kb.deleteNote(docGuid)` | `DELETE /ks/note/delete/:kb/:doc` | |
| `kb.copyNote(docGuid, { targetKbGuid, targetCategory })` | `POST /ks/note/copy/:kb/:doc` | |
| `kb.searchNote({ ss })` | `GET /ks/note/search/:kb` | full-text search |

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

All non-`returnCode:200` responses throw `WizApiError` with `.code` and `.externCode`.

- `kbGuid is not match` — note was moved to another KB; treat as local-only, clear `docGuid`.
- Auth expired — call `wiz.account.keepTokenAlive({ token })`; if it fails, `wiz login` again.

## CLI (verification)

```
wiz login
wiz whoami
wiz ls
wiz search hello
wiz cat <docGuid>
wiz logout
```

## Full protocol reference

See [skill/references/api.md](skill/references/api.md) for URL/field/param details of every endpoint (language-agnostic, use it if you call WizNote from anything other than this SDK).
