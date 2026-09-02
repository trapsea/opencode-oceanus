# OpenCode v2 架构总览

> 版本基线：`0.0.0-beta-18721`（2026-08-31 核实）
> 证据源：npm registry dist-tags、tarball 类型声明、宿主 CLI 实测、官方文档站结构。

## 1. 产品形态

OpenCode 是开源 AI coding agent。v2 beta（CLI 名 `opencode2`）延续三形态：终端 TUI、桌面/IDE 扩展、headless server + Web。v2 核心变化是**插件化的宿主架构**：agent/skill/command/tool/MCP/权限/模型目录全部开放插件扩展点。

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

## 2. npm 包家族（@opencode-ai scope）

| 包 | beta 版本 | 角色 |
|---|---|---|
| `@opencode-ai/plugin` | 0.0.0-beta-18721 | 插件开发 SDK（promise/effect/tui 三入口） |
| `@opencode-ai/schema` | 0.0.0-beta-18721 | 全量领域 schema（agent/session/tool/config/...） |
| `@opencode-ai/client` | 0.0.0-beta-18721 | HTTP API 客户端（promise/effect 双轨 + generated） |
| `@opencode-ai/ai` | 0.0.0-beta-18721 | AI provider 适配层 |
| `@opencode-ai/protocol` | 0.0.0-beta-18721 | 协议定义 |
| `@opencode-ai/sdk` | latest 1.18.25 / beta 0.0.0-beta-18721 | SDK（`createOpencode()` / `createOpencodeClient()`，structured output） |
| `@opencode-ai/server` | 0.0.0-beta-18721 | server 包 |
| `@opencode-ai/cli` | 0.0.0-beta-18721 | CLI 二进制分发（平台子包 cli-linux-x64 等） |

v1 stable（`opencode-ai@1.18.25`）与 v2 beta 并行发布；v2 包名统一 `0.0.0-beta-<build>`。

## 3. 版本模型（npm dist-tags，2026-08-31）

| tag | 版本 | 说明 |
|---|---|---|
| `latest` | 1.18.25 | v1 stable |
| `beta` | 0.0.0-beta-18721 | v2 beta（本库基线） |
| `dev` | 0.0.0-dev-18732 | 开发构建 |
| `next` | 0.0.0-next-17444 | 预发布 |
| `snapshot-*` / `v0` / `v1` / `opentui` / `windows` 等 | 各异 | 分支/特性快照（数百个，不作为兼容目标） |

版本号语义：`beta-<build number>` 单调递增；build 号 ≠ 宿主功能等价承诺，跨版本兼容必须逐对 diff（见 `versions/changelog.md`）。

## 4. 宿主能力面（CLI 子命令，实测 beta-18721）

`opencode2 [--standalone|--server <url>] [--auto] [-c] [-s <id>] [--prompt <text>] [directory]`

| 子命令 | 用途 |
|---|---|
| `run` | 非交互执行（消息驱动） |
| `serve` | 启动 v2 API + Web server |
| `service` | 管理后台 server（默认后台服务模式） |
| `api` | 对运行中 server 发请求（`opencode2 api get <path>`） |
| `auth` | provider 凭据管理 |
| `mcp` | MCP server 管理（auth/list/logout/debug） |
| `plugin` | 插件管理 |
| `models` | 列出可用模型 |
| `acp` | Agent Client Protocol server |
| `console` | OpenCode Console 访问 |
| `export` / `import` | 会话数据 JSON 导出/导入 |
| `mini` | 极简交互界面 |
| `stats` | 可分享使用统计 |
| `pair` | server 配对信息 |
| `debug` | 调试工具（含 `debug/location`） |

顶层 flags 含 `--standalone`（私有 server）、`--server <url>`（连接远端）、`--auto`（自动批准非 deny 权限）、`--continue`/`--session`。

## 5. HTTP API 面（宿主二进制路由实测，60+ 端点）

agent / command / skill / config / credential / debug / event(SSE) / experimental(integration-wellknown、migration-v1、persistent-pty、session) / form / fs(find/list/read) / generate / health / integration / location / mcp(+resource) / model(+default) / permission(request/saved) / plugin / project(current) / provider / pty / reference / rpc / server / session(+active/import/stats) / shell / users / vcs(base/branches/diff/status) / websearch(provider) / workspace / worktree。

v1 server 文档口径的 `/global/*`、`/project/*`、`/tui/*` 端点组未在 v2 实测路由中出现——v2 API 已重构（甄别结论）。

## 6. v1 → v2 核心差异（对插件开发者）

| 维度 | v1 (stable 1.x) | v2 (beta) |
|---|---|---|
| 插件模型 | hooks 对象导出、`project/directory/worktree/client/$` Context | `Plugin.define({id, vcs?, setup})` + 20+ 域 Context |
| 自定义工具 | `.opencode/tools/*.ts` 文件 + `tool()` helper | 同目录机制 + `ToolDraft`（list/get/add/update/remove）双轨 |
| 工具目录 | 全量进会话 | `codemode` 分流（会话直接 vs Code Mode catalog） |
| agent/skill/command | 配置文件 | 配置文件 + 插件 Draft 双轨 |
| 通信 | — | RPC 域 + `/api/rpc/*` |
| CLI | `opencode` | `opencode2` |

（v1 侧描述以官方文档为准，版本归属混合处已在各分篇标注。）

## 7. 相关文档

`02-plugin-lifecycle.md` 起为 API 分篇；`08-host-capabilities.md` 展开 TUI/API server/ACP；`versions/changelog.md` 记录版本差异。
