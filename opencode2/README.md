# opencode2 参考库

OpenCode v2 beta 宿主的能力 / API / 工具 / hook / 配置参考文档，服务于 `opencode-oceanus` 插件开发与版本适配。

> **版本基线**：`0.0.0-beta-18743`（2026-09-01 核实；`@opencode-ai/{plugin,schema}@0.0.0-beta-18743` 与 18721 的 `dist` 全量 diff 为零；宿主实测证据仍以 `opencode2 v0.0.0-beta-18721` 标注）
> **本项目锁定版本**：`beta-18743`（`package.json`）；与旧锁定 18230 的差异见 [versions/changelog.md](versions/changelog.md)
> **最新 npm beta**：`0.0.0-beta-19242`（2026-09-07 核实，`beta` dist-tag）；18743 → 19242 差异见 [versions/changelog.md](versions/changelog.md)——主要为 `*Draft`→`*Editor` 重命名、`Plugin.vcs` 移除、新增 `worktree` 域与 TUI `session.panel` 插槽，本文其余章节仍以 18743 类型为基线，差异以各章"beta-19242 变化"标注为准。

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
| [10-builtin-inventory.md](10-builtin-inventory.md) | 宿主内置工具 / agent / 命令 / skill 清单（实测证据分级） |
| [versions/changelog.md](versions/changelog.md) | beta 版本变动台账（含 beta-18230 → beta-18721、beta-18721 → beta-18743）+ 追加模板 |

## 使用方式

- **开发插件功能时**：按域查 03→07 分篇；工具/hook 相关先读 05。
- **升级依赖版本时**：先读 `versions/changelog.md` 对应条目评估 breaking，再按分篇核对签名。
- **甄别原则**：所有事实标注证据源——tarball 类型声明 > 宿主实测 > 官方文档（文档站 v1/v2 混杂，仅参考）。冲突时以类型定义与实测为准。
- **追加新版本记录**：npm 拉取两版 tarball 解压 diff `.d.ts`，按 changelog 模板（版本号/日期/证据源类型）追加条目。

## 维护约定

1. 本目录只新增/修订文档，不改仓库代码；与 `docs/opencode-v2-compatibility.md`（插件侧兼容记录）互补：本库记录宿主事实，docs/ 记录本项目适配状态。
2. 每份文档头部必须保留版本基线与证据源声明。
3. 宿主行为实测结论需注明宿主版本与获取方式（CLI 命令 / 路由 / 日志）。
