# Credential Handling — Rationale & Threat Model

WizNote's protocol is **password-for-token**: `POST /as/user/login` exchanges `{userId, password}` for a `token`. The token then rides every subsequent request as the `X-Wiz-Token` header. **The password itself is never needed again after that single call.**

This document explains how `wiznote-sdk` handles credentials and what guarantees it makes.

## Storage tiers, in preference order

| Tier | Where | When to use | Downside |
|---|---|---|---|
| **OS Keychain** | macOS Keychain / Windows Credential Manager / libsecret via `keytar` | Any desktop / dev-workstation scenario | Requires optional native module; unavailable in most CI |
| **Env vars** | `WIZ_TOKEN`, `WIZ_KB_GUID`, `WIZ_KB_SERVER`, `WIZ_USER` | CI, Docker, one-shot scripts, remote SSH | Visible via `env`, `/proc/<pid>/environ`, dumped in some crash logs |
| **Config file** | `~/.config/wiznote/session.json` with mode `0600` | Fallback when keytar not installed | Plaintext on disk; relies on FS permissions |
| **In-memory only** | `WizClient` constructor args | Short-lived tests, one-off scripts | Vanishes on exit — feature, not bug |

Password is **never** stored anywhere. `WizClient.login()` uses it once and discards.

## What the SDK explicitly rejects

- No `WizClient({ password })` — the constructor doesn't accept a password.
- No "remember my password" flag.
- No password caching, even encrypted.
- No writing the token into shell history / process arguments (`login` is interactive, not `wiz login --password=xxx`).

## What still needs care from the user / consumer

- Backups: `~/.config/wiznote/session.json` may be picked up by dotfile-sync tools; token grants full account access until logout.
- Multi-user machines: OS Keychain scopes per user account — safe. The fallback file lives in `$HOME` — also per-user, but readable by any process running as that user.
- Environment variable leaks: subprocess inheritance, `docker inspect`, `env` dumps in error handlers.
- Log lines: neither the SDK nor the CLI log the token, but if you write your own wrapper, make sure `console.log(config)` doesn't include the token by accident.

## Guidance for AI assistants (Claude Code / Cursor / etc.) using this skill

1. **Never suggest hardcoding the token** in source files, `.env` checked into git, or any documentation file.
2. **Never ask the user to paste their password into chat.** If credentials are missing, tell them to run `wiz login` in their terminal.
3. **Never write the token to `CLAUDE.md`, `AGENTS.md`, memory, or any file that could get committed** — these become AI context and can be echoed back.
4. If you need to demonstrate an authenticated call, use `await WizClient.fromStored()` and let the runtime resolve credentials — do not surface the token value.
5. If a user provides a token in the chat for debugging, use it only in-memory and remind them to rotate it (`wiz logout && wiz login`).

## Auto-reauth via stored password (opt-in)

By default the SDK follows the "password used once, never stored" rule. If the user explicitly wants the SDK to silently re-authenticate when the token expires, they can opt in:

```bash
wiz login --save-password    # at login time
wiz save-password            # after login (post-hoc)
wiz forget-password          # disable
```

When enabled:
- Password is written to OS Keychain under service `wiznote-sdk-password`
- On any `kb.*` call that fails with an auth-shaped error (`WizApiError` code 301/322/31001 or message matching `invalid token|expired|unauthorized|无效.*token|token.*失效`), the client silently calls `login()` with the stored password, updates its token, and retries the original call **once**
- Reauth is de-duplicated via `_reauthInFlight` so concurrent calls don't stampede

**Threat model:**
- OS Keychain scoped to the user — safe against other users on the same machine, admin-level malware or root shell can still read it
- Password rotation on WizNote's side (via web UI) will cause reauth to fail; user must re-run `wiz login`
- If keytar isn't installed, `savePassword` throws — we refuse to store passwords in the plain-text config file

**AI-assistant rule:** never call `savePassword` on the user's behalf without explicit consent. State the trade-off (any local process running as the user can read it) and let them decide.

## Rotation & revocation

- Rotate: `wiz logout && wiz login` — old token is invalidated server-side by `logout`, new one replaces the keychain entry.
- Keep-alive: `wiz.account.keepTokenAlive({ token })` extends TTL without a full re-login. Run periodically (e.g. once a day) for long-lived processes.

## When someone insists on env-only

Some deployments have hard "no on-disk secrets" rules. In that case:

```
export WIZ_TOKEN=$(vault kv get -field=token wiznote/prod)
export WIZ_KB_GUID=...
export WIZ_KB_SERVER=https://kshttps0.wiz.cn
node your-script.js
```

The SDK's resolution order puts env above the config file, so no config file is written — it stays keychain-optional, env-authoritative.
