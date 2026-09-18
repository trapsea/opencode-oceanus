# OpenCode v2 版本变动记录（changelog）

> 本文件是 opencode2 参考库的版本变动台账。每个条目记录两个相邻（或指定对）版本之间的 API/能力差异，供 `opencode-oceanus` 适配升级时评估影响面。
> 方法论：以 npm plugin/schema tarball 的 `.d.ts` 全量 diff 为权威证据源，宿主 CLI 实测与官方文档为辅助；差异结论按"对本插件的影响"分级标注（breaking / 正式化 / 新增 / 无关）。
> 包名注意：beta-19507 起插件包已迁往新 scope `@opencode/{plugin,schema}`（见 2.0.3 条目）；旧 `@opencode-ai/*` 停在 beta-19271。

## 追加模板

```markdown
## <旧版本> → <新版本>

- 日期：<记录日期 YYYY-MM-DD>
- 证据源类型：<tarball .d.ts diff / 宿主实测 / 官方文档 / GitHub commit 对比>
- 影响分级：<breaking | 正式化 | 新增 | 无关>（逐条标注）

### <差异条目>
<签名级差异 + 对插件的影响与适配动作>
```

## 索引

| 条目 | 状态 |
|---|---|
| beta-18230 → beta-18721 | ✅ 已核实（全量 .d.ts diff，2026-08-31） |
| beta-18721 → beta-18743 | ✅ 已核实（全量 dist diff，2026-09-01） |
| beta-18743 → beta-19242 | ✅ 已核实（全量 dist diff，2026-09-07） |
| beta-18743 → beta-19271 | ✅ 已核实（全量 dist diff 三方分解，2026-09-09；19242→19271 增量详列，18743→19242 部分见下条目） |
| beta-19271 → 2.0.3（GA） | ✅ 已核实（tarball 归一化 diff 三方分解 + 宿主 2.0.3 实测，2026-09-14） |
| 2.0.3 → 2.0.5 | ✅ 已核实（plugin/schema tarball 全量 diff + `@opencode/cli@2.0.5` 真实宿主失败日志，2026-09-17） |
| 更早历史版本 | 未回溯（build 数百个，按需增量补录） |

---

## 2.0.3 → 2.0.5

- 日期：2026-09-17
- 证据源类型：`@opencode/{plugin,schema}@2.0.3` 与 `2.0.5` tarball 的 `dist` 全量 diff；官方 V2 plugins 文档；真实 `@opencode/cli@2.0.5` 服务日志与 `/api/plugin`。
- 影响分级：下列均为 API/schema 破坏性变化，未消费的域不影响本插件。

### 1. `Skill.Info.location` → 必填 `path`【breaking；本插件受影响】

`schema/skill.d.ts` 的 `Skill.Info`、`Skill.Update` 及事件载荷将绝对路径字段由 `location: AbsolutePath` 重命名为 `path: AbsolutePath`。`SkillEditor` 方法集合不变。

- 真实失败证据：2.0.5 宿主加载旧版 `opencode-oceanus@1.0.2` 时，服务日志记录 `disabled plugin after transform failure ... state=skill ... SchemaError(Missing key at ["path"])`；`/api/plugin` 状态为 `failed`。插件加载成功但在 skill transform 时被整体禁用。
- 适配：技能注册对象改用 `path: "/builtin/opencode-oceanus/<skill>/SKILL.md"`；依赖同步精确锁定到 `@opencode/{plugin,schema}@2.0.5`，以便类型检查阻止旧字段回归。

### 2. `catalog` 拆分为 `provider` 与 `model`【breaking；本插件未消费】

`Context.catalog` 及 `promise|effect/catalog.*` 移除。其 provider 与 model 读写/transform/reload 功能分别迁至 `Context.provider` 与 `Context.model`；新增对应 `promise|effect/{provider,model}.*`。

### 3. session、VCS 与权限 API 重命名/移除【breaking；本插件未消费】

- `SessionDomain.rename(input)` 改为 `update(input)`。
- `VcsDomain.branches(input)` 改为 `vcs.branch.list(input)`。
- `PermissionDomain.rules` 移除；会话权限仍可通过宿主配置/API 管理，但插件 context 不再暴露该方法。
- 表单类型从 `FormReplyInput`/`FormCancelInput` 改名为 `SessionFormReplyInput`/`SessionFormCancelInput`。

### 4. provider/model 会话传输配置【breaking；本插件未消费】

`websocket?: boolean` 移除，provider 与 model 配置改为 `transport?: "http" | "websocket"`。旧配置应映射为 `true → "websocket"`、`false → "http"`。新增实验性 `experimental.ws.handshake` session hook；同时保留 HTTP hook。

### 5. 其余 schema 变化【需按消费面评估】

- `catalog.updated` 改为 `provider.updated`，并新增 `model.updated`；消费旧事件名的订阅者需迁移。
- `session.permissions.updated` 改为 `session.permissions`。
- 配置 `Preferences`/`PreferencesPatch` 移除，收敛为 `Patch: { shell: string | null }`；`websearch` 不再是该偏好 schema 的字段。
- instruction entry 不再包含 `agents`、`claude` 两类目录变体，仅保留 `document`、`directory`。
- MCP 新增 `protocol: "legacy" | "auto" | "2026-07-28"`。

### 6. 本插件验证结论

- 本插件只命中 Skill 路径字段变化；未使用 `catalog`、`Session.rename`、`Vcs.branches`、`PermissionDomain.rules`、`websocket` 配置或上述事件名。
- 已在隔离的真实 2.0.5 Host（`OPENCODE_CONFIG` 指向本仓库 `dist`）复测：`/api/plugin` 返回 `opencode-oceanus`、`features: {server: true, tui: true}`、`state.status: "active"`；`/api/skill` 返回全部 10 个 Oceanus skills，且路径均为 `path: /builtin/opencode-oceanus/.../SKILL.md`。

---

## beta-19271 → 2.0.3（GA 正式版）

- 日期：2026-09-14（记录）；发布时间线：v2.0.0 tag 2026-09-11，npm 2.0.0=09-12 00:15、2.0.1=09-12 05:00、2.0.2=09-12 07:55、2.0.3=09-12 23:46（UTC）
- 证据源类型：tarball 归一化全量 dist diff 三方分解（`@opencode-ai/{plugin,schema}@0.0.0-beta-19271` 旧包 import 路径归一化为 `@opencode/*` 后，与 `@opencode/{plugin,schema}@0.0.0-beta-19507` 及 `@opencode/{plugin,schema}@2.0.{0,1,2,3}` 逐对 `diff -rq`/`diff -u`）+ 宿主 `@opencode/cli@2.0.3` 隔离 serve 实测（2026-09-14）+ npm registry 元数据 + GitHub v2.0.x tags compare（官方未发布 v2.0.x release notes，见 negative_findings）
- 影响分级：见逐条标注

### 0. 版本与包族结构变化【breaking（依赖坐标）】

- **GA 切版不是 API 断点**：`beta-19507 → 2.0.0` 的 plugin 与 schema dist **零差异**（`diff -rq` 全等）；npm 时间线显示 `0.0.0-beta-19500`（09-12 00:11）→ `2.0.0`（09-12 00:15）仅隔 4 分钟——2.0.0 是 beta 开发线（195xx）的 GA 版本号化。beta dist-tag 止于 `0.0.0-beta-19507`，此后开发线仅以 `0.0.0-dev-195xx` 继续。
- **包族整体迁移新 scope**：`@opencode-ai/*` → `@opencode/*`。`@opencode/{cli,plugin,schema,core,client,sdk,ai,protocol,server,theme,util}` latest 均为 2.0.3。旧 `@opencode-ai/plugin` 无 2.x 版本、**未标 deprecated**（latest 仍 1.18.30，v1 线并行维护，双轨分发）。`beta-19507` 已在新 scope 下发布。
- **新增宿主核心包** `@opencode/core@2.0.3`（"Core runtime services for OpenCode"，1234 文件，含 drizzle db/47 migrations）；新增 `@opencode/util`。
- **CLI 双名**：`@opencode/cli@2.0.3` bin 同时注册 `opencode` 与 `opencode2`（同一二进制）。2.0.0 曾以 `opencode2` 为名，2.0.1 起 `opencode` 主名回归并保留 `opencode2` 别名（GitHub v2.0.0...v2.0.1 compare："keep opencode2 as a working alias"）。实测 `opencode2 --version` → `opencode v2.0.3`。
- **仓库/文档迁移**：GitHub → `github.com/anomalyco/opencode`；V2 文档站独立于 V1——`opencode.ai/v2/docs`（`v2.opencode.ai` 重定向别名）；V1 文档仍在 `/docs`。安装渠道收缩为 npm `@opencode/cli`、`https://opencode.ai/v2/install` 脚本、Docker `ghcr.io/anomalyco/opencode`（brew/AUR/Windows PM/standalone 二进制不支持，官方 V2 安装页口径）。
- 对插件影响：升级依赖需同时改包名与版本（`@opencode-ai/plugin@0.0.0-beta-18743` → `@opencode/plugin@2.0.3`），import 路径全量随迁；本插件源码 import 自身锁定包名，迁移是纯坐标替换。

### 1. Session hooks 重构：`options` 合并 + compaction/generate/title 三个新 hook【breaking（类型面）+ 新增】

`promise|effect/session.d.ts`（差异落在 beta-19271 → beta-19507 段）：

```diff
+/** Request overrides. Typed keys are generation settings; any other key is a provider option. */
+export type SessionRequestOptions = Types.DeepMutable<GenerationOptionsFields> & Record<string, unknown>
+export interface SessionRequest {
+    readonly sessionID: Session.ID
-    readonly agent: Agent.ID            // SessionContext 独有，SessionRequest 无
     readonly model: Model.Ref
     system: Array<SystemPart>
     messages: Array<Message>
+    options: SessionRequestOptions
+}
+export interface SessionContext extends SessionRequest {
+    readonly agent: Agent.ID
     tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
-    /** Request overrides; unset fields retain route and model defaults. */
-    generation: Types.DeepMutable<GenerationOptionsFields>
-    providerOptions: Record<string, unknown>
+}
+export interface SessionCompactionResult { summary: string; providerState?: ...; metadata?; tokens?: TokenUsage.Info }
+export interface SessionCompaction extends SessionContext { result?: SessionCompactionResult }
+export interface SessionGenerate extends SessionContext {}
+export interface SessionTitle extends SessionRequest { result?: string }
 export interface SessionHooks {
     readonly prompt: SessionPrompt
     readonly context: SessionContext
+    readonly compaction: SessionCompaction
+    readonly generate: SessionGenerate
+    readonly title: SessionTitle
     readonly "model.request": SessionModelRequest
```

- `SessionContext.generation`/`providerOptions` 两字段移除，合并为 `options: SessionRequestOptions`（类型化键=生成设置，其余任意键=provider option）——依赖旧字段名的 `context` hook 消费方需迁移。
- 新 hook `compaction`：`SessionCompaction extends SessionContext`，设 `result?: SessionCompactionResult` 可直接给出压缩结果并**短路跳过模型请求**。
- 新 hook `generate`：`SessionGenerate extends SessionContext`（agent-loop 生成请求拦截点）。
- 新 hook `title`：`SessionTitle extends SessionRequest`，设 `result?: string` 可短路标题生成的模型请求。
- `SessionModelRequest/HttpRequest/HttpResponse` 的 `kind: "primary"|"compaction"|"title"|"generate"` 判别保留（beta-19242 引入）。
- 对插件影响：本插件未消费 `context` hook 的 `generation`/`providerOptions` 字段，无迁移；新 hook 为可选增强。

### 2. 会话级权限 `session.permissions` + 新事件 `session.permissions.updated`【新增（能力面重要）】

schema `session.d.ts`/`session-event.d.ts`/`session-transfer.d.ts`/`event-manifest.d.ts`（落在 beta-19271 → beta-19507 段）：

- `Session.Info` 新增 optional `permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>`，注释明确 **"Evaluated after the agent's rules; the last matching rule wins"**——会话创建时携带权限规则集，评估顺序在 agent 规则之后。
- `session.created`/`session.updated` 事件携带 `permissions`；新增事件 `session.permissions.updated`（`PermissionsUpdated`，durable 事件）；transfer 载荷与 event-manifest 同步登记。
- 官方 V2 文档口径：子会话继承创建时的规则（会话级 rules 替换式）。
- 对插件影响：本插件 prometheus 受限权限经 agent `permissions` 声明，会话级规则是宿主新增的并行机制，暂不消费。

### 3. `PermissionDomain` 新增 `rules` 读取【新增】

`promise|effect/permission.d.ts`：`Pick<PermissionApi, "list" | "get" | "reply">` → `Pick<PermissionApi, "list" | "get" | "reply" | "rules">`——插件可读取当前权限规则集（与条目 2 的会话级规则配套）。`PermissionHooks.evaluate` 结构不变。

### 4. provider/model `websocket` 会话传输策略【新增】

schema `config/provider.d.ts`（provider 条目与顶层）、`provider.d.ts`、`model.d.ts` 新增 optional `websocket: boolean`（"Session WebSocket policy for routes that support it; omitted means disabled"；model 侧注释"omitted inherits the provider policy, then defaults to disabled"）。落在 beta-19271 → beta-19507 段。

### 5. TUI `session.tabs` API 语义调整【语义变化 + 新增】

`tui/context.d.ts`：

- `open(sessionID)`: 语义从"Opens (or focuses) a tab"改为 **"Opens a tab without focusing it"**。
- `focus(sessionID)`: 语义从"Focuses an already-open tab"改为 **"Opens a tab when needed, then focuses it"**（自动补开）。
- 新增 `move(sessionID, index): boolean`（移动已开 tab 到指定序号）。

对插件影响：本插件 sidebar 未使用 tabs API，无迁移。

### 6. schema 小版本增量（2.0.2 / 2.0.3）【新增】

- **2.0.0 → 2.0.1**：plugin/schema dist 零差异。
- **2.0.1 → 2.0.2**：schema 新增 `config/shell.d.ts`（`ConfigShell.Option = { path: string; name: string; acceptable: boolean }`）与 `config.d.ts` 的 `Preferences`/`PreferencesPatch`（`shell?: string`、`websearch?: false | ConfigWebSearch.Info`，Patch 形态允许 null 清除）——用户偏好（shell 选择、websearch 配置）进配置面，与宿主 Windows shell 探测链（pwsh→powershell→Git Bash→COMSPEC）配套。
- **2.0.2 → 2.0.3**：schema `session-message.d.ts`/`session-transfer.d.ts` 的 `CompactionCompleted`/`CompactionFailed` 新增 optional `cost: Money.USD` 与 `tokens: { input, output, reasoning, cache: { read, write } }`——压缩成本/用量可观测。
- plugin 包 2.0.0 → 2.0.3 dist 全等（三个小版本零类型面变化）。

### 7. 无变化锚点（升级安全面）

归一化后 `diff -rq` 证明与 beta-19271 逐字节一致（除上述文件）：`Plugin.define`（`{ id, setup }`）、promise/effect 全部注册域（agent/catalog/command/integration/mcp/plugin/reference/skill/tool/vcs/websearch——含 `AgentEditor` 无 `add()` 的 upsert 语义、`MCPDomain{transform, reload}`、`Tool.Options.codemode` 联合结构）、`app.d.ts`、`options.d.ts`、`host.d.ts`/`source*.d.ts`、`registration.d.ts`、storage/shell/websearch 域、根级 `worktree.d.ts`（仅 JSDoc 注释补充）、TUI 三件套（`tui/{plugin,index,solid}.d.ts`）。schema 侧 `tool.d.ts`、`agent.d.ts`、`skill.d.ts`、`mcp.d.ts`、`config/{plugin,command,worktree}.d.ts` 等其余文件均无变化。

### 8. 宿主实测注记（@opencode/cli@2.0.3，2026-09-14，隔离 serve + 临时 XDG + 指向本仓库 dist 目录）

- 插件加载 **active**，`Plugin.Info.features = { server: true, tui: true }` 双入口识别。
- 14 个 agent 全量注册（oceanus/sisyphus/prometheus primary + explorer/librarian/oracle/designer/fixer/observer subagent；prometheus temperature 0.3 与完整 system prompt 注入正确）。
- 12 个 skill 全量注册（本插件 10 个 + 宿主 opencode/report）。
- `ctx.mcp.transform` 注册 CBM server → `/api/mcp` 显示 `codebase-memory-mcp: connected`（连接成功，强于 beta 时代的"连接尝试"证据）。
- **宿主内置能力全面插件化**：干净 location 下 `/api/plugin` 返回约 90 个 `opencode.*` builtin 插件（`opencode.tool.{read,write,edit,shell,glob,grep,list,patch,question,skill,subagent,webfetch,websearch}`、`opencode.provider.*`（40+ provider 接入）、`opencode.config.*`（agent/command/skill/provider/compaction/shell/worktree/websearch 等配置域）、`opencode.websearch.{exa,firefall,parallel,tavily,tinyfish}`、`opencode.vcs.{git,hg}`、`opencode.prompt.*`、`opencode.models.dev`、`opencode.mcp.codemode.exclusion` 等）。
- 内置 agent 清单变为 `general`/`explore`/`compaction`/`title`/`summary`（**无 build/plan**；`opencode.plan` 为 builtin 插件而非 agent）。
- **项目配置文件发现**：项目目录下 `opencode.json`（无 c）实测**未被识别**（`/api/config` 文档清单不含该文件、agents 空）；改名 `opencode.jsonc` 后全量生效。beta 时代实测记录未注明扩展名，无法断言此为 2.0 行为变化，但 2.0.3 下项目配置应使用 `.jsonc`。全局配置路径 `~/.config/opencode/opencode.jsonc`（home 推导，不受 `XDG_CONFIG_HOME` 重定向影响，隔离实测发现）。
- serve 形态：`opencode serve [--port] [--hostname] [--cors] [--service] [--stdio]`；`--standalone` 仍为顶层 flag（"Run with a private server instead of the background service"）；serve 启动打印随机 **server password**（HTTP 客户端经宿主 `api` 子命令自动携带）。
- 官方 V2 文档补充口径（librarian 交叉）：`plugins` 配置支持包名@版本/`{package, options}`/`file://`/`-` 前缀禁用；CLI-only/TUI-only 插件经 **`cli.json`** 配置（连远程 server 仍生效）；`opencode plugin add/list/check/update/remove` 管理命令族；V1→V2 迁移指南上线 `/v2/docs/build/plugins/migrate-v1`（V1 stable → V2 口径，与本库 beta 线事实互补）。

### 适配结论

- **beta-18743 API 面在 2.0.3 宿主上实测零回归**（插件加载、全量 agent/skill 注册、MCP transform/reload 均正常）——本插件可继续锁定 beta-18743 运行于 2.0.x 宿主。
- 升级依赖到 `@opencode/plugin@2.0.3` 的实际迁移成本：①包坐标与 import 全量改名；②若消费 `context` hook，需迁移 `generation`/`providerOptions` → `options`；③其余差异全部为 optional 新增。codemode 注入策略、`Plugin.define`、全部注册域契约不变。

### negative_findings

- **v2.0.0~v2.0.3 无 GitHub Release**（仅 bare tags，无 notes/资产）；官方 changelog 页（opencode.ai/changelog）只有 v1.18.x 条目；无集中式 "What's new in v2" 公告页。commit 级变更唯一官方载体是 GitHub tags compare。
- 官方未发布 beta 线（187xx→195xx）逐版 changelog；未发布 beta→GA 迁移说明（migrate-v1 只覆盖 V1 stable→V2）。
- 旧包 `@opencode-ai/*` v1 线维护终点未公布。

---

## beta-18743 → beta-19271

- 日期：2026-09-09（npm `beta` dist-tag 当前指向 `@opencode-ai/{plugin,schema}@0.0.0-beta-19271`；宿主实测 `@opencode/cli@0.0.0-beta-19296`，`@opencode-ai/plugin` 无 19296 版本，npm E404 实证——CLI 宿主已迁往新包名 `@opencode/cli`）
- 证据源类型：tarball 全量 dist diff 三方分解（18743/19242/19271 三版 plugin + schema tarball，`diff -rq` 定位 + 逐文件 `diff -u`；18743→19242 差异与下方既有条目完全重合，本条目只详列 **19242→19271 净增量**）
- 变更文件面（19242→19271）：plugin 仅 `tui/context.d.ts`；schema `config/provider.d.ts`、`model.d.ts`、`provider.d.ts`、`session-event.d.ts`、`session-message.d.ts`、`session-transfer.d.ts`、`event-manifest.d.ts`，新增 `session-provider-context.d.ts`。promise/effect 全部注册域（agent/catalog/command/integration/mcp/plugin/reference/session/skill/tool/vcs/websearch）与根级文件零变化。

### 1. `compaction` 配置新增（provider 条目 / provider 顶层 / model 条目）【新增】

`{ mode: "local" } | { mode: "provider"; threshold?: number }` 联合类型，optional，加到 `config/provider` 的 provider 条目与顶层两处、`model` 条目；`provider.d.ts` 导出 `Compaction` 类型。用于声明上下文压缩走本地还是 provider 侧（provider 模式可配触发阈值）。

### 2. `providerContext` 会话溯源字段 + 新文件 `session-provider-context.d.ts`【新增】

`session-event`、`session-message`、`session-transfer` 新增 optional `providerContext: { version: 1; provenance: { providerID, provider, modelID, route, protocol, endpoint(摘要，非原始 URL) }; messages: Json }`——记录产生该消息的 provider 上下文（canonical AI Message[] 载荷，安装/回放时校验）；`event-manifest` 同步登记。新文件定义 `Provenance` 与 `Info` schema。注释明确"never credentials or a connection ID"。

### 3. TUI `DialogSelectOption.footer?: string`【新增】

`tui/context.d.ts` 选择项（`DialogSelectOption<Value>`，title/value/description/category/disabled 同级）新增 optional `footer`。

### 4. 无变化锚点（升级安全面）

`promise|effect` 全部注册域 `.d.ts`（含 `mcp.d.ts`——`MCPDomain{transform, reload}` 契约与 19242 一致）、`Plugin.define`、`app.d.ts`、`options.d.ts`、`host.d.ts`/`source*.d.ts`、`registration.d.ts`、permission/storage/shell/websearch 等 infra 域、schema 其余文件均与 19242 逐字节一致。

### 5. 宿主实测注记（@opencode/cli@0.0.0-beta-19296，2026-09-09）

宿主加载本插件（npm `opencode-oceanus@0.49.0/0.50.0`，基于 beta-18743 API 构建）：插件加载、agents/skills/tools 注册、`ctx.mcp.transform/reload` 均正常工作（宿主服务日志 `loading plugin` + agent 注册实测）。beta-18743 API 面在 19296 宿主上无兼容性回归。

### 适配结论

19242→19271 净增量全部为 optional 字段与新增类型，**零 breaking**；本插件未消费 compaction/providerContext/DialogSelectOption.footer，无需升级依赖（锁定 beta-18743 继续有效，宿主 19296 实测通过）。

---

## beta-18743 → beta-19242

- 日期：2026-09-07（npm `beta` dist-tag 当前指向 `0.0.0-beta-19242`）
- 证据源类型：tarball 全量 dist diff（plugin + schema 两包，`.d.ts` 与 `.js` 均比对，`diff -rq` 定位差异文件后逐个 `diff -u`）
- 变更文件面：plugin 包 promise/effect 几乎全部域（agent/catalog/command/integration/mcp/plugin/reference/session/skill/tool/vcs/websearch）、`tui/context.d.ts`；新增根级 `host.d.ts`/`source{,.bun,.node}.d.ts` 与 `promise|effect/worktree.d.ts`，根级 `vcs.d.ts` 移除；schema 包 `config{,/command,/provider,/worktree}`、`event-manifest`、`model`、`plugin`、`project`、`session-event`、`session-message`、`session-transfer`、`token-usage`、`tool`、`worktree`。`registration.d.ts`、permission/storage/shell 等 infra 域无变化。

### 1. `Plugin.vcs?: VcsDiscovery` 字段被移除【breaking】

`Plugin` 接口回归 `{ id, setup }`；`vcs.d.ts` 根级模块（`VcsDiscovery`）删除。自定义 VCS 后端注册统一收口到 `ctx.vcs.transform`（`VcsEditor.add(VcsDefinition)`），worktree 管理拆分到新 `ctx.worktree` 域。对插件影响：本插件未使用 `Plugin.vcs`，无迁移；但参考文档中 18721 引入的 `vcs?` 描述已过时。

### 2. `Context.plugin` 类型收窄：`PluginApi` → `Pick<PluginApi, "list">`【breaking（类型面）】

插件上下文只能列插件，不能再经 `ctx.plugin` 触发安装/更新等管理操作。本插件未使用，无迁移。

### 3. 全部注册域 `*Draft` 重命名为 `*Editor`【breaking（重命名）】

`AgentDraft/SkillDraft/CommandDraft/CatalogDraft/IntegrationDraft/MCPDraft/ReferenceDraft/ToolDraft/VcsDraft/WebSearchDraft` → 对应 `*Editor`（promise/effect 双层同步）。`transform: Transform<XxxEditor>`。附带增强：

- `SkillEditor.get(id)` 新增（原 SkillDraft 无 get）。
- `ReferenceEditor.get(name)` 新增。
- `ToolEditor.namespace(namespace: Tool.Namespace)` 新增：可注册工具命名空间（`Tool.Namespace = { name, description }`，schema `tool.d.ts` 新增该接口）。
- `VcsEditor` 增加显式 `default.get()/set()` 默认后端选择。

对插件影响：`src/index.ts` 中 `ctx.agent.transform`/`ctx.tool.transform` 的回调参数类型名变化但结构兼容（`add/update/remove/list` 签名不变）；升级依赖后仅需类型层改名，逻辑零迁移。

### 4. 新增 `ctx.worktree: WorktreeDomain`【新增】

`promise|effect/worktree.d.ts` 新文件：`WorktreeEditor.add(WorktreeDefinition)` 注册 worktree 后端（`create/remove/list`，context 均含 `AbortSignal`），后注册者成为默认。`Context` 新增 `readonly worktree`。schema `worktree.d.ts`：`strategy`、`directory` 变 optional，`ListInput`（按 projectID）改为 `ListEntry`（`{ directory, type: "root" | "worktree" }`）——worktree 列表从项目维度改为目录维度。

### 5. 插件源加载机制重构（宿主内部，新导出面）【新增/无关】

plugin 包新增根级 `host.d.ts`（`resolve(target)/load(entrypoint)` 解析宿主入口）、`source.d.ts`（`createPluginSources`/`localSource`）及 `package.json` `imports` 字段 `#plugin-source`（bun/node 条件分发）；新增 `exports["./host"]`。属宿主加载器内部能力外移，插件作者一般不消费。

### 6. TUI：`session.panel` 插槽 + `ui.panel` API【新增】

- Slot tree 新增 `"session.panel": PanelInput`：`{ name, sessionID, width, presentation: "panel"|"fullscreen", focused, focus(), close(), toggleFullscreen() }`。
- `TuiContext.ui.panel` 新增：`open(name, {presentation?}): boolean`、`close()`（只关自己插件的）、`current()`（Solid computation 内响应式）。
- `PromptFooterInput` 新增 `showDetails: boolean`。
- peerDeps 提升：`@opentui/core`/`@opentui/solid` `>=0.5.9` → `>=0.5.10`。

对本插件 TUI sidebar 无直接影响，但为侧栏面板提供官方 panel 化路径（可评估把会话/模型面板迁往 `session.panel`）。

### 7. Session 模型 hook 增加 `kind` 判别【新增】

`SessionModelRequest/SessionHttpRequest/SessionHttpResponse` 新增 `readonly kind: SessionRequestKind`，`"primary" | "compaction" | "title" | "generate"`——辅助请求（压缩/标题生成）与主 agent loop 可区分，共享 hook 身份。对现按请求统一注入 headers/重写的插件需注意辅助请求也会命中 hook。

### 8. schema：配置与事件面变化【新增/局部 breaking】

- config 根：`autoupdate`（`boolean | "notify"`）移除，改为 `update: "disable" | "notify" | "auto"`；新增 `worktree: { directory }`。
- `config/command`：命令新增 `subagent?: boolean`。
- `config/provider`、`model`、`project` 新增 `canonical`（canonical provider ID / canonical 绝对路径），用于跨 worktree/规范名映射。
- 事件：`plugin.added` 事件类型删除（保留 `plugin.updated`）；abort `reason` 联合扩为 `"user"|"shutdown"|"superseded"|"inactivity"`（新增 inactivity）。
- `session-message`/`session-transfer`/`event-manifest` 的部分事件新增可选 `model: { id, providerID, variant? }` 字段。
- `Plugin.Info`（schema plugin.d.ts）：`package` → `target`，新增可选 `version/outdated/updating/ref`（插件更新状态可观测）。
- `token-usage` 新增 `total(tokens: Info): number` 辅助函数。
- codemode 机制无变化：schema `tool.d.ts` 的 `Tool.Options.codemode` 联合结构与 18743 一致（本插件 `codemode: false` 注入策略继续有效）。

### 适配结论

本插件（`opencode-oceanus`，锁定 beta-18743）升级到 beta-19242 的实际迁移成本集中在**类型重命名层**（`*Draft` → `*Editor`、`Plugin.vcs` 删除、`ctx.plugin` 收窄），运行时逻辑零变化；codemode/transform 注册契约均向后兼容。建议升级时同步 bump `@opentui/*` peer 至 0.5.10 并全量跑 `bun run check`。

---

## beta-18721 → beta-18743

- 日期：2026-09-01
- 证据源类型：tarball 全量 dist diff（plugin + schema 两包，`.d.ts` 与 `.js` 均比对）
- 影响分级：无关（对插件 API 面零影响）

### 零差异

`diff -rq` 全量比对结果为空：两个包的 `dist/` 目录（promise/effect/tui 三层 + schema 全量）在 beta-18721 与 beta-18743 之间**完全一致**。build 号增量（18721 → 18743）仅涉及宿主 CLI/其它渠道产物，插件 API 面无任何变化。

适配结论：以 beta-18721 为基线的适配分析/文档对 beta-18743 直接适用，无迁移成本。

---

## beta-18230 → beta-18721

- 日期：2026-08-31
- 证据源类型：tarball .d.ts 全量 diff（plugin + schema 两包，promise/effect/tui 三层）+ 宿主 beta-18721 实测
- 变更文件面：`promise|effect/{plugin,session,tool,registration,mcp,vcs}.d.ts`、`tui/context.d.ts`（等价重构）、schema `{plugin,session-event,session-inbox,session-message,prompt,config/provider,index}.d.ts`；新增 `{rpc.d.ts, session-metadata.d.ts}`（root/effect/promise 三处）

### 1. `Plugin` 接口移除 `tui?: boolean`，替换为 `vcs?: VcsDiscovery`【breaking】

promise 层（`promise/plugin.d.ts:50-54`）与 effect 层同步：

```diff
 export interface Plugin {
   readonly id: string
-  readonly tui?: boolean
+  readonly vcs?: VcsDiscovery
   readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
 }
```

影响：CLI 插件声明 `tui: true` 处升级后成为多余属性（typecheck 报错）；需移除该声明并另行确认宿主对"双入口插件"的加载方式。TUI 入口 `@opencode-ai/plugin/tui` 的 `Definition` 无变化。

### 2. `SessionHooks` 正式新增 `prompt` 与 `retry`【正式化】

`promise|effect/session.d.ts:53-77`：hook 名联合新增两员：

```ts
interface SessionPrompt {
  readonly sessionID: Session.ID
  readonly messageID: SessionMessage.ID
  prompt: Types.DeepMutable<PromptInput.Prompt>
  metadata?: Record<string, unknown>
  delivery: SessionInbox.Delivery
}
type SessionRetryDecision = { retry: false } | { retry: true; delay: number }
interface SessionRetry {
  readonly sessionID: Session.ID; readonly agent: Agent.ID; readonly model: Model.Ref
  readonly error: SessionError.Error; readonly attempt: number
  decision: SessionRetryDecision
}
interface SessionHooks {
  readonly prompt: SessionPrompt            // 新增
  readonly context: SessionContext
  readonly "model.request": SessionModelRequest
  readonly "http.request": SessionHttpRequest
  readonly "http.response": SessionHttpResponse
  readonly retry: SessionRetry              // 新增
}
```

影响：此前只能运行时探测 + `event: never` 强转注册的 `session.hook("prompt")` / `session.hook("retry")` 可转为类型安全注册；`retry.decision` 可控重试与延迟。

### 3. `SessionContext` 新增 `generation` / `providerOptions`【新增】

```ts
interface SessionContext {
  ...
  /** Request overrides; unset fields retain route and model defaults. */
  generation: Types.DeepMutable<GenerationOptionsFields>
  providerOptions: Record<string, unknown>
}
```

### 4. `SessionDomain` 新增 `"move"`；`active` 仍未暴露【新增 + 边界不变】

```diff
-type SessionDomain = Pick<SessionApi, ... | "rename" | "wait" | "context"> & {
+type SessionDomain = Pick<SessionApi, ... | "rename" | "move" | "wait" | "context"> & {
```

`active` 在 HTTP API（`/api/session/active`）存在但插件域两版均未暴露——探测降级逻辑仍需保留。

### 5. `ToolDraft` 补齐 `list/get/update/remove`；`ToolDomain.reload` 新增【新增】

```diff
 interface ToolDraft {
+  list(): readonly (Info & { readonly id: string })[]
+  get(id: string): (Info & { readonly id: string }) | undefined
   add(tool: Info<Input, Output>): void
+  update(id: string, update: (tool: Types.Mutable<Info>) => void): void
+  remove(id: string): void
 }
 interface ToolDomain {
   readonly transform: Transform<ToolDraft>
+  readonly reload: () => Promise<void>
   readonly hook: Hooks<ToolHooks>
 }
```

`Tool.Options.codemode` 联合结构无变化（宿主 registry 行为两版一致，实测）。

### 6. `ToolHooks["execute.before"]` 移除 `inputSchema`【breaking-低】

```diff
 readonly "execute.before": {
-  readonly tool: string
-  readonly inputSchema: JsonSchema.JsonSchema
+  tool: string
   readonly sessionID: ...
```

依赖 `inputSchema` 的代码需改从 `ToolDraft.get(id).input` 获取。

### 7. `ModelHooks` 第三参约束收紧【breaking-低】

```diff
-export type ModelHooks<Spec> = <Name extends keyof Spec>(name, cb, options?: ModelHookOptions) => ...
+export type ModelHooks<Spec> = <Name extends keyof Spec>(name, cb,
+  options?: Spec[Name] extends { readonly model: unknown } ? ModelHookOptions : never) => ...
```

仅含 `model` 字段的 hook（`model.request`/`sdk`/`language`）接受 `providerID` 限定；`prompt`/`retry` 等不接受第三参。

### 8. `Context` 新增 `location` / `experimental.terminal` / `rpc`【新增 + 正式化】

```diff
 export interface Context {
   readonly app: App
+  readonly location: Location.Info            // 正式化（18230 未声明）
   readonly options: PluginOptions
   ...
+  readonly experimental: { readonly terminal: Pick<...persistentPty..., "read"> }
+  readonly rpc: RpcDomain
 }
```

`location` 正式声明后，`ctx.location.directory` 探测降级链可简化。

### 9. `MCPDomain` 收窄【breaking-低】

```diff
-export interface MCPDomain extends Omit<McpApi, "resource"> {
+export interface MCPDomain extends Pick<McpApi, "list"> {
```

只使用 `transform`/`reload`/`list` 的代码不受影响（本插件 CBM 即此形态）。

### 10. `VcsDomain` 增强【新增】

`VcsDiffInput.base?`、`VcsDefinition.base?`、`VcsDraft`（`add(VcsDefinition)` + `default.{get,set}`）新增；`Plugin.vcs: VcsDiscovery` 插件自定义 VCS 后端通道成型。

### 11. `RpcDomain` 全新【新增】

`ctx.rpc.register(definition, handlers)` → `RpcRegistration{dispose, events.emit}`；配套 schema `rpc.d.ts`、路由 `/api/rpc/*`、`Plugin.Info.features.rpc`。server↔TUI 插件结构化通信新通道。

### 12. schema `Plugin.Info` 重构【breaking-中（仅消费方）】

```diff
-export declare const Info: Schema.Union<readonly [Schema.Struct<{ id; source; status: "active"; tui: boolean }>,
-  Schema.Struct<{ id; source; status: "failed"; error: string; tui: boolean }>]>
+export declare const Info: Schema.Struct<{
+  id?: Plugin.ID
+  source: Source
+  features: { server?: true; tui?: true; rpc?: true }
+  state: { status: "active" } | { status: "failed"; error: string }
+}>
```

顶层 `tui` 布尔 → `features` 三能力位；active/failed 联合内联为 `state`。

### 13. 事件与消息面杂项【新增】

- 事件新增 `session.message.content.updated`。
- 多个 session 事件新增 optional `metadata`（宿主注入，含父会话继承注解——subagent 血缘）。
- prompt/session-message/session-inbox 的 skills 附件新增 optional `text` 字段。
- `SessionContext` 的 `generation`/`providerOptions` 见条目 3。
- 新文件 `session-metadata.d.ts`。

### 14. 无变化锚点（升级安全面）

`Plugin.define` 签名（除 tui 字段）、`Agent.Info`（model 单 ModelRef）、`SkillDraft`（list/add/update/remove）、`Tool.Options.codemode`、`app.d.ts`、`options.d.ts`、TUI 三件套（`tui/{plugin,index,solid}.d.ts`；`tui/context.d.ts` 仅等价类型重构）。

### 15. 本插件（opencode-oceanus）适配要点汇总

1. 移除 `src/index.ts` 的 `tui: true` 声明并确认宿主双入口加载方式（breaking）。
2. `src/hooks/image-materializer.ts`、`src/hooks/image-error-hint.ts` 的 `event: never` 强转转正（正式化收益）。
3. `src/runtime/host-adapter.ts` 的 `ctx.location.directory` 探测链简化为一等字段。
4. `ctx.mcp` 仅用 transform/reload，收窄无影响。
5. `session.hook` 均未传第三参，ModelHooks 收紧无影响。
6. 未使用 `inputSchema`、`Plugin.Info`、`McpApi` 被收窄方法，无影响。
