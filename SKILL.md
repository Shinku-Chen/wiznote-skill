---
name: wiznote-api
description: 为知笔记 (WizNote / Wiz) REST API skill。用户提到"为知""为知笔记""wiz""WizNote""wiz.cn"或需要操作笔记时触发,涵盖:登录、笔记的增删改查(create/read/update/delete)、笔记搜索、文件夹/分类(category)管理、标签(tag)管理、笔记内嵌资源(图片)的上传/下载、一等公民附件(attachment)的上传/下载/删除、kbGuid/kbServer/X-Wiz-Token/token 相关问题、私有化/自建服务器(endpoint)配置、凭据存储(OS Keychain / 环境变量 / 配置文件)。支持公网 as.wiz.cn 和企业内网自建服务器两种模式。Skill 自带可执行 Node 脚本 `scripts/wiz.js`,通过 `node ${SKILL_DIR}/scripts/wiz.js <cmd>` 调用。铁律:绝不硬编码凭据,绝不让用户在对话里贴密码,一律用 `wiz login` 交互登录并把 token 存进 OS Keychain。
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

- **Public cloud** (default): AS at `https://note.wiz.cn` (legacy host `as.wiz.cn` still works; override via `--endpoint`/`WIZ_ENDPOINT`/`accountBaseUrl`), KS returned dynamically after login.
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

## Auto-reauth (on by default)

WizNote tokens have a ~15-minute TTL. To avoid `Invalid token` errors after idle periods, `wiz login` **stores the password in OS Keychain by default** alongside the token. When any `wiz.kb.*` call fails with an auth-shaped error, the client silently re-logs in with the stored password and retries once — the caller sees success.

Opt-out: `wiz login --no-save-password`, or turn off after the fact with `wiz forget-password`. `wiz save-password` re-enables it post-login.

**Trade-off (state this to the user before proceeding on their behalf):** Keychain is OS-encrypted and scoped per user account, so other OS users on the same machine can't read it. But **any process running as the same OS user** can pull the password back via keytar. On shared machines or non-trusted user environments, pass `--no-save-password`.

Password storage requires `keytar` (`npm run setup`). If keytar isn't available, `wiz login` logs a one-line warning and continues without storing the password — auto-reauth simply won't fire.

If `WizClient.fromStored()` throws "token not found", instruct the user to run `wiz login`. **Do NOT prompt for the password inside the chat.** Full rationale: [skill/references/credentials.md](skill/references/credentials.md).

## Note types

WizNote stores every note with a `type` field. The API surface (both official
and reverse-engineered) exposes editors only for the first three; everything
else is client-side only and can be **read but not created/edited** through
this skill.

| `type` | Human name | Payload shape | This skill |
|---|---|---|---|
| `document` | Regular note | HTML in `<div class="wiz-note-body">` | ✅ create / read / update / images / attachments |
| `lite/markdown` | Markdown note | HTML5 shell + `<pre>markdown source</pre>` (see below) | ✅ `wiz.createMarkdownNote` / `updateMarkdownNote` / `readMarkdownNote` |
| `collaboration` | Collab note | Block JSON via WebSocket (sharejs JSONv1) | ✅ `wiz.createCollaborationNote` + media upload/embed |
| `outline` | Outline / tree note | Nested-node JSON in `html` field | 🟡 read only (list + `getNoteContent`) |
| `tasklist` | Task list | Todo-item structure in `html` | 🟡 read only |
| `journal` | Journal / work log | HTML with journal template variables | 🟡 base is `document`, editable that way (loses template semantics) |
| `TemplateNote` | Templated note | HTML + structured fields, template-specific | 🟡 base is `document`, editable that way |
| `webnote` | Web clipping | HTML from the browser extension | ❌ browser-extension only |
| *(empty/null)* | Legacy | Old-client data | 🟡 treat as `document` for reads |

**Rule of thumb when creating new notes**: pick from the ✅ trio.

- Plain text / rich formatting / images / attachments → `document` (most stable, browser-clickable signed URLs, no `ws` dep).
- Markdown source you want to diff/export/round-trip cleanly → `lite/markdown`.
- Realtime multi-user editing / block-structured editor / native media embeds → `collaboration` (requires the optional `ws` package).

**Reading any type**: `wiz.kb.getNoteContent(docGuid)` works — inspect the returned `info.type` to know how to parse `html`.

## API surface

`wiz.account` — `AccountServerApi`:
`login({userId,password})`, `logout({token})`, `keepTokenAlive({token})`, `getUserInfo({token})`, `getUserAvatar({userGuid,token})`, `getMe({token})`, `listKbs({token})`, `getKb({kbGuid,token})`, `getGroup({kbGuid,token})`.

### Multi-KB (personal + team knowledge bases)

```js
const kbs = await wiz.listKbs()               // [{kbGuid, noteCount, storageUsage, docVersion, …}]
const info = await wiz.getKb()                // current kb; getKb(kbGuid) for another
const group = await wiz.getGroup(kbGuid)      // {kbServer, name, type:'person'|'group', ...}

// Switch this client to a team kb (kbServer auto-resolved via getGroup)
await wiz.switchKb(teamKbGuid)
// or pass kbServer explicitly to skip the lookup:
await wiz.switchKb(teamKbGuid, { kbServer: 'https://groupks01.wiz.cn' })
```

`wiz.kb` — `KnowledgeBaseApi`:

- `kb.getKbInfo()` — current KB's metadata: `noteCount`, `storageUsage/Limit`, `docVersion` / `attVersion` / `tagVersion` (for incremental sync), `uploadSizeLimit`, `deletedVersion`.
  - Prefer this over the officially-documented `/ks/kb/:kb/document/count` — that endpoint is IP-whitelisted on the public server, and its `noteCount` is already in `getKbInfo()`.

### Notes
| Method | Endpoint | Purpose |
|---|---|---|
| `kb.getNoteInfo(docGuid)` | `GET /ks/note/info/:kb/:doc` | metadata |
| `kb.getNoteContent(docGuid, { downloadInfo, downloadData })` | `GET /ks/note/download/:kb/:doc` | full HTML + resources |
| `kb.getCategoryNotes({ category, start, count, withAbstract, orderBy, ascending })` | `GET /ks/note/list/category/:kb` | list under folder |
| `kb.createNote({ title, category, owner, html, type })` | `POST /ks/note/create/:kb` | `type='document'` \| `'lite/markdown'` |
| `kb.updateNote(docGuid, { html, title, type })` | `PUT /ks/note/save/:kb/:doc` | content |
| `kb.updateNoteInfo(docGuid, data)` | `POST /ks/note/upload/:kb/:doc` | ⚠️ **full overwrite**, not a patch — omitted fields (`type`/`attachmentCount`/`protected`) get nulled & new clients then reject the note; also needs `kbGuid`+`docGuid` in body. Prefer `patchNoteInfo` |
| `kb.patchNoteInfo(docGuid, { title? / category? / … })` | (fetch info → merge → upload) | safe partial update: preserves all other metadata (`category` change = move) |
| `kb.deleteNote(docGuid)` | `DELETE /ks/note/delete/:kb/:doc` | |
| `kb.copyNote(docGuid, { targetKbGuid, targetCategory })` | `POST /ks/note/copy/:kb/:doc` | |
| `kb.searchNote({ ss })` | `GET /ks/note/search/:kb` | full-text |

### Categories
| Method | Endpoint |
|---|---|
| `kb.getCategories()` | `GET /ks/category/all/:kb` |
| `kb.createCategory({ parent, child, pos })` | `POST /ks/category/create/:kb` |
| `kb.deleteCategory({ category })` | `DELETE /ks/category/delete/:kb` |
| `kb.renameCategory({ from, to })` | `PUT /ks/category/rename/:kb` |
| `kb.sortCategories({ '/A/':0, '/B/':1, … })` | `PUT /ks/category/sort/:kb` |

### Tags
| Method | Endpoint |
|---|---|
| `kb.getAllTags()` | `GET /ks/tag/all/:kb` |
| `kb.getTagNotes({ tag, orderBy, start, count, withAbstract, ascending })` | `GET /ks/note/list/tag/:kb` — ⚠️ `orderBy` **required** by server (e.g. `'created'`), else `No options.orderBy` (code 2000) |
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
| `kb.getComments(docGuid, {extra})` | `GET /ks/note/comments/:kb/:doc` |
| `kb.addComment(docGuid, body)` | `POST /ks/comment/add/:kb/:doc` (body field is `body`, not `text`) |
| `kb.deleteComment(docGuid, sn)` | `DELETE /ks/comment/delete/:kb/:doc?sn=…` |
| `kb.getCommentCount(docGuid)` | `GET /ks/note/comments/count/:kb/:doc` |

### History / versions
| Method | Endpoint |
|---|---|
| `kb.getNoteHistory(docGuid, {objType,objGuid})` | `GET /ks/history/list/:kb/:doc?objType=document|attachment&objGuid=…` |
| `kb.getAttachmentHistory(docGuid, attGuid)` | shortcut for `getNoteHistory(doc, {objType:'attachment', objGuid:attGuid})` |

### Favorites (点赞)
| Method | Endpoint |
|---|---|
| `kb.listFavors(docGuid)` | `GET /ks/favor/:kb/:doc` — `{favorStatus, favorUsers[], favorCount}` |
| `kb.addFavor(docGuid)` | `POST /ks/favor/:kb/:doc` |
| `kb.removeFavor(docGuid)` | `DELETE /ks/favor/:kb/:doc` |

### Thumbnail / abstract
`kb.getNoteAbstract(docGuid)` → `{buffer, contentType}` or `null` (returns `null` on 404 for text-only notes).

### Unified object download
`kb.downloadObject(docGuid, {objType, objId?})` → `Buffer`. Handles `objType: 'resource'|'attachment'` well; `'document'` and `'abstract'` may 500 for notes without those objects. Prefer the dedicated `downloadResource` / `downloadAttachment` for the common cases.

### Sharing (public/team share links — LIVES ON AS, not KS)
Sharing endpoints hit the Account Server (`https://note.wiz.cn` or your on-premise AS). WizClient wraps them so you don't hand-manage the host:

| Method | Endpoint |
|---|---|
| `wiz.createShare({docGuid, password?, readCountLimit?, expiredAt?, friends?})` | `POST /share/api/shares` — returns `{shareId, shareUrl, …}` |
| `wiz.listShares({page?, size?, docGuid?})` | `GET /share/api/shares` — omit args to list all; pass `docGuid` for one note |
| `wiz.getShare(shareId)` | `GET /share/api/shares/:shareId` |
| `wiz.updateShare(shareId, {password?, readCountLimit?, expiredAt?, friends?})` | `PUT /share/api/shares/:shareId` |
| `wiz.cancelShare(shareId)` | `DELETE /share/api/shares/:shareId` |
| `wiz.cloneShare(shareId)` | `GET /share/api/shares/:shareId/clone` — save someone's share to your kb |

### Resources (images and files embedded in note body)

Two distinct storage paths depending on note type — the CLI (`wiz res`) auto-detects and picks the right one.

**Legacy / HTML note resources** (`kb.*`):
```js
const items = await wiz.kb.listResources(docGuid)        // [{name, size, time, url}]
const url = await wiz.kb.getResourceUrl(docGuid, name)   // signed URL, no header needed
const buf = await wiz.kb.downloadResource(docGuid, name) // Buffer
```
The `url` field is a signed URL — plain `fetch(url)` works without any auth header.

**Collaboration note resources** (`wiz.*`):
```js
const items = await wiz.listCollaborationResources(docGuid)   // [{name, blockType}]
const { buffer, contentType } = await wiz.downloadCollaborationResource(docGuid, name)
```
Collab resources live at `{kbServer}/editor/{kbGuid}/{docGuid}/resources/{name}` and require the `x-live-editor-token` cookie — handled internally.

**Upload + embed in one call (preferred):**
```js
const r = await wiz.uploadAndEmbed(docGuid, [
  'pic.png', 'audio.wav', 'pkg.zip'                       // string = local path
  // or { path, name?, kind? }  — override display name or tag ('image'|'audio'|'video'|'link')
], { position: 'append', heading: '附件区' })              // 'prepend' | 'append' (default)
// r.uploaded → [{path, name, serverName, url, kind}]
```
Auto-picks the HTML tag by extension:
- `image` (png/jpg/gif/webp/bmp/svg/avif/heic/ico) → `<img>`
- `audio` (mp3/wav/ogg/m4a/flac/aac/opus) → `<audio controls>`
- `video` (mp4/webm/mov/m4v/mkv/avi) → `<video controls>`
- anything else → `<a href download>` link

CLI equivalent:
```
wiz res upload <docGuid> <file>... [--prepend] [--heading="..."]
```

**Low-level upload only** (skip the HTML splice — you write the note yourself):
```js
const r = await wiz.kb.uploadResource(docGuid, await fs.readFile('pic.png'), 'pic.png')
// r → { name: '1784451192606-tdt.png', url: 'index_files/1784451192606-tdt.png', ... }

// CRITICAL: after uploading, you MUST register the server-issued name in the
// note's `resources` array on the next updateNote call — else the resource is
// invisible to other WizNote clients and no signed download URL is issued.
await wiz.kb.updateNote(docGuid, {
  kbGuid: wiz.kbGuid, docGuid,
  html: `<div class="wiz-note-body"><div class="wiz-note-html">
           <p><img src="${r.url}"></p>
         </div></div>`,
  url: '', tags: '', author: wiz.userId,
  resources: [r.name]            // ← merge with anything already on the note
})
```

**Gotchas the SDK already handles for you, but worth knowing:**
- Multipart field must be named `data` (not `file`); form MUST also carry sibling `kbGuid` + `docGuid` fields — else server returns `kbGuid is not match`.
- WizNote replaces the display filename with a server slug (e.g. `1784451192606-tdt`); images keep their extension, others don't. Use `r.url` verbatim in HTML; pass the original filename via `alt=` for user-facing labels.
- **The `resources` array in `updateNote` is what makes the resource *findable*.** Without it, `getNoteContent().resources` comes back empty, no signed URLs are minted, and other clients can't resolve `<img src="index_files/…">`. Once populated correctly, the server returns `resources[i].url` as an absolute signed URL that plain `fetch()` can hit (no `X-Wiz-Token` needed). `wiz.uploadAndEmbed` handles the merge automatically; if you call `kb.uploadResource` directly, do it yourself.

CLI: `wiz res ls <docGuid>`, `wiz res get <docGuid> <name> [-o out]`, `wiz res all <docGuid> [-o dir] [--user]`. `--user` filters WizNote editor CSS/icons from bulk downloads on legacy notes.

### Attachments (first-class file attachments)
| Method | Endpoint | Purpose |
|---|---|---|
| `kb.listAttachments(docGuid)` | `GET /ks/note/attachments/:kb/:doc` | list `[{ attGuid, name, size, ... }]` |
| `kb.uploadAttachment(docGuid, buffer, name)` | `POST /ks/attachment/create/:kb/:doc` | multipart `data` field (+ `kbGuid`/`docGuid` form fields) |
| `kb.downloadAttachment(docGuid, attGuid)` | `GET /ks/attachment/download/:kb/:doc/:att` | raw Buffer |
| `kb.deleteAttachment(docGuid, attGuid)` | `DELETE /ks/attachment/delete/:kb/:doc/:att` | |
| `kb.getAttachmentUrl(docGuid, attGuid)` | — | raw URL (needs `X-Wiz-Token` header, browser `<a href>` won't work) |

Endpoints follow the official docs at `https://www.wiz.cn/docs/restapi/ks.html`.

CLI: `wiz attach ls|put|get|rm|url <docGuid> [...]`.

**Attach + link into note body in one call:**
```js
await wiz.attachAndLink(docGuid, ['pkg.zip', 'audio.wav'], { heading: '📎 附件' })
```
Each file goes to the attachment panel (via `attachment/create`) and gets a `<a href="{rawUrl}" data-wiz-att-guid="…">name (size)</a>` block in the note body. CLI: `wiz attach embed <docGuid> <file>... [--prepend] [--heading="…"]`.

The link's `href` is the raw KS URL — clicks resolve inside authenticated WizNote clients (they inject `X-Wiz-Token`); a plain browser tab against that URL will 401. Use `uploadAndEmbed` (resource channel) when you need a body link that browsers can hit directly — those come with pre-signed URLs.

## Markdown notes (`type: 'lite/markdown'`, single-user)

WizNote's markdown editor requires the raw markdown wrapped in a full HTML5
shell — `<!doctype html><html><head><meta charset="utf-8"></head><body><pre>…markdown source…</pre></body></html>`.
Skipping the shell or using the `document`-note wrapper (`<div class="wiz-note-body">`) leaves the client body blank.

Use the helpers so you never touch the shell:

```js
const r = await wiz.createMarkdownNote({
  title: '周报 W17',
  markdown: '# 本周完成\n- 特性 A\n',
  category: '/工作/',
  tags: '',
  created: Date.parse('2026-04-27')   // optional — backdate creation time
})
await wiz.updateMarkdownNote({ docGuid: r.docGuid, markdown: '# 新版本', title: '新标题' })
const md = await wiz.readMarkdownNote(r.docGuid)   // raw markdown back
```

#### 回填时间戳(`created` / `dataModified`)——实测规律(2026-07-20 @ `vipkshttps14.wiz.cn`)

| 途径 | `created` | `dataModified`(修改时间) |
|---|---|---|
| `POST /ks/note/create`(建笔记时传) | ❌ 忽略,盖成 now | ❌ 盖成 now |
| `patchNoteInfo({created, dataModified})`(建完再改) | ✅ 生效 | ✅ 生效 |
| 之后任何内容保存(`updateNote` / collab 写块) | 保留不变 | **被冲回 now** |

要点:
- **创建端点不认 `created`**。`createMarkdownNote` / `createCollaborationNote`
  传的 `created` / `dataModified` 是**建完后由 helper 自动补一次 `patchNoteInfo`** 落地的,
  不是走 create body(走了也没用)。
- **`dataModified` 必须是最后一次写**:任何后续内容保存都会把它顶回当前时间。
  helper 已经把这个 patch 放在 collab 写块**之后**,单独调时也要留意顺序。
- 对**已存在**的笔记改时间:直接
  `await wiz.kb.patchNoteInfo(docGuid, { created, dataModified })`(毫秒时间戳)。

**`.md` 后缀**:markdown 笔记的标题统一带 `.md`。`createMarkdownNote` /
`updateMarkdownNote`(改标题时)会自动补 `.md`(已带则不重复;`ensureMdSuffix(title)`
是可复用的纯函数)。这是 markdown 笔记的命名约定,便于和其它类型区分。

Low-level: `wrapMarkdown(md)` returns the string body suitable for `kb.createNote({html, type:'lite/markdown'})`; `unwrapMarkdown(html)` pulls the source back out of `getNoteContent().html`.

CLI: `wiz md new "<title>" -f md.md [--category=/x/] [--created=<ms|date>] [--modified=<ms|date>]`, `wiz md read <docGuid>`, `wiz md update <docGuid> -f md.md [--title="…"]`.

### Embedding images / media in a `lite/markdown` note

WizNote's markdown editor renders `![alt](index_files/<name>)` — the **same
relative reference** its own editor writes when a user drags an image in. To
make this resolve, three things must line up (probed 2026-07-19 against
`vipkshttps14.wiz.cn`):

1. **Upload via `kb.uploadResource(docGuid, buffer, filename)`.** The server
   returns `{ name: '<timestamp-slug>[.ext]', url: 'index_files/<name>' }`.
   For images (png/jpg/…) the extension is preserved; for audio/zip/etc.
   the server drops the extension.
2. **Reference the resource in the markdown body as `![alt](index_files/<name>)`.**
   Use `r.name` verbatim (NOT the original filename you passed) — the server
   slug is what the client resolves against the manifest.
3. **Register `r.name` into the note's `resources[]` array in the follow-up
   `kb.updateNote(...)` call.** Merge with anything already on the note;
   never send `resources: []` on an update unless you really want to strip
   everything. Without this the manifest is empty and the reference resolves
   to nothing.

```js
const doc = await wiz.createMarkdownNote({ title: 'x', markdown: 'seed', category: '/My Notes/' })
const buf = await fs.readFile('photo.png')
const r = await wiz.kb.uploadResource(doc.docGuid, buf, 'photo.png')

const detail = await wiz.kb.getNoteContent(doc.docGuid, { downloadInfo: 1, downloadData: 1 })
const existing = (detail.resources || []).map(x => x.name)

const md = `# photo\n\n![photo](index_files/${r.name})\n`
await wiz.kb.updateNote(doc.docGuid, {
  kbGuid: wiz.kbGuid, docGuid: doc.docGuid,
  html: wrapMarkdown(md),
  url: '', tags: '', author: wiz.userId,
  resources: [...new Set([...existing, r.name])]     // ← MUST include the new slug
})
```

**Do NOT** use `getNoteContent().resources[i].url` (the absolute signed URL)
in the markdown body — those signatures expire in ~2h (`wiz_es` query param),
after which the image goes 404 for the reader. The `index_files/…` relative
form is stable as long as the resource is in the manifest.

**Audio/video (`<audio controls src="index_files/…">` inline HTML) is unreliable:**
non-image uploads come back without an extension, so the client can't guess
the MIME. If you must embed audio, prefer a `document`-type note (whose HTML
editor handles this via `<audio>` and per-note resource routing), or fall
back to a plain markdown download link `[audio.wav](index_files/…)`.

**For downloadable attachments** in a `lite/markdown` note (files that appear
in the WizNote attachment panel), upload via `kb.uploadAttachment(...)` and
link with `[filename](wiz.kb.getAttachmentUrl(docGuid, attGuid))`. Clicks
work inside authenticated WizNote clients; a plain browser tab against that
URL 401s (needs `X-Wiz-Token`).

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
  tags: '周报',
  created: Date.parse('2026-04-27')   // optional — backdate (applied post-create; see 回填时间戳 above)
})

// Read as Markdown (auto-detects note type, falls back to HTML for legacy)
const md = await wiz.readCollaborationNote(docGuid)

// Overwrite content
await wiz.updateCollaborationNote({ docGuid, markdown: '# new', title: 'new title' })
```

Supported Markdown constructs (write + read):
`# heading`, paragraphs, `**bold**` / `*italic*` / `~~strike~~` / `` `code` `` / `[link](url)`, `- ul` / `1. ol` / `- [x] check`, `> quote`, ` ``` code blocks ``` `, `---` hr, `![alt](url)` image, `| tables |`.

Not yet supported: formula/audio/drawio/encrypted/webpage embed blocks (roundtrip only).

### Media embeds in collab notes (upload + embed)

Collab notes store media as `embed` blocks with a content-addressed `src`.
Use the helper:

```js
await wiz.collabUploadAndEmbed(docGuid, [
  '/abs/path/pic.png',
  { path: '/abs/path/a.wav', name: 'song.wav' },  // override display name
  '/abs/path/pkg.zip'
], { position: 'append' })   // or 'prepend'
```

Auto-picks the embed kind by MIME:
- `image/*` → `embedType: image` (renders inline)
- `audio/*` → `embedType: audio` (inline audio card)
- `video/*` → `embedType: video`
- everything else → `embedType: office` (generic downloadable file card, used for zip/pdf/doc/…)

The helper preserves existing note content — it fetches current blocks,
appends the new embeds, and rewrites the doc via a sharejs delete+create op.
Existing text/heading/table blocks stay intact.

Low-level: `wiz.uploadCollabResource(docGuid, buffer, name)` returns
`{src, fileName, fileSize, fileType, hash}`; `wiz.appendCollabEmbeds(docGuid, items)`
splices those into the note.

CLI: `wiz collab embed <docGuid> <file>... [--prepend]`.

**Under the hood** (in case something breaks and you need to poke):

1. `POST /editor/:kb/:doc/resources/<hash>` with JSON body `{name, size}` — registers a resource slot on the doc for this content hash (201, empty array).
2. `POST /editor/:kb/:doc/resources` with **multipart** body:
   - `file-size`: byte count as string
   - `file-hash`: base64url(sha256(bytes)) — **no extension**
   - `file`: the bytes (Blob), filename preserved
   - Response: 201 `["<hash>.<ext>"]` — the final `src` for the embed block.
3. Both steps require these HEADERS (NOT cookies):
   - `x-live-editor-token`: value from `getCollaborationToken`
   - `x-live-editor-base-url`: `Buffer.from(kbServer+'/editor/'+kb+'/'+doc).toString('base64')`
4. Insert an `embed` block via WebSocket sharejs op:
   ```json
   {
     "id": "<random>", "type": "embed", "embedType": "image|audio|video|office",
     "align": "center", "quoted": false,
     "embedData": {
       "src": "<hash>.<ext>",
       "fileName": "<display name>",
       "fileSize": <bytes>,
       "fileType": "<MIME>",
       "previewType": "card"
     }
   }
   ```

Content-addressing (`src = base64url(sha256(bytes)) + '.' + ext`) means the
server dedupes across the whole KS instance — re-uploading the same bytes to
a new note is essentially free.

**How to tell an upload was deduped** (skipped the bytes on the wire):

`uploadCollabResource` returns `{..., deduped: boolean}` — read the flag off
each result. `collabUploadAndEmbed(...).uploaded[]` carries the same flag.

The signal comes from **Step 1's response body**:

| response | meaning |
|---|---|
| `[]`                    | Server has NO copy of these bytes yet. Step 2 uploads bytes. `deduped: false`. |
| `["<hash>.<ext>"]`      | Server already has these bytes (from any note, any user). Step 2 is **skipped** — no bytes leave your machine. `deduped: true`. |

If you want to check availability WITHOUT registering a slot, use
`wiz.hasCollabResource(docGuid, buffer|hash)` — but note it's **doc-scoped**:
returns `exists: false` for a hash the server has stored under another doc,
until you POST step 1 to bind it to this doc.

CLI: `wiz collab embed …` prints `(deduped, no upload)` vs `(new upload)`
per file and a summary `N embedded (K deduped, N-K bytes uploaded)`.

CLI: `wiz collab new "<title>" -f md.md [--category=/x/] [--tags=a,b] [--created=<ms|date>] [--modified=<ms|date>]`, `wiz collab read <docGuid>`, `wiz collab update <docGuid> -f md.md`.

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

**Official WizNote REST API docs** (the source of truth when this repo and the server disagree — go read the official docs first):

- Overview: <https://www.wiz.cn/docs/restapi/index.html>
- Account Server (AS): <https://www.wiz.cn/docs/restapi/as.html>
- Knowledge base (KS): <https://www.wiz.cn/docs/restapi/ks.html>

⚠ The official docs cover REST only. Some routes this skill uses were reverse-engineered from the WizNote web client and are NOT documented upstream — chiefly the collaboration-note WebSocket (sharejs) protocol and the two-step collab resource upload (`/editor/:kb/:doc/resources/<hash>` + `POST /editor/:kb/:doc/resources` multipart). See `skill/references/api.md` for those.

Language-agnostic URL / field / curl reference (local, with the reverse-engineered pieces): [skill/references/api.md](skill/references/api.md).
