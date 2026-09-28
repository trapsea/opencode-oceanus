# opencode2 参考库

OpenCode v2 宿主的能力 / API / 工具 / hook / 配置参考文档，服务于 `opencode-oceanus` 插件开发与版本适配。

> **版本基线**：`@opencode/plugin@2.0.10` + `@opencode/schema@2.0.10`（本项目锁定）；宿主已核实至 `opencode v2.0.18`（2026-09-28 隔离 serve + 会话内实测；2.0.7、2.0.14、2.0.15、2.0.18 为隔离 serve 实测）。2.0.3 → 2.0.5、2.0.5 → 2.0.7、2.0.7 → 2.0.10、2.0.10 → 2.0.12、2.0.12 → 2.0.14、2.0.14 → 2.0.15 与 2.0.15 → 2.0.18 的完整类型差异见 [versions/changelog.md](versions/changelog.md)。
> **本项目锁定版本**：`@opencode/{plugin,schema}@2.0.10`（`package.json` 精确锁定）。2.0.5 要求 `Skill.Info.path`，本插件已由 `location` 迁移；此前旧字段会导致插件在 `skill.transform` 阶段被整体禁用。
> **包族迁移**：2.0 GA 起 V2 线全部迁往 `@opencode/*` 新 scope（cli/plugin/schema/core/client/sdk/ai/protocol/server/theme/util）。旧 `@opencode-ai/*` 为 v1 线并行维护。CLI bin 双名 `opencode`（主）+ `opencode2`（别名）。GitHub 迁至 `anomalyco/opencode`，V2 文档站 `opencode.ai/v2/docs`。
> **2.0.15 → 2.0.18 关键差异**：零适配项。plugin 2.0.15→2.0.16 与 2.0.17→2.0.18 dist 逐字节全等，仅 2.0.16→2.0.17 新增 TUI `ui.model` 域（#51101，prompt 已选模型/variant 读写，本插件 TUI 未消费）；schema 仅 2.0.17 `Shell.Info` 新增 optional `signal`（#51145，shell 被信号终止记录的信号名，本插件不消费）；client 2.0.16 增强 `ClientError` detail、2.0.17 新增 server 一次性配对 `pair`/`connect`（#50970，本插件仅类型消费 `SessionStatus`，未命中）；2.0.18 无任何类型面变化。2.0.17 起 plugin peer `@opentui/*` 由 `>=0.5.10` 提升至 `>=0.5.12`。当前 2.0.10 锁定无需升级即可运行于 2.0.18 宿主（隔离 serve 实测插件 active、14 agent、12 skill，详见 changelog）。
> **2.0.14 → 2.0.15 关键差异**：零适配项。plugin 2.0.14 → 2.0.15 dist 逐字节全等（继 2.0.12→2.0.14 之后第二个连续零变化区间，仅 package.json 版本号与 `@opencode/*` 依赖/peer 跟随 bump）；schema 变化为新增 durable 事件 `session.metadata.updated`（#50025，session metadata 由「创建时固化」升级为「运行时可更新」）与 `Project.Time` 新增 required `active: Int`（#50790，项目按近期活动排序）——均非本插件消费面。client 类型面同源同步、`SessionStatus` 未变、`pty-handoff-*` chunk 重组为 `service-*`。当前 2.0.10 锁定无需升级即可运行于 2.0.15 宿主（隔离 serve 实测插件 active、14 agent、12 skill，详见 changelog）。
> **2.0.12 → 2.0.14 关键差异**：零适配项。plugin 2.0.12 → 2.0.14 dist 三版逐字节全等（GA 以来首个 plugin 零变化区间）；schema/client 唯一类型变化为 2.0.13 的 `Connection.CredentialInfo` 新增 required `method: "key" | "oauth"`（#50267 浏览器 OAuth 登录），本插件不消费 Connection/Credential 面。core 层新增 Console-managed policies 叠加层（#49729，不改变本地 evaluate 语义）、subagent prompt cache 亲和共享（#50495，派发性能利好）。当前 2.0.10 锁定无需升级即可运行于 2.0.14 宿主（隔离 serve 实测插件 active，详见 changelog）。
> **2.0.7 → 2.0.10 关键差异**：plugin 的 `ToolEditor.list()` 为纯新增；provider/model/agent 的请求覆盖收敛进 `settings`，`compaction` 改为 `{ type: "summary" | "native" }`，顶层 `compaction`/`transport` 被移除。Oceanus 未消费这些 provider/model 字段，升级到 2.0.10 后类型检查通过；真实 2.0.10 Host 的加载与 TUI 验证仍待执行（详见 changelog）。
> **2.0.3 → 2.0.5 关键差异**：`Skill.Info.location` 重命名为必填 `path`；`catalog` 拆为 `provider`/`model`，`Session.rename` 改为 `update`，`Vcs.branches` 改为 `Vcs.branch.list`，provider/model 的 `websocket` 改为 `transport`。详见 [versions/changelog.md](versions/changelog.md)。

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
| [versions/changelog.md](versions/changelog.md) | 版本变动台账（beta-18230 → 2.0.18 全链路）+ 追加模板 |

## 使用方式

- **开发插件功能时**：按域查 03→07 分篇；工具/hook 相关先读 05。
- **升级依赖版本时**：先读 `versions/changelog.md` 对应条目评估 breaking，再按分篇核对签名。
- **甄别原则**：所有事实标注证据源——tarball 类型声明 > 宿主实测 > 官方文档（V1/V2 文档站分轨：`/docs` 为 v1、`/v2/docs` 为 v2，仅参考）。冲突时以类型定义与实测为准。
- **追加新版本记录**：npm 拉取两版 tarball 解压 diff `.d.ts`（跨 scope 对比需先把旧包 `@opencode-ai/` import 归一化为 `@opencode/` 再 diff，剥离纯包名迁移噪音），按 changelog 模板（版本号/日期/证据源类型）追加条目。

## 维护约定

1. 本目录只新增/修订文档，不改仓库代码；与 `docs/opencode-v2-compatibility.md`（插件侧兼容记录）互补：本库记录宿主事实，docs/ 记录本项目适配状态。
2. 每份文档头部必须保留版本基线与证据源声明。
3. 宿主行为实测结论需注明宿主版本与获取方式（CLI 命令 / 路由 / 日志）。
