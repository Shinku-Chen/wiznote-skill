# WizNote REST API — Protocol Reference

Language-agnostic protocol notes. Use this if you call WizNote from anything other than the JS SDK in this repo (Python, Go, curl, ...).

## Servers

| Server | Default host | Discovery |
|---|---|---|
| Account Server (AS) | `https://as.wiz.cn` | fixed; can be overridden pre-login |
| Knowledge Base (KS) | dynamic | returned in `Login` response as `kbServer` |

## Authentication

`X-Wiz-Token: <token>` header on every KS call after login.

```
POST https://as.wiz.cn/as/user/login
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
| GET    | `/ks/note/list/tag/:kbGuid` | list under a tag |
| GET    | `/ks/note/info/:kbGuid/:docGuid` | metadata |
| GET    | `/ks/note/download/:kbGuid/:docGuid` | full content |
| POST   | `/ks/note/create/:kbGuid` | create |
| PUT    | `/ks/note/save/:kbGuid/:docGuid` | update content |
| POST   | `/ks/note/upload/:kbGuid/:docGuid` | update metadata (title/tags/category) |
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
| POST | `/ks/resource/upload/:kbGuid/:docGuid` | multipart `file` field |

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
TOKEN=$(curl -sX POST https://as.wiz.cn/as/user/login \
  -H 'Content-Type: application/json' \
  -d '{"userId":"a@b.com","password":"***"}' | jq -r .result.token)
KB=$(...)      # kbGuid from same response
KSERVER=$(...) # kbServer

# 2. list root notes
curl "$KSERVER/ks/note/list/category/$KB?category=&start=0&count=10&orderBy=modified&ascending=desc" \
  -H "X-Wiz-Token: $TOKEN"
```
