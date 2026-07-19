---
name: wiznote-api
description: 为知笔记 (WizNote / Wiz) REST API skill。用户提到"为知""为知笔记""wiz""WizNote""wiz.cn"或需要操作笔记时触发,涵盖:登录、笔记的增删改查(create/read/update/delete)、笔记搜索、文件夹/分类(category)管理、标签(tag)管理、图片/附件上传、kbGuid/kbServer/X-Wiz-Token/token 相关问题、私有化/自建服务器(endpoint)配置、凭据存储(OS Keychain / 环境变量 / 配置文件)。支持公网 as.wiz.cn 和企业内网自建服务器两种模式。Skill 自带可执行 Node 脚本 `scripts/wiz.js`,通过 `node ${SKILL_DIR}/scripts/wiz.js <cmd>` 调用。铁律:绝不硬编码凭据,绝不让用户在对话里贴密码,一律用 `wiz login` 交互登录并把 token 存进 OS Keychain。
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

# Workbuddy / OpenClaw (Windows: %USERPROFILE%\.workbuddy\skills\)
git clone https://github.com/Shinku-Chen/wiznote-skill.git ~/.workbuddy/skills/wiznote-api
```

Optional (recommended, enables OS Keychain):
```bash
cd ~/.claude/skills/wiznote-api && npm run setup
```

## Public cloud vs on-premise

- **Public cloud** (default): AS at `https://as.wiz.cn`, KS returned dynamically after login.
- **On-premise / 私有化**: pass `--endpoint=https://your-host:port` to `wiz login`, or set `WIZ_ENDPOINT`. Both AS and KS resolve to that single host.

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
2. Environment: `WIZ_TOKEN`, `WIZ_KB_GUID`, `WIZ_KB_SERVER`, `WIZ_USER`, `WIZ_ACCOUNT_URL`, `WIZ_ENDPOINT`
3. OS Keychain
4. `~/.config/wiznote/session.json`

`WIZ_ENDPOINT` is a shortcut for on-premise: sets both `accountBaseUrl` and `kbServer` defaults to the same host.

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

### Note convenience wrappers
| Method | What it does |
|---|---|
| `kb.moveNote(docGuid, category)` | move a note to a different folder |
| `kb.renameNote(docGuid, title)` | change title only |

### Comments
| Method | Endpoint |
|---|---|
| `kb.getComments(docGuid)` | `GET /ks/comment/list/:kb/:doc` |
| `kb.addComment(docGuid, text)` | `POST /ks/comment/create/:kb/:doc` |
| `kb.deleteComment(docGuid, commentGuid)` | `DELETE /ks/comment/delete/:kb/:doc/:c` |

### History / versions
| Method | Endpoint |
|---|---|
| `kb.getNoteHistory(docGuid)` | `GET /ks/note/history/:kb/:doc` |
| `kb.getNoteVersion(docGuid, versionId)` | `GET /ks/note/version/:kb/:doc/:v` |

### Sharing
| Method | Endpoint |
|---|---|
| `kb.shareNote(docGuid, { access:'read'\|'edit', expireDays })` | `POST /ks/share/create/:kb/:doc` (expireDays=0 → 永久) |
| `kb.listShares()` | `GET /ks/share/list/:kb` |
| `kb.cancelShare(shareId)` | `DELETE /ks/share/delete/:kb/:shareId` |

### Resources (embedded images / arbitrary blobs)
```js
const form = new FormData()
form.append('file', blob, 'image.png')
await wiz.kb.uploadImage(docGuid, form)  // or uploadResource() — same call
```

### Attachments (first-class file attachments)
| Method | Endpoint | Purpose |
|---|---|---|
| `kb.listAttachments(docGuid)` | `GET /ks/note/attachments/:kb/:doc` | list attachments with `attGuid`/`name`/`size` |
| `kb.uploadAttachment(docGuid, buffer, name)` | `POST /ks/attachment/upload/:kb/:doc` | upload a file |
| `kb.downloadAttachment(docGuid, attGuid)` | `GET /ks/attachment/download/:kb/:doc/:att` | returns Buffer |
| `kb.getAttachmentUrl(docGuid, attGuid)` | — | returns raw URL (still needs `X-Wiz-Token` header) |

**Attachment deletion has no dedicated endpoint.** To remove one: fetch the note HTML, strip the `<a href>` / `<img src>` reference, `updateNote(docGuid,{html})` — server garbage-collects orphans.

## Collaboration notes (modern WizNote default)

Modern WizNote creates new notes as **collaboration notes** by default: content is a JSON `blocks` array served over WebSocket (sharejs JSONv1), not HTML. This skill supports them via Markdown ↔ blocks conversion.

**Setup:** requires the `ws` package. `npm run setup` installs it alongside keytar.

**Requires** `userGuid` in the session — captured on `wiz login`. Older sessions from before this feature need `wiz logout && wiz login` to refresh.

```js
// Create from Markdown
await wiz.createCollaborationNote({
  title: '2026 W17 周报',
  markdown: '# 完成\n- 特性 A\n\n## 计划\n- [ ] 测试 B',
  category: '/工作/周报/',
  tags: '周报'
})

// Read as Markdown (auto-detects note type, falls back to HTML for legacy)
const md = await wiz.readCollaborationNote(docGuid)

// Overwrite content
await wiz.updateCollaborationNote({ docGuid, markdown: '# new', title: 'new title' })
```

Supported Markdown constructs (write + read):
`# heading`, paragraphs, `**bold**` / `*italic*` / `~~strike~~` / `` `code` `` / `[link](url)`, `- ul` / `1. ol` / `- [x] check`, `> quote`, ` ``` code blocks ``` `, `---` hr, `![alt](url)` image, `| tables |`.

Not yet supported: formula/audio/drawio/encrypted/webpage embed blocks (roundtrip only).

CLI: `wiz collab new "<title>" -f md.md [--category=/x/] [--tags=a,b]`, `wiz collab read <docGuid>`, `wiz collab update <docGuid> -f md.md`.

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
