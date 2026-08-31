# OpenCode v2 beta 兼容性记录

## 适用范围

本文记录 `opencode-oceanus` 当前依赖和实际代码针对的 OpenCode v2 beta API。它不是对所有 OpenCode v2 beta 版本的兼容承诺，也不从 `beta-18230` 推断宿主应用版本号。

## 当前版本基线

| 项目 | 当前值 | 证据 |
|---|---|---|
| 插件包 | `opencode-oceanus@0.34.0` | `package.json:2-4` |
| OpenCode 插件 API | `@opencode-ai/plugin@0.0.0-beta-18230`，精确锁定 | `package.json:43-45`、`bun.lock` |
| OpenCode schema | `@opencode-ai/schema@0.0.0-beta-18230`，精确锁定 | `package.json:44-45`、`bun.lock` |
| 可选 peer | `@opentui/solid >=0.5.8`、`solid-js >=1.9.0`、`zod ^4.0.0`；前两者 optional | `package.json:47-59` |
| 构建目标 | Bun build，Node/ESM；OpenCode plugin、schema、OpenTUI 和 Solid 外部化 | `package.json:25` |
| 入口 | CLI `dist/index.js`，TUI `dist/tui.js` | `package.json:6-16` |

锁定版本不是宿主版本号映射。升级时应同时检查 `package.json`、`bun.lock`、安装后的类型声明和真实 OpenCode Host，而不是只替换 beta 编号。

## 已核实的 v2 API 约束

| API/行为 | 当前代码依赖或防御 | 证据与状态 |
|---|---|---|
| `Plugin.define({ id, setup })` | CLI 和 TUI 使用 v2 插件定义；CLI 还声明 `tui: true` | `src/index.ts:511-517`、`src/tui.tsx:681-686`；类型/mock 已验证 |
| `ctx.tool.transform` + `Tool.Options.codemode` | 9 个核心工具在注册包装层注入 `codemode: false` 进入会话直接工具目录；CBM 工具保持缺省 Code Mode。宿主 registry 实证（beta-18230 二进制）：`codemode !== false`（含缺省）只进 Code Mode catalog，仅 `execute` JS 运行时内 `tools.<name>` 可调；subagent 不走该路径（实测回退宿主原生 `edit`）。宿主原生 write/webfetch/websearch 均显式 `codemode: false` | `src/tools/index.ts`（DIRECT_TOOL_NAMES 注入）、`docs/tooling-and-runtime.md`；运行中宿主二进制反编译 + fixer 工具目录实测已验证 |
| `ctx.agent.transform` + `ctx.agent.reload` | 通过 transform 注册/更新 agent，并在 preset 切换后 reload | `src/index.ts:62-122`；类型/mock 已验证 |
| `Context` 类型未声明项目级目录字段 | 通过集中适配按 `ctx.location.directory` → 旧 `ctx.directory` → `process.cwd()` 解析；运行时字段属于兼容性探测 | `src/runtime/host-adapter.ts`、`src/index.ts:162-166`、`src/runtime/types.ts:145-157`；真实 Host 行为未完整验证 |
| `SkillDraft` 使用 `list/add/update/remove` | 注册 skill 只调用官方 `draft.add()`，不依赖未公开的 `source()`；skill location 使用绝对路径 | `src/index.ts:219-238`；类型/mock 已验证 |
| `SessionDomain` 未暴露 `active` | 任务运行时探测宿主能力，并在缺失时降级到可用 session/registry 信息 | `src/runtime/types.ts:29-53`、`docs/tooling-and-runtime.md:167-168`；真实 Host 未完整验证 |
| agent model 是单个 `ModelRef` | 配置数组只取首项，不能假设 Agent.Info 接受模型数组 | `src/agents/index.ts:63-87`；源码已验证 |
| `plugins` 与 TUI 配置 | CLI 和 TUI 是两个入口；配置字段/加载差异应以当前宿主文档和真实 Host 复测 | `README.md:124-147`；这是 README 声明，仓库代码未独立验证 |

## 插件侧版本与运行时边界

- setup 阶段不从 `ctx.session` 读取当前会话 ID：该对象是 `SessionDomain` API 域，不是会话实例。任务索引根使用插件实例目录；真实父会话 ID 只在工具/事件上下文中使用。参见 `src/index.ts:168-184` 与 `src/runtime/types.ts:166-175`。
- `taskReuse` 的代码默认值为启用；可用配置显式关闭。不要沿用旧文档中“默认关闭”的表述：`src/config/utils.ts:243-247`、`src/config/schema.ts:188`。
- `task_revive` 对已完成子会话再次 `prompt` 是否保留上下文，取决于真实 v2 Host；插件在宿主能力不足或续用失败时返回不确定/降级状态，不伪造成功。参见 `README.md:219-221` 和 `src/runtime/`。
- `session.active`、`interrupt` 等真实 Host 能力在普通 `bun test` 中没有真实宿主；相关 smoke 会 skip 或使用 mock，不等价于真实 Host 通过。参见 `README.md:245`、`src/smoke/host-smoke.test.ts`。
- 图片 `prompt` / `retry` hook 属于运行时能力：当前实际 Host 的图片物化可用，但锁定版本类型的 hook 名联合未覆盖这些名称，因此两者分别进行能力探测并 fail-open；`retry` 不可用不得影响 `prompt`。参见 `src/hooks/index.ts:253-293` 与 `src/hooks/image-*.ts`。
- CBM 二进制版本与 npm 插件版本解耦；当前默认 CBM 版本为 `0.10.8`，下载必须经过内置 manifest 的 SHA-256 校验。参见 [`codebase-memory-mcp.md`](codebase-memory-mcp.md)。
- AST 工具依赖真实 ast-grep CLI；OpenCode Host 不会替插件安装该 CLI。参见 [`tooling-and-runtime.md`](tooling-and-runtime.md)。

## 验证分层

### 已验证

- package manifest、lockfile 与当前安装依赖的版本声明一致（以当前工作区实际文件为证据）。
- TypeScript 类型、mock context 注册契约、工具/Hook/skill 注册测试可在 `bun test` 中验证。
- 构建、声明文件与 dist skill 一致性可用 `bun run check` 和 `bun run check:dist` 验证。

### 未验证或需真实宿主复测

- beta-18230 对当前 OpenCode 应用发行版的精确对应关系。
- 已完成 subagent 子会话的上下文保留和 `task_revive` 全链路。
- 真实 Host 中 `session.active`、`interrupt`、skill draft 形态、CLI/TUI 加载字段的最终行为。
- 真实 Host 是否接受图片 `prompt` / `retry` hook 名称，以及 `/builtin/...` skill location 是否要求可直接访问的物理文件。
- 不同 OpenCode beta 版本的向后兼容性。

## 升级检查清单

1. 读取目标 OpenCode beta 的官方 API/类型声明，确认 `Plugin`, `Context`, `Agent.Info`, `SkillDraft`, `SessionDomain` 的变化。
2. 更新 `package.json` 与 `bun.lock`，确认 plugin 与 schema 版本配套，并记录确切版本，不写未经证实的宿主版本号。
3. 检查 `src/index.ts`、`src/tui.tsx`、`src/runtime/`、`src/agents/` 的兼容性探测与 fallback。
4. 运行 `bun run typecheck`、`bun test`、`bun run build`、`bun run check:dist`。
5. 在真实 OpenCode Host 安装构建产物，分别验证 CLI agent/skill/tool/hook、TUI sidebar、session 能力和 task reuse；将 skip、degraded、失败与通过分别记录。
6. 若 API 变化影响公共接线，先更新本文件和 [`AGENTS.md`](../AGENTS.md)，再提交实现变更；不要把 README 的旧表述当作升级依据。
