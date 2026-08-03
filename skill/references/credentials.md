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
- No plaintext password on disk. When keytar is unavailable, the password is still stored — but **AES-256-GCM encrypted** (see "Auto-reauth" below), never in the clear.
- No writing the password into shell history / process arguments. `login` is interactive on a TTY; for headless use, pipe it via `--password-stdin` (kept out of `argv`), never `wiz login --password=xxx`.

## What still needs care from the user / consumer

- Backups: `~/.config/wiznote/session.json` (token) and, on keytar-less hosts, `~/.config/wiznote/password.enc.json` (encrypted password) may be picked up by dotfile-sync tools; the token grants full account access until logout, and the encrypted password blob is only as safe as its host (its key is machine-derived — see Auto-reauth threat model).
- Multi-user machines: OS Keychain scopes per user account — safe. The fallback file lives in `$HOME` — also per-user, but readable by any process running as that user.
- Environment variable leaks: subprocess inheritance, `docker inspect`, `env` dumps in error handlers.
- Log lines: neither the SDK nor the CLI log the token, but if you write your own wrapper, make sure `console.log(config)` doesn't include the token by accident.

## Guidance for AI assistants (Claude Code / Cursor / etc.) using this skill

1. **Never suggest hardcoding the token** in source files, `.env` checked into git, or any documentation file.
2. **Never ask the user to paste their password into chat.** If credentials are missing, tell them to run `wiz login` in their terminal.
3. **Never write the token to `CLAUDE.md`, `AGENTS.md`, memory, or any file that could get committed** — these become AI context and can be echoed back.
4. If you need to demonstrate an authenticated call, use `await WizClient.fromStored()` and let the runtime resolve credentials — do not surface the token value.
5. If a user provides a token in the chat for debugging, use it only in-memory and remind them to rotate it (`wiz logout && wiz login`).

## Auto-reauth via stored password (on by default)

Since v0.2 the SDK stores the password in OS Keychain by default so the ~15-min token TTL doesn't cause `Invalid token` errors during normal use. Users can opt out:

```bash
wiz login                        # default: stores both token AND password
wiz login --no-save-password     # skip password (safer, more manual)
wiz save-password                # re-enable after the fact
wiz forget-password              # disable (keeps token; only clears password)
```

**Non-interactive login (containers / CI / OpenClaw — no TTY, no keychain):**

```bash
echo "$WIZ_PW" | wiz login --user=you@example.com --password-stdin [--endpoint=https://as.example.com]
echo "$WIZ_PW" | wiz save-password --password-stdin      # re-enable auto-reauth headlessly
```

`--password-stdin` reads the password from piped stdin, so it never lands in `argv`, `docker inspect`, or shell history. `--user` is required alongside it (stdin is consumed by the password, so the userId can't also be prompted). With no TTY and no `--password-stdin`, the CLI errors out immediately instead of hanging on a prompt.

When enabled:
- Password is written to OS Keychain under service `wiznote-sdk-password` **if keytar is available**; otherwise it is **AES-256-GCM encrypted** into `~/.config/wiznote/password.enc.json` (mode `0600`), keyed by userId
- On any `kb.*` call that fails with an auth-shaped error (`WizApiError` code 301/322/31001 or message matching `invalid token|expired|unauthorized|无效.*token|token.*失效`), the client silently calls `login()` with the stored password, updates its token, and retries the original call **once**
- Reauth is de-duplicated via `_reauthInFlight` so concurrent calls don't stampede

**Threat model:**
- OS Keychain scoped to the user — safe against other users on the same machine; admin-level malware or root shell can still read it
- Password rotation on WizNote's side (via web UI) will cause reauth to fail; user must re-run `wiz login`
- **Encrypted-file fallback (keytar-less):** the AES key is *derived from host-local identifiers* (`/etc/machine-id`, uid, hostname, homedir) — **no key is stored on disk**. This is encryption **at rest**: it stops casual plaintext leakage via backups, dotfile-sync, log dumps or `grep`, but an attacker who already has the container's filesystem can re-derive the key. It is **not** a substitute for a real secrets manager. Two consequences: (1) the blob is only decryptable on the machine that wrote it — if the container's `machine-id` changes on rebuild, `getStoredPassword` returns `null` and the user is cleanly forced to re-login; (2) for real protection in a hostile multi-tenant host, prefer env-only credentials (see below) over stored passwords.

**AI-assistant rule:** the default is to save the password because the ~15-min TTL makes any non-trivial automation unusable otherwise. But if the user's context suggests a shared or hostile environment (kiosks, corporate shared workstations, security-sensitive projects), remind them of `--no-save-password` before proceeding.

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
