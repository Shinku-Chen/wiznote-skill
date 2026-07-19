# wiznote-api skill

WizNote(为知笔记)接口的 AI Skill。让 Claude Code、Cursor 等 AI 助手能安全地操作你的为知笔记 —— 建笔记、搜笔记、管标签、传图片。

密码不会存,只存登录后拿到的 token,优先放系统 Keychain。

## 安装

跟 AI 说一句就行:

> 把 `https://github.com/Shinku-Chen/wiznote-skill` 装成 Claude Code(或 Cursor)的 skill

或者自己一行:

```bash
git clone https://github.com/Shinku-Chen/wiznote-skill.git ~/.claude/skills/wiznote-api
```

Cursor 用户改成 `.cursor/skills/wiznote-api`,Workbuddy 用户改成 `~/.workbuddy/skills/wiznote-api`。Windows 详细路径见 [INSTALL.md](INSTALL.md)。

**私有化服务器**(公司自建 WizNote):`wiz login --endpoint=https://your-host` 或 `export WIZ_ENDPOINT=...`。

## 登录(只做一次)

**在自己终端里跑,别把密码贴进 AI 对话:**

```bash
node ~/.claude/skills/wiznote-api/scripts/wiz.js login
```

问账号密码,登录成功后 token 存进系统 Keychain(macOS Keychain / Windows 凭据管理器 / Linux libsecret)。之后 AI 直接用 token 调接口,永远看不到你的密码。

想启用 Keychain 需要额外一步(可选,不装也能跑,自动降级到 `0600` 文件):

```bash
cd ~/.claude/skills/wiznote-api && npm run setup
```

Windows / Linux 需要装编译工具链,见 [INSTALL.md](INSTALL.md)。

## 常用命令

```bash
wiz login              # 登录
wiz whoami             # 查看当前账号
wiz ls                          # 根目录前 50 篇
wiz ls /工作/                   # 指定文件夹前 50 篇
wiz ls --count=200              # 一页拉 200 篇
wiz ls --start=50               # 从第 51 篇开始
wiz ls /工作/ --all             # 自动翻页拉完整个文件夹
wiz search 关键词       # 搜笔记
wiz cat <docGuid>      # 看笔记内容
wiz tags               # 列出标签
wiz logout             # 登出并清本地
```

(实际调用形式:`node ~/.claude/skills/wiznote-api/scripts/wiz.js <cmd>`,想省事可以在 shell 里 `alias wiz="node ~/.claude/skills/wiznote-api/scripts/wiz.js"`)

## AI 用起来是这样的

装好 + 登录之后,你可以让 AI 干:

- "把今天的会议纪要建一篇笔记,放到 `/工作/2026/` 文件夹"
- "搜一下我笔记里所有提到 `Rust` 的,列出标题"
- "把这张截图上传到笔记 `xxx-guid` 里"
- "给最近三篇笔记都加上 `重要` 标签"

AI 会调 `WizClient` 完成,不需要你告诉它任何账号信息。

## 更多

- [INSTALL.md](INSTALL.md) — 多平台安装细节、代理、CI 场景
- [SKILL.md](SKILL.md) — 完整 API 列表(给 AI 看的)
- [skill/references/api.md](skill/references/api.md) — WizNote REST 协议参考
- [skill/references/credentials.md](skill/references/credentials.md) — 凭据存储策略 & 威胁模型

MIT License.
