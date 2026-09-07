# OpenCode v2 beta 版本变动记录（changelog）

> 本文件是 opencode2 参考库的版本变动台账。每个条目记录两个相邻（或指定对）beta 版本之间的 API/能力差异，供 `opencode-oceanus` 适配升级时评估影响面。
> 方法论：以 npm `@opencode-ai/{plugin,schema}` tarball 的 `.d.ts` 全量 diff 为权威证据源，宿主 CLI 实测与官方文档为辅助；差异结论按"对本插件的影响"分级标注（breaking / 正式化 / 新增 / 无关）。

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
| 更早历史版本 | 未回溯（build 数百个，按需增量补录） |

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
