# Install notes

Detailed setup for different platforms and edge cases. For the happy path see [README.md](README.md).

## Prerequisites

- **Node.js ≥ 18** — the SDK uses built-in `fetch`.
  Check with `node -v`.
- **git** — to clone the repo into the skill directory.

Nothing else is strictly required. Two **optional** upgrades:
- **`keytar`** — enables OS Keychain storage for the login token (falls back to a `0600` file otherwise).
- **`ws`** — enables **collaboration notes** support (create/read/update WizNote's modern block-based note format, which travels over WebSocket). Legacy HTML notes work without it.

Both are installed by `npm run setup`.

## Where to put the skill

| Agent | Path | Scope |
|---|---|---|
| Claude Code | `~/.claude/skills/wiznote-api` | user-global |
| Cursor (per project) | `<repo>/.cursor/skills/wiznote-api` | current project only |
| Cursor (user-global) | `~/.cursor/skills/wiznote-api` | all projects |
| Workbuddy / OpenClaw | `~/.workbuddy/skills/wiznote-api` | user-global |

Windows equivalents:

| Agent | Path |
|---|---|
| Claude Code | `%USERPROFILE%\.claude\skills\wiznote-api` |
| Cursor (per project) | `<repo>\.cursor\skills\wiznote-api` |
| Workbuddy | `%USERPROFILE%\.workbuddy\skills\wiznote-api` |

Clone with:

```bash
git clone https://github.com/Shinku-Chen/wiznote-skill.git <target-path>
```

## Optional: enable OS Keychain (keytar)

`keytar` is a native module — it needs a C++ toolchain and Python at install time. If your OS is set up for Node native builds this is a one-liner; otherwise see the per-platform notes.

```bash
cd ~/.claude/skills/wiznote-api
npm run setup       # equivalent to: npm i --no-save keytar
```

If it fails, the SDK will still work — just falls back to `~/.config/wiznote/session.json` (mode `0600`). You can retry later.

### macOS

Usually works out of the box on Apple Silicon and Intel with recent Xcode Command Line Tools.

```bash
xcode-select --install    # if not already installed
npm run setup
```

Token lives in **Keychain Access** under service `wiznote-sdk`.

### Windows

Requires **Visual Studio Build Tools** (or full Visual Studio) for the native compile step. Fastest install:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add ProductLang En-us --add Microsoft.VisualStudio.Workload.VCTools"
npm run setup
```

Token lives in **Credential Manager** → *Windows Credentials* → generic credential `wiznote-sdk`.

If the build still fails, you can skip keytar entirely — the file fallback works fine on Windows too (the file lives at `%USERPROFILE%\.config\wiznote\session.json`).

### Linux

Needs `libsecret` headers and Python:

```bash
# Debian / Ubuntu
sudo apt install -y libsecret-1-dev python3 build-essential

# Fedora / RHEL
sudo dnf install -y libsecret-devel python3 gcc-c++ make

# Arch
sudo pacman -S --needed libsecret python base-devel
```

Then `npm run setup`. Requires a running secret-service (GNOME Keyring / KWallet / KeePassXC with secret-service integration). Headless servers usually don't have one; use the file fallback or env variables there.

### Docker / CI / SSH-only

Skip keytar. Use environment variables instead:

```bash
export WIZ_TOKEN=...
export WIZ_KB_GUID=...
export WIZ_KB_SERVER=https://kshttps0.wiz.cn
export WIZ_USER=you@example.com

# Optional: on-premise deployment (AS+KS on same host)
export WIZ_ENDPOINT=https://wiznote.mycompany.internal
```

Get the values by running `wiz login` once on your workstation, then `wiz whoami` (metadata) plus reading the token out of the keychain if you enabled it.

### On-premise / 私有化服务器

If your company hosts its own WizNote:

```bash
node scripts/wiz.js login --endpoint=https://wiznote.mycompany.internal
```

The endpoint value is persisted alongside the other session metadata, so subsequent calls don't need to repeat it.

## First-time login

```bash
node ~/.claude/skills/wiznote-api/scripts/wiz.js login
```

The password is sent once to `https://note.wiz.cn/as/user/login` and discarded. On success:

- **Keychain available** → token → Keychain; metadata (userId/kbGuid/kbServer) → `~/.config/wiznote/session.json`
- **Keychain unavailable** → token + metadata → `~/.config/wiznote/session.json` (mode `0600`)

Verify:

```bash
node ~/.claude/skills/wiznote-api/scripts/wiz.js whoami
node ~/.claude/skills/wiznote-api/scripts/wiz.js ls
```

## Upgrading

```bash
cd ~/.claude/skills/wiznote-api
git pull
```

Your credentials aren't touched — they live outside the repo (Keychain / `~/.config/wiznote/`).

## Uninstall

```bash
node ~/.claude/skills/wiznote-api/scripts/wiz.js logout   # invalidate token server-side + clear local state
rm -rf ~/.claude/skills/wiznote-api
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `WizNote token not found` | Never ran `login`, or keytar broke | Re-run `wiz login`, or set `WIZ_TOKEN` env |
| `keytar` install fails | Missing native toolchain | See per-platform notes above, or just skip it |
| `kbGuid is not match` on API call | Note was moved to a different KB | Clear the local `docGuid`; refetch from server |
| Token expired errors | TTL ran out | `wiz login` again, or call `keepTokenAlive` periodically in long-running processes |
| Behind corporate proxy | fetch can't reach `note.wiz.cn` | Set `HTTPS_PROXY=http://...` before invoking Node (Node 18+ respects it via undici) |
| Node < 18 error | No built-in `fetch` | Upgrade Node, or install a `fetch` polyfill (not officially supported) |
