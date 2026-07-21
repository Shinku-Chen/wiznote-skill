# WizNote REST API — Protocol Reference

Language-agnostic protocol notes. Use this if you call WizNote from anything other than the JS SDK in this repo (Python, Go, curl, ...).

**Upstream docs — always cross-check first**:

- Overview: <https://www.wiz.cn/docs/restapi/index.html>
- Account Server (AS): <https://www.wiz.cn/docs/restapi/as.html>
- Knowledge base (KS): <https://www.wiz.cn/docs/restapi/ks.html>

This file adds routes the upstream docs don't cover (collab-note WebSocket sharejs protocol, two-step collab resource upload) and records observed quirks (multipart field-name gotchas, dedupe signals) that the docs are silent on.

## Servers

| Server | Default host | Discovery |
|---|---|---|
| Account Server (AS) | `https://note.wiz.cn` | default; overridable pre-login (legacy host: `as.wiz.cn`) |
| Knowledge Base (KS) | dynamic | returned in `Login` response as `kbServer` |

## Authentication

`X-Wiz-Token: <token>` header on every KS call after login.

```
POST https://note.wiz.cn/as/user/login
{ "userId": "a@b.com", "password": "..." }

→ { returnCode:200, result:{ token, kbGuid, kbServer, userGuid, ... } }
```

Token is refreshed with `GET /as/user/keep`; invalidated with `GET /as/user/logout`.

## Endpoint tables

### Account Server

| HTTP | Path | Purpose |
|---|---|---|
| POST | `/as/user/login` | password → token |
| POST | `/as/user/login/token` | token → user info |
| GET  | `/as/user/logout` | invalidate token |
| GET  | `/as/user/keep` | extend TTL |
| GET  | `/as/user/avatar/:userGuid` | avatar PNG |

### Knowledge Base — notes

| HTTP | Path | Purpose |
|---|---|---|
| GET    | `/ks/note/list/category/:kbGuid` | list under a folder |
| GET    | `/ks/note/list/tag/:kbGuid` | list under a tag — ⚠️ `orderBy` query param required (e.g. `created`), else `No options.orderBy` (code 2000) |
| GET    | `/ks/note/info/:kbGuid/:docGuid` | metadata |
| GET    | `/ks/note/download/:kbGuid/:docGuid` | full content |
| POST   | `/ks/note/create/:kbGuid` | create |
| PUT    | `/ks/note/save/:kbGuid/:docGuid` | update content |
| POST   | `/ks/note/upload/:kbGuid/:docGuid` | update metadata — ⚠️ **full overwrite**: body must carry `kbGuid`+`docGuid` and every field to keep (`type`/`attachmentCount`/`protected`/…); omitted fields are nulled and new clients reject notes with null `attachmentCount`. To patch, GET the note first, merge, re-upload. |
| DELETE | `/ks/note/delete/:kbGuid/:docGuid` | delete |
| POST   | `/ks/note/copy/:kbGuid/:docGuid` | copy across kb/category |
| GET    | `/ks/note/search/:kbGuid?ss=...` | full-text search |

### Knowledge Base — categories

| HTTP | Path | Purpose |
|---|---|---|
| GET    | `/ks/category/all/:kbGuid` | tree |
| POST   | `/ks/category/create/:kbGuid` | create |
| DELETE | `/ks/category/delete/:kbGuid` | delete (`?category=/x/`) |
| PUT    | `/ks/category/rename/:kbGuid` | rename |

### Knowledge Base — tags

| HTTP | Path | Purpose |
|---|---|---|
| GET    | `/ks/tag/all/:kbGuid` | list all |
| POST   | `/ks/tag/create/:kbGuid` | create |
| PUT    | `/ks/tag/rename/:kbGuid` | rename |
| PUT    | `/ks/tag/move/:kbGuid` | change parent |
| DELETE | `/ks/tag/delete/:kbGuid/:tagGuid` | delete |

### Knowledge Base — resources

| HTTP | Path | Purpose |
|---|---|---|
| POST | `/ks/resource/upload/:kbGuid/:docGuid` | upload image/blob for legacy notes; multipart body: `kbGuid`, `docGuid`, `data` (file). Response `{ name, url }` — embed `url` as `<img src="index_files/…">` and `updateNote(html)`. |
| GET  | `/ks/note/download/:kbGuid/:docGuid` | resources returned in `.resources[]` with signed URLs (`resources[i].url` requires no auth header). |

For collaboration notes, resources live at `{kbServer}/editor/:kb/:doc/resources/:name`
with the `x-live-editor-token` cookie — see `src/collaboration.js`.

### Knowledge Base — attachments (first-class)

| HTTP | Path | Purpose |
|---|---|---|
| GET    | `/ks/note/attachments/:kbGuid/:docGuid` | list `[{ attGuid, name, size, dataMd5, dataModified }]` |
| POST   | `/ks/attachment/create/:kbGuid/:docGuid` | multipart body: `kbGuid`, `docGuid`, `data` (file). Response contains `att.attGuid`. |
| GET    | `/ks/attachment/download/:kbGuid/:docGuid/:attGuid` | raw bytes (requires `X-Wiz-Token` header) |
| DELETE | `/ks/attachment/delete/:kbGuid/:docGuid/:attGuid` | |
| GET    | `/ks/object/download/:kbGuid/:docGuid?objType=attachment&objId=:attGuid` | alt download; returns a zip container (used by sync clients) |

Both resource and attachment `POST` MUST include `kbGuid` + `docGuid` as
sibling multipart form fields alongside the `data` file — the server
validates them against the URL path and returns
`{"returnCode":2000,"returnMessage":"kbGuid is not match"}` otherwise.
Field must be named `data` (not `file`).

## Response envelope

```json
{ "returnCode": 200, "returnMessage": "OK", "result": <payload> }
```

Non-200 `returnCode` means error; check `returnMessage` and `externCode`.
Common: `kbGuid is not match` = note moved to another KB.

## Note object

From `getCategoryNotes`:
```json
{
  "guid": "...",
  "title": "hello.md",
  "category": "/work/",
  "dataCreated": 1234567890000,
  "dataModified": 1234567890000,
  "tags": "tagA*tagB"
}
```

From `getNoteContent`:
```json
{
  "info": { ... },
  "html": "<div class='wiz-note-body'>...</div>",
  "resources": [{ "hash": "...", "name": "img.png", "size": 12345 }]
}
```

HTML wrapper (created via WizNote's own editor):
```html
<div class="wiz-note-body">
  <div class="wiz-note-html">…actual body…</div>
  <pre class="wiz-note-document-info" style="display:none">
    {"document":{"title":"...","guid":"...","kbGuid":"..."}}
  </pre>
</div>
```

## Category paths

| Kind | Example |
|---|---|
| Root | `""` |
| Sub | `/work/` |
| Nested | `/work/projectA/` |

Always start & end with `/` for non-root.

## Note `type`

| Value | Meaning |
|---|---|
| `document` | Regular WYSIWYG document |
| `lite/markdown` | Markdown-flavoured lite note |

## Pagination / ordering

| Param | Type | Notes |
|---|---|---|
| `start` | int | offset |
| `count` | int | per-page |
| `withAbstract` | bool | include preview text |
| `orderBy` | `modified` \| `created` | |
| `ascending` | `asc` \| `desc` | (note: `desc` here means descending) |

## curl smoke test

```bash
# 1. login
TOKEN=$(curl -sX POST https://note.wiz.cn/as/user/login \
  -H 'Content-Type: application/json' \
  -d '{"userId":"a@b.com","password":"***"}' | jq -r .result.token)
KB=$(...)      # kbGuid from same response
KSERVER=$(...) # kbServer

# 2. list root notes
curl "$KSERVER/ks/note/list/category/$KB?category=&start=0&count=10&orderBy=modified&ascending=desc" \
  -H "X-Wiz-Token: $TOKEN"
```
