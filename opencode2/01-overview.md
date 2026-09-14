# OpenCode v2 架构总览

> 版本基线：`@opencode/plugin@2.0.3` + `@opencode/schema@2.0.3`（GA 正式版，2026-09-14 核实）；宿主实测基线 `@opencode/cli@2.0.3`
> 证据源：npm registry dist-tags/tarball、tarball 类型声明、宿主 CLI 实测（2.0.3 隔离 serve）、官方 V2 文档站（opencode.ai/v2/docs）与 GitHub tags（anomalyco/opencode）。

## 1. 产品形态

OpenCode 是开源 AI coding agent。v2 正式版（CLI 名 `opencode`，别名 `opencode2`）延续三形态：终端 TUI、桌面/IDE 扩展、headless server + Web。v2 核心变化是**插件化的宿主架构**：agent/skill/command/tool/MCP/权限/模型目录全部开放插件扩展点，且 2.0 起宿主内置能力（工具/provider/配置域/websearch/VCS）本身也以 `opencode.*` builtin 插件形态组织（见 `10-builtin-inventory.md`）。

```
┌─ opencode2 CLI ────────────────────────────────────────────┐
│  TUI (OpenTUI/Solid)      headless server (`opencode2 serve`)│
│   ├ tui plugins (dist/tui)   ├ server plugins (promise/effect)│
│   └ slot tree / keymap / ... └ 20+ Context 域               │
│             \                  /                             │
│              v2 HTTP API + SSE (`/api/*`, `/api/event`)     │
│              RPC 通道 (`/api/rpc/*`, Plugin.features.rpc)    │
└─────────────────────────────────────────────────────────────┘
```

## 2. npm 包家族（双 scope 双轨，2026-09-14）

**V2 线（新 scope `@opencode`，latest 均 2.0.3）**：

| 包 | 版本 | 角色 |
|---|---|---|
| `@opencode/plugin` | 2.0.3 | 插件开发 SDK（promise/effect/tui 三入口） |
| `@opencode/schema` | 2.0.3 | 全量领域 schema（agent/session/tool/config/...） |
| `@opencode/cli` | 2.0.3 | CLI 二进制分发（bin 双名 `opencode`+`opencode2`；平台子包 `@opencode/cli-{platform}`） |
| `@opencode/core` | 2.0.3 | **2.0 新增**：宿主核心运行时（"Core runtime services"，含 drizzle db/47 migrations） |
| `@opencode/client` | 2.0.3 | HTTP API 客户端（promise/effect 双轨 + generated） |
| `@opencode/sdk` | 2.0.3 | SDK（`createOpencode()` / `createOpencodeClient()`，structured output） |
| `@opencode/ai` | 2.0.3 | AI provider 适配层 |
| `@opencode/protocol` | 2.0.3 | 协议定义 |
| `@opencode/server` | 2.0.3 | server 包 |
| `@opencode/theme` / `@opencode/util` | 2.0.3 | 主题 / 工具库（plugin peerDeps，optional） |

**V1 线（旧 scope `@opencode-ai`，并行维护，未 deprecated）**：`@opencode-ai/plugin` latest=1.18.30（v1）、beta 停在 0.0.0-beta-19271（无 2.x 版本）；v1 stable `opencode-ai@1.18.x` 继续发布。**V2 开发必须迁新 scope**。

## 3. 版本模型（npm dist-tags，2026-09-14，以 `@opencode/cli` 为准）

| tag | 版本 | 说明 |
|---|---|---|
| `latest` | 2.0.3 | **v2 GA stable**（本库基线） |
| `beta` | 0.0.0-beta-19507 | v2 beta 通道末版（已停更；与 2.0.0 类型面全等） |
| `dev` | 0.0.0-dev-19567 | 开发构建 |
| `reserved` | 0.0.0-reserved | 占位 |

（旧 scope `@opencode-ai/*` 的 dist-tags 属 v1 线：`latest` 1.18.30、`beta` 0.0.0-beta-19271、`next` 17444；另有过时 `snapshot-*` 分支快照族，不作兼容目标。）

GA 时间线：v2.0.0 tag 2026-09-11；npm 2.0.0（09-12 00:15）→ 2.0.1（09-12 05:00）→ 2.0.2（09-12 07:55）→ 2.0.3（09-12 23:46）UTC。**v2.0.x 无官方 release notes**（GitHub 仅 bare tags），commit 级变更见 tags compare；类型面差异见 `versions/changelog.md`。`beta-<build number>` 单调递增语义保留在 dev 线；build 号 ≠ 宿主功能等价承诺，跨版本兼容必须逐对 diff。

## 4. 宿主能力面（CLI 子命令，实测 2.0.3）

`opencode [--standalone|--server <url>] [--auto] [-c] [-s <id>] [--prompt <text>] [directory]`（`opencode2` 为等价别名）

| 子命令 | 用途 |
|---|---|
| `run` | 非交互执行（消息驱动） |
| `serve` | 启动 v2 API + Web server（`--port/--hostname/--cors/--service/--stdio`） |
| `service` | 管理后台 server（默认后台服务模式） |
| `api` | 对运行中 server 发请求（`opencode api get <path>`，自动携带 server password） |
| `auth` | provider 凭据管理 |
| `mcp` | MCP server 管理（auth/list/logout/debug） |
| `plugin` | 插件管理（**add**/list/check/update/remove；`add` 安装并写入全局配置，实测 help） |
| `models` | 列出可用模型 |
| `acp` | Agent Client Protocol server |
| `console` | OpenCode Console 访问 |
| `export` / `import` | 会话数据 JSON 导出/导入 |
| `mini` | 极简交互界面 |
| `stats` | 可分享使用统计 |
| `pair` | server 配对信息 |
| `debug` | 调试工具（含 `debug/location`） |
| `upgrade` / `uninstall` | 自更新 / 卸载 |

顶层 flags 含 `--standalone`（私有 server）、`--server <url>`（连接远端）、`--auto`（自动批准非 deny 权限）、`--continue`/`--session`。serve 启动时打印随机 **server password**（2.0.3 实测；HTTP 客户端经宿主 `api` 子命令自动携带）。

安装渠道（官方 V2 口径）：`npm install -g @opencode/cli`（trusted postinstall 选平台二进制）、`curl -fsSL https://opencode.ai/v2/install | bash`、Docker `ghcr.io/anomalyco/opencode`；brew/AUR/Windows 包管理器/standalone 二进制不支持。

## 5. HTTP API 面（宿主路由）

agent / command / skill / config / credential / debug / event(SSE) / experimental(integration-wellknown、migration-v1、persistent-pty、session) / form / fs(find/list/read) / generate / health / integration / location / mcp(+resource) / model(+default) / permission(request/saved) / plugin / project(current) / provider / pty / reference / rpc / server / session(+active/import/stats) / shell / users / vcs(base/branches/diff/status) / websearch(provider) / workspace / worktree。

（beta-18721 二进制实测 60+ 端点；2.0.3 实测 `/api/{agent,skill,plugin,mcp,config}` 核心端点行为一致。v1 server 文档口径的 `/global/*`、`/project/*`、`/tui/*` 端点组未在 v2 实测路由中出现——v2 API 已重构（甄别结论）。）

## 6. v1 → v2 核心差异（对插件开发者）

| 维度 | v1 (stable 1.x) | v2 (2.0 GA) |
|---|---|---|
| 插件模型 | hooks 对象导出、`project/directory/worktree/client/$` Context | `Plugin.define({id, setup})` + 20+ 域 Context（V1 插件代码不运行于 v2；官方迁移指南 `/v2/docs/build/plugins/migrate-v1`） |
| 自定义工具 | `.opencode/tools/*.ts` 文件 + `tool()` helper | 同目录机制 + `ToolEditor`（list/get/add/update/remove）双轨 |
| 工具目录 | 全量进会话 | `codemode` 分流（会话直接 vs Code Mode catalog） |
| agent/skill/command | 配置文件 | 配置文件 + 插件 Editor 双轨（agent 无 `add`，`update` 对不存在 id 为 upsert） |
| 通信 | — | RPC 域 + `/api/rpc/*` |
| CLI | `opencode`（`@opencode-ai/cli`） | `opencode`（主名）+ `opencode2` 别名（`@opencode/cli`） |
| 内置能力 | 宿主内建 | `opencode.*` builtin 插件化（~90 个，2.0.3 实测） |

（v1 侧描述以官方文档为准，版本归属混合处已在各分篇标注。）

## 7. 相关文档

`02-plugin-lifecycle.md` 起为 API 分篇；`08-host-capabilities.md` 展开 TUI/API server/ACP；`versions/changelog.md` 记录版本差异（beta-18230 → 2.0.3 全链路）。
