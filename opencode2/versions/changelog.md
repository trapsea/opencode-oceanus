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
| 更早历史版本 | 未回溯（build 数百个，按需增量补录） |

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
