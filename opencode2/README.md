# opencode2 参考库

OpenCode v2 宿主的能力 / API / 工具 / hook / 配置参考文档，服务于 `opencode-oceanus` 插件开发与版本适配。

> **版本基线**：`@opencode/plugin@2.0.3` + `@opencode/schema@2.0.3`（GA 正式版，2026-09-14 核实，npm `latest`；beta-19271 → 2.0.3 差异见 [versions/changelog.md](versions/changelog.md)——含 session hooks 重构、会话级权限、包族迁移 `@opencode-ai/*` → `@opencode/*`；宿主 `@opencode/cli@2.0.3` 隔离实测通过）
> **本项目锁定版本**：`@opencode-ai/plugin@0.0.0-beta-18743`（`package.json`，旧 scope 精确锁定）；**beta-18743 API 面在 2.0.3 宿主上实测零回归**（2026-09-14：插件 active、14 agents/12 skills 全量注册、CBM MCP server connected）
> **包族迁移**：2.0 GA 起 V2 线全部迁往 `@opencode/*` 新 scope（cli/plugin/schema/core/client/sdk/ai/protocol/server/theme/util 均 2.0.3）；旧 `@opencode-ai/*` 为 v1 线并行维护（latest 1.18.30，未 deprecated）。CLI bin 双名 `opencode`（主）+ `opencode2`（别名）。GitHub 迁至 `anomalyco/opencode`，V2 文档站 `opencode.ai/v2/docs`。
> **历史差异摘要**：beta-19242：`*Draft`→`*Editor` 重命名、`Plugin.vcs` 移除、`worktree` 域与 TUI `session.panel`；beta-19271：`compaction` 配置、`providerContext` 会话溯源、`DialogSelectOption.footer`；2.0 GA 线（beta-19507 落地）：session hooks `options` 合并 + `compaction`/`generate`/`title` hook、会话级 `permissions` + `session.permissions.updated` 事件、`PermissionDomain.rules`、provider/model `websocket`；2.0.2：`Preferences` + `config/shell`；2.0.3：compaction `cost`/`tokens` 可观测（详见 [versions/changelog.md](versions/changelog.md)）。

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-overview.md](01-overview.md) | 架构总览、npm 包家族、版本模型（dist-tags）、v1/v2 差异、CLI 与 HTTP API 面 |
| [02-plugin-lifecycle.md](02-plugin-lifecycle.md) | 三种插件入口（promise/effect/tui）、Plugin.define、setup/Cleanup、加载规则、Plugin.Info |
| [03-plugin-context.md](03-plugin-context.md) | server Context 20+ 域速查表、注册原语（Transform/Hooks/ModelHooks） |
| [04-registration-domains.md](04-registration-domains.md) | agent / skill / command / catalog 注册域与 Draft API |
| [05-tools-and-hooks.md](05-tools-and-hooks.md) | Tool 域、ToolDraft、codemode 机制、全部 hook（tool/session/permission/shell/aisdk） |
| [06-session-and-events.md](06-session-and-events.md) | session 域与 SessionHooks、generate、事件流、RPC 域 |
| [07-infra-domains.md](07-infra-domains.md) | mcp / permission / storage / vcs / shell / websearch / reference / integration / aisdk / experimental |
| [08-host-capabilities.md](08-host-capabilities.md) | TUI 插件上下文（Data/Keymap/Storage/UI/Slot 系统）、API server、ACP、worktree、Form/PTY |
| [09-config-schema.md](09-config-schema.md) | opencode.json 配置全景（config 家族 schema 字段级） |
| [10-builtin-inventory.md](10-builtin-inventory.md) | 宿主内置工具 / agent / 命令 / skill 清单（实测证据分级；2.0 起含 builtin 插件化清单） |
| [versions/changelog.md](versions/changelog.md) | 版本变动台账（beta-18230 → 2.0.3 GA 全链路）+ 追加模板 |

## 使用方式

- **开发插件功能时**：按域查 03→07 分篇；工具/hook 相关先读 05。
- **升级依赖版本时**：先读 `versions/changelog.md` 对应条目评估 breaking，再按分篇核对签名。
- **甄别原则**：所有事实标注证据源——tarball 类型声明 > 宿主实测 > 官方文档（V1/V2 文档站分轨：`/docs` 为 v1、`/v2/docs` 为 v2，仅参考）。冲突时以类型定义与实测为准。
- **追加新版本记录**：npm 拉取两版 tarball 解压 diff `.d.ts`（跨 scope 对比需先把旧包 `@opencode-ai/` import 归一化为 `@opencode/` 再 diff，剥离纯包名迁移噪音），按 changelog 模板（版本号/日期/证据源类型）追加条目。

## 维护约定

1. 本目录只新增/修订文档，不改仓库代码；与 `docs/opencode-v2-compatibility.md`（插件侧兼容记录）互补：本库记录宿主事实，docs/ 记录本项目适配状态。
2. 每份文档头部必须保留版本基线与证据源声明。
3. 宿主行为实测结论需注明宿主版本与获取方式（CLI 命令 / 路由 / 日志）。
