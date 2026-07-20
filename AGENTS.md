# AGENTS.md

给 AI agent(Claude Code / Cursor / Codex 等)读的仓库说明。用户视角的用法看 `README.md`;skill 自身的触发说明看 `SKILL.md`。

## 项目概述

WizNote(为知笔记)REST API 的 AI Skill。作为**自包含的 skill 目录**被 clone 进各 agent 的 skills 路径(`~/.claude/skills/wiznote-api/`、`.cursor/skills/wiznote-api/`、`~/.workbuddy/skills/wiznote-api/`),让 agent 通过 `node scripts/wiz.js <cmd>` 完成登录、笔记 CRUD、搜索、文件夹/标签管理、图片附件上传、协作笔记资源读取等操作。支持公网 `as.wiz.cn` 和企业自建 endpoint 两种模式。

铁律:**绝不硬编码凭据、绝不让用户在对话里贴密码**,一律 `wiz login` 交互登录,token(可选连同密码)存 OS Keychain,降级到 `0600` 文件。

## 目录结构

```
SKILL.md              skill frontmatter + runbook,agent 触发入口
README.md             面向用户的安装/登录说明
INSTALL.md            Windows / Linux Keychain 依赖装配细节
scripts/wiz.js        CLI 入口:login / note / search / tag / category / res 等子命令
src/
  index.js            公共 SDK 出口
  WizClient.js        高层客户端(登录状态、KB 路由、请求编排)
  AccountServerApi.js as.wiz.cn 账户服务端点
  KnowledgeBaseApi.js 单个知识库 (kbServer) 的 REST 调用
  request.js          fetch 包装、错误处理、重试
  credentials.js      OS Keychain(keytar)+ 0600 文件降级
  blocks.js           协作笔记 (collab-note) 的块结构解析
  collaboration.js    协作笔记 WebSocket / 资源列表 / 下载
skill/references/     SKILL.md 引用的长文档
test/                 node:test 单元测试
```

**这是 skill 目录,不是普通 npm 包**:根目录不引入构建产物、不要求 `npm install` 才能跑(`keytar` / `ws` 都是 `optionalDependencies`,缺失自动降级)。

## 构建与验证

```bash
npm test              # node --test 跑 test/ 下全部用例(argless,兼容各 Node 版本的自动发现)
node scripts/wiz.js --help   # 冒烟:CLI 能起来
```

无构建步骤(纯 ESM,`"type": "module"`,Node 18+ 内置 `fetch`)。改动后至少跑 `npm test`。涉及登录 / 服务器交互的手动验证在**本地已登录的环境**上跑 `wiz` 子命令确认;不要把测试账号凭据写进仓库。

可选依赖装配:`npm run setup` 会尝试 `npm i --no-save keytar ws`,失败不阻塞(SDK 会降级)。Windows / Linux 的原生编译依赖见 `INSTALL.md`。

## 代码约定

- ESM only(`import` / `export`,不写 `require`)。Node 18+ 特性(顶层 `fetch`、`AbortController`)可直接用。
- 凭据只走 `src/credentials.js`,业务代码不直接读环境变量或文件;新增字段先在这里收口。
- 网络请求统一走 `src/request.js`,不要在业务模块里另起 `fetch`——错误码翻译、token 过期重登、超时都在这层。
- `WizClient` 是**唯一**对外的高层入口:CLI 和 SDK 消费方都拿它,不要跨层直接调 `AccountServerApi` / `KnowledgeBaseApi`。
- 注释默认中文,技术术语 / 类型名 / API 名保留英文。默认不写注释,只在 WHY 非显然时补一行。
- 新增 CLI 子命令时同步更新 `SKILL.md` 的用法段,让 agent 能发现。

## 提交规范

- commit 标题:`type(scope): 简述`,`type` ∈ `feat/fix/docs/refactor/perf/test/chore/build/ci`,scope 用模块名(`auth` / `res` / `ci` / `readme` 等)。简述用祈使句、≤50 字符、结尾不加句号、默认中文,技术术语保留英文。
- 一个 commit 只做一件事,message 描述最终 diff,不叙述调试过程。
- **改动落地并验证(`npm test` 绿、无临时文件残留)后,主动在同一轮内 `git commit` 并 `git push`,不用每次征求同意**;push 是必须的,别停在 commit。个人仓库直接推 `main`(历史全是直推 main、`origin/main` 同步)。
- 例外仍需确认的只有开 PR/MR 这类公开动作;push 到 `main` 不需要额外点头。

## 其他约定

- **不加运行时依赖**:所有必需依赖必须能靠 Node 内置模块搞定;需要原生扩展的一律 `optionalDependencies` + 降级路径。
- **不新增顶层文件**:安装体验在 README/INSTALL 里已收敛,新说明尽量并入现有文档而不是再拆一个 `.md`。
- **私有化 endpoint 优先级**:CLI `--endpoint` > `WIZ_ENDPOINT` env > 已存 token 里绑定的 endpoint > 默认 `https://as.wiz.cn`。改动这条链路要保留原优先级。
