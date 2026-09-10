# OpenCode v2 beta 兼容性记录

## 适用范围

本文记录 `opencode-oceanus` 当前依赖和实际代码针对的 OpenCode v2 beta API。它不是对所有 OpenCode v2 beta 版本的兼容承诺，也不从 `beta-18743` 推断宿主应用版本号。

## 当前版本基线

| 项目 | 当前值 | 证据 |
|---|---|---|
| 插件包 | `opencode-oceanus@0.52.1` | `package.json:2-4` |
| OpenCode 插件 API | `@opencode-ai/plugin@0.0.0-beta-18743`，精确锁定 | `package.json:43-45`、`bun.lock` |
| OpenCode schema | `@opencode-ai/schema@0.0.0-beta-18743`，精确锁定 | `package.json:44-45`、`bun.lock` |
| 实测宿主 | `@opencode/cli@0.0.0-beta-19296`（CLI 宿主已迁新包名；`@opencode-ai/plugin` 无 19296 版本，npm E404） | 2026-09-09 宿主服务日志：插件加载、agents/skills/tools 注册、`ctx.mcp.transform` 注册 CBM server 均正常；npm beta tag `@opencode-ai/{plugin,schema}@0.0.0-beta-19271` 与 19242 差异全部为 optional 新增（详见 [`../opencode2/versions/changelog.md`](../opencode2/versions/changelog.md)），锁定 18743 无回归 |
| 可选 peer | `@opentui/solid >=0.5.8`、`solid-js >=1.9.0`、`zod ^4.0.0`；前两者 optional | `package.json:47-59` |
| 构建目标 | Bun build，Node/ESM；OpenCode plugin、schema、OpenTUI 和 Solid 外部化 | `package.json:25` |
| 入口 | CLI `dist/index.js`，TUI `dist/tui.js` | `package.json:6-16` |

锁定版本不是宿主版本号映射。升级时应同时检查 `package.json`、`bun.lock`、安装后的类型声明和真实 OpenCode Host，而不是只替换 beta 编号。

## 已核实的 v2 API 约束

| API/行为 | 当前代码依赖或防御 | 证据与状态 |
|---|---|---|
| `Plugin.define({ id, setup })` | CLI 和 TUI 使用 v2 插件定义；`Plugin.tui` 字段已于 beta-18721 移除，CLI 不再声明，TUI 入口经 `exports["./tui"]` 结构性声明 | `src/index.ts`、`src/tui.tsx:681-686`；类型/mock 已验证 |
| `ctx.tool.transform` + `Tool.Options.codemode` | 9 个核心工具在注册包装层注入 `codemode: false` 进入会话直接工具目录；CBM 工具保持缺省 Code Mode。宿主 registry 实证（beta-18230 二进制）：`codemode !== false`（含缺省）只进 Code Mode catalog，仅 `execute` JS 运行时内 `tools.<name>` 可调；subagent 不走该路径（实测回退宿主原生 `edit`）。宿主原生 write/webfetch/websearch 均显式 `codemode: false` | `src/tools/index.ts`（DIRECT_TOOL_NAMES 注入）、`docs/tooling-and-runtime.md`；运行中宿主二进制反编译 + fixer 工具目录实测已验证 |
| `ctx.agent.transform` + `ctx.agent.reload` | 通过 transform 注册/更新 agent，并在 preset 切换后 reload | `src/index.ts:62-122`；类型/mock 已验证 |
| `Context.location` 已正式声明（beta-18721+） | 目录解析仍统一经 `resolvePluginDirectory`：`ctx.location.directory` → 旧 `ctx.directory` → `process.cwd()`；探测链降级为运行时防御，不因类型声明移除 | `src/runtime/host-adapter.ts`、`src/runtime/types.ts`、`src/index.ts:162-166`；宿主 beta-18743 复测 |
| `SkillDraft` 使用 `list/add/update/remove` | 注册 skill 只调用官方 `draft.add()`，不依赖未公开的 `source()`；skill location 使用绝对路径 | `src/index.ts:219-238`；类型/mock 已验证 |
| TUI `SlotClaim.render` 是 Solid 组件一次性挂载（beta-18721+ 宿主反编译） | 宿主 SlotHost 以 `createComponent(claim.render, props)` 挂载，仅随 claim 集合/slot input（sidebar 仅 `{sessionID}`）变化重执行；`renderer.requestRender()` 只调度重绘帧、不重跑组件函数。面板刷新改为 tick 信号 + keyed Show 整树重建：宿主插件运行时把 `solid-js`/`@opentui/solid` 别名到宿主共享实例，插件信号参与宿主 reactive graph；solid-js 不可用时 fail-open 回退 requestRender 模式。另注意裸 `solid-js` 在 node 条件下解析为无响应式的 server 构建，真实响应式在 `solid-js/dist/solid.js`（`@opentui/solid` 同款路径），运行时按"子路径优先、裸名兜底"探测 | `src/tui.tsx`（`loadPanelReactivity`/`PanelState` 注释）、`src/tui.test.ts`；宿主 beta-18743 二进制反编译（SlotHost `Zl(a.render, Use(s))`、模块别名表 `"solid-js":QJ`）+ solid 1.9.15 源码（keyed Show 要求 `child.length > 0`）；真实 TUI 端到端未复测 |
| `SessionDomain` 未暴露 `active` | 任务运行时探测宿主能力，并在缺失时降级到可用 session/registry 信息 | `src/runtime/types.ts:29-53`、`docs/tooling-and-runtime.md:167-168`；真实 Host 未完整验证 |
| agent model 是单个 `ModelRef` | 配置数组只取首项，不能假设 Agent.Info 接受模型数组 | `src/agents/index.ts:63-87`；源码已验证 |
| `plugins` 与 TUI 配置 | CLI 和 TUI 是两个入口；配置字段/加载差异应以当前宿主文档和真实 Host 复测 | `README.md:124-147`；这是 README 声明，仓库代码未独立验证 |
| `plugins` 本地路径必须是含 index 入口的目录（宿主 `0.0.0-beta-18721` 实测） | 配置条目指向目录时宿主在目录内解析 `index` 入口文件（`dist/` 目录含 `index.js` 可正常加载）；指向单文件报 WARN `configured plugin path must be a directory`，指向无 index 文件的目录报 WARN `configured plugin directory has no index entrypoint`，两种情况插件均被整体跳过、所有 agent 不注册 | 2026-08-31 实测：`~/.local/share/opencode/log/opencode.log` 服务日志 + `opencode2 api get "/api/agent?location[directory]=…"` 验证三种写法仅目录形式注册出 oceanus/sisyphus 全量 agent；README 安装示例已同步为 `dist` 目录写法 |
| `ctx.mcp.transform` + `ctx.mcp.reload`（`MCPDomain = Pick<McpApi, "list">` 形态） | CBM server 注册只调用 `transform`（`draft.get/set/remove`）与 `reload`，两者在 beta-18721→19271 类型面均未变化（18743/19242/19271 三版 `mcp.d.ts` 对比：18743→19242 变化不影响本用法，19242→19271 零差异） | `src/cbm/mcp.ts:150-252`；宿主 `@opencode/cli@19296` 实测：日志出现 `server=codebase-memory-mcp` 连接尝试即证明 transform 注册生效（连接失败为 CBM daemon 生命周期问题，与注册契约无关，2026-09-09） |
| permission 对象形式（资源级规则）经 `toPermissions` 转换 | `prometheus` 主 agent 依赖对象形式权限：`task`/`subagent` 为 `{'*': 'deny', 'task.explorer': 'allow', …}` 白名单（通配先声明、具体后声明，依赖宿主 findLast 后声明优先，与 `shell` 模式表同构）；`skill: 'deny'`、`question: 'allow'`。**真实宿主已验证（beta-19296，2026-09-10，隔离 serve 实例 + 工作区 dist）**：prometheus 以 `mode: primary` 注册、temperature 0.3、system prompt 注入正确；宿主接受资源级规则并按"基线在前、插件规则在后"合并（83 条规则，task/subagent 白名单与全部 deny 键形态正确）；宿主内置 build/plan 被移除。**仍待真实会话验证**：① 宿主运行时对 `task.explorer` 前缀式 resource 的评估语义（若按裸名匹配则 fail-closed 全拒，回退口径为 task/subagent 双键整体 `allow` + prompt 白名单纪律）；② `question`（插件自定义工具）在受限 primary 会话的阻塞行为 | `src/config/constants.ts`（`PROMETHEUS_PERMISSION`）、`src/index.ts:23-48`（`toPermissions` 资源级转换）、`src/agents/prometheus.ts`；隔离实例 API 验证记录见本行（验证用临时 serve 已清理，未触碰用户全局配置与共享服务） |

## 插件侧版本与运行时边界

- setup 阶段不从 `ctx.session` 读取当前会话 ID：该对象是 `SessionDomain` API 域，不是会话实例。任务索引根使用插件实例目录；真实父会话 ID 只在工具/事件上下文中使用。参见 `src/index.ts:168-184` 与 `src/runtime/types.ts:166-175`。
- `taskReuse` 的代码默认值为启用；可用配置显式关闭。不要沿用旧文档中“默认关闭”的表述：`src/config/utils.ts:243-247`、`src/config/schema.ts:188`。
- `session.active`、`interrupt` 等真实 Host 能力在普通 `bun test` 中没有真实宿主；相关 smoke 会 skip 或使用 mock，不等价于真实 Host 通过。参见 `README.md:245`、`src/smoke/host-smoke.test.ts`。
- 图片 `prompt` / `retry` hook 属于运行时能力：beta-18721+ 类型联合已正式覆盖 `prompt`/`retry`，注册仍保留运行时能力探测并 fail-open（类型声明不等于运行时保证）；`retry` 不可用不得影响 `prompt`。参见 `src/hooks/index.ts:253-293` 与 `src/hooks/image-*.ts`。
- CBM 二进制版本与 npm 插件版本解耦；当前默认 CBM 版本为 `0.10.8`，下载必须经过内置 manifest 的 SHA-256 校验。参见 [`codebase-memory-mcp.md`](codebase-memory-mcp.md)。
- AST 工具依赖真实 ast-grep CLI；OpenCode Host 不会替插件安装该 CLI。参见 [`tooling-and-runtime.md`](tooling-and-runtime.md)。

## 验证分层

### 已验证

- package manifest、lockfile 与当前安装依赖的版本声明一致（以当前工作区实际文件为证据）。
- TypeScript 类型、mock context 注册契约、工具/Hook/skill 注册测试可在 `bun test` 中验证。
- 构建、声明文件与 dist skill 一致性可用 `bun run check` 和 `bun run check:dist` 验证。

### 未验证或需真实宿主复测

- 真实 Host 中 `session.active`、`interrupt`、skill draft 形态、CLI/TUI 加载字段的最终行为。
- 真实 Host 是否接受图片 `prompt` / `retry` hook 名称，以及 `/builtin/...` skill location 是否要求可直接访问的物理文件。
- `beta-18743` 之后版本的完整向后兼容性（`beta-19271` 类型面已核对零 breaking；宿主 `@opencode/cli@19296` 已实测插件加载与注册链路正常，2026-09-09，见「当前版本基线」）。

## 升级检查清单

1. 读取目标 OpenCode beta 的官方 API/类型声明，确认 `Plugin`, `Context`, `Agent.Info`, `SkillDraft`, `SessionDomain` 的变化。
2. 更新 `package.json` 与 `bun.lock`，确认 plugin 与 schema 版本配套，并记录确切版本，不写未经证实的宿主版本号。
3. 检查 `src/index.ts`、`src/tui.tsx`、`src/runtime/`、`src/agents/` 的兼容性探测与 fallback。
4. 运行 `bun run typecheck`、`bun test`、`bun run build`、`bun run check:dist`。
5. 在真实 OpenCode Host 安装构建产物，分别验证 CLI agent/skill/tool/hook、TUI sidebar、session 能力和 task reuse；将 skip、degraded、失败与通过分别记录。
6. 若 API 变化影响公共接线，先更新本文件和 [`AGENTS.md`](../AGENTS.md)，再提交实现变更；不要把 README 的旧表述当作升级依据。
