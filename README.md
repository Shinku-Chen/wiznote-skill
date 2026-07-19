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

问账号密码,登录成功后 **token 和密码都存进系统 Keychain**(macOS Keychain / Windows 凭据管理器 / Linux libsecret)。之后 AI 直接用 token 调接口,永远看不到你的密码;WizNote token ~15 分钟过期时,skill 会自动用密码悄悄续登,你无感。

不想存密码?加 `--no-save-password`,只存 token,过期后再手动 `wiz login` 一次。

想启用 Keychain 需要额外一步(可选,不装也能跑,自动降级到 `0600` 文件):

```bash
cd ~/.claude/skills/wiznote-api && npm run setup
```

Windows / Linux 需要装编译工具链,见 [INSTALL.md](INSTALL.md)。

## 自动续登(默认开启)

WizNote 的 token 大约 **15 分钟**过期,skill 默认把密码也一起存进 Keychain,过期时自动续登、你无感。

```bash
wiz login                    # 默认:token + 密码都存,自动续登
wiz login --no-save-password # 只存 token,过期后要手动 wiz login
wiz save-password            # 已登录的,现在开启自动续登
wiz forget-password          # 关闭自动续登(清密码,token 保留)
```

**权衡说明**:Keychain 是加密存储,同机不同 OS 用户读不到你的密码。但**同一 OS 账号下**跑的任何程序都能通过 keytar 读回来。共享机器 / 不放心的场景加 `--no-save-password`。

## 常用命令

```bash
wiz login                        # 登录(默认自动续登;加 --no-save-password 关闭)
wiz whoami                       # 查看当前账号
wiz ls                           # 根目录前 50 篇
wiz ls /工作/                    # 指定文件夹前 50 篇
wiz ls --count=200               # 一页拉 200 篇
wiz ls --start=50                # 从第 51 篇开始
wiz ls /工作/ --all              # 自动翻页拉完整个文件夹
wiz search 关键词                # 搜笔记
wiz cat <docGuid>                # 看笔记内容(HTML/协作笔记)
wiz collab read <docGuid>        # 协作笔记转 Markdown 输出
wiz tags                         # 列出标签

wiz res ls <docGuid>             # 列出笔记里嵌入的图片/文件
wiz res get <docGuid> <name>     # 下载单个,-o 指定输出路径
wiz res all <docGuid> -o ./out   # 一把梭下载所有到目录,--user 过滤系统资源
wiz save-password / forget-password  # 开/关自动续登
wiz logout                       # 登出并清本地(token + 密码都清)
```

(实际调用形式:`node ~/.claude/skills/wiznote-api/scripts/wiz.js <cmd>`,想省事可以在 shell 里 `alias wiz="node ~/.claude/skills/wiznote-api/scripts/wiz.js"`)

## AI 用起来是这样的

装好 + 登录之后,你可以让 AI 干:

- "把今天的会议纪要建一篇笔记(Markdown 内容),放到 `/工作/2026/` 文件夹" —— 会走**协作笔记**流程
- "把某篇协作笔记读出来给我看" —— 自动转换成 Markdown
- "把 xxx 笔记里的图片全下下来" —— `wiz res` 自动识别是 HTML 还是协作笔记走对应端点
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
