# Session / Generate / Event / RPC 域

> 版本基线：`@opencode/plugin@2.0.3` + schema 2.0.3（GA）；宿主实测基线 `@opencode/cli@2.0.3`
> 证据源：tarball `promise/{session,rpc}.d.ts`（2.0.3，与 beta-19507 一致；session hooks 重构落在 beta-19271→19507 段，见 `versions/changelog.md`）；`GenerateApi`/`EventApi` 经 client 包类型；宿主 `/api/*` 路由实测（beta-18721 二进制 + 2.0.3 serve）。
> **2.0 变化**：`SessionHooks` 新增 `compaction`/`generate`/`title`；`SessionContext` 拆出 `SessionRequest` 基类，`generation`/`providerOptions` 合并为 `options`【breaking（类型面）】；schema 侧新增会话级 `permissions` 与事件 `session.permissions.updated`。

## 1. SessionDomain

```ts
type SessionDomain = Pick<SessionApi,
  "create" | "get" | "switchAgent" | "switchModel" | "prompt" | "generate"
  | "command" | "synthetic" | "interrupt" | "rename" | "move" | "wait" | "context"
> & {
  readonly hook: ModelHooks<SessionHooks>
}
```

- `"move"` 为 beta-18721 新增（会话移动/归属变更）。
- **未暴露 `active`**：插件域拿不到"当前活跃会话"（HTTP API 有 `/api/session/active` 路由，域层未映射）——依赖该能力的插件需走 `ctx.event` 订阅或探测降级（本仓库 `src/runtime/` 同款结论）。
- `prompt`/`generate`/`command`/`synthetic` 构成会话驱动面；`interrupt` 中断；`wait` 等待终态；`context` 拉取会话上下文。
- 官方 V2 文档口径：子会话创建时继承会话级权限规则（见 §4）。

## 2. SessionHooks（2.0 全量）

```ts
interface SessionHooks {
  readonly prompt: SessionPrompt            // beta-18721 正式新增
  readonly context: SessionContext
  readonly compaction: SessionCompaction    // 2.0 新增（beta-19507）
  readonly generate: SessionGenerate        // 2.0 新增（beta-19507）
  readonly title: SessionTitle              // 2.0 新增（beta-19507）
  readonly "model.request": SessionModelRequest
  readonly "http.request": SessionHttpRequest
  readonly "http.response": SessionHttpResponse
  readonly retry: SessionRetry              // beta-18721 正式新增
}
```

### prompt（提示词进入模型前）

```ts
interface SessionPrompt {
  readonly sessionID: Session.ID
  readonly messageID: SessionMessage.ID
  prompt: Types.DeepMutable<PromptInput.Prompt>    // 可变：改写提示词/附件
  metadata?: Record<string, unknown>
  delivery: SessionInbox.Delivery                   // 投递上下文
}
```

beta-18230 类型联合未覆盖该 hook 名（仅运行时探测可用）；18721 转正。图片附件物化/改写是典型用法。结构至 2.0.3 未变。

### context / compaction / generate（2.0 重构后形态）

```ts
/** Request overrides. Typed keys are generation settings; any other key is a provider option. */
type SessionRequestOptions = Types.DeepMutable<GenerationOptionsFields> & Record<string, unknown>
interface SessionRequest {
  readonly sessionID: Session.ID
  readonly model: Model.Ref
  system: Array<SystemPart>                 // 可变
  messages: Array<Message>                  // 可变
  options: SessionRequestOptions            // 可变：类型化键=生成设置，其余键=provider option
}
interface SessionContext extends SessionRequest {
  readonly agent: Agent.ID
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>   // 可变
}
interface SessionCompactionResult {
  summary: string
  providerState?: SessionMessage.ProviderState
  metadata?: Record<string, unknown>
  tokens?: TokenUsage.Info
}
interface SessionCompaction extends SessionContext {
  /** Set to use this compaction and skip the model request. */
  result?: SessionCompactionResult          // 设值即短路模型请求
}
interface SessionGenerate extends SessionContext {}
```

**breaking（类型面）**：beta-19271 及之前的 `SessionContext.generation: DeepMutable<GenerationOptionsFields>` 与 `providerOptions: Record<string, unknown>` 两字段移除，合并为 `options: SessionRequestOptions`；依赖旧字段名的 `context` hook 消费方需迁移。

- `compaction`：压缩请求拦截；设 `result` 直接给出压缩结果并跳过模型请求（与宿主 compaction 能力、`CompactionCompleted/Failed` 事件的 `cost`/`tokens` 可观测面配套，见 §4）。
- `generate`：agent-loop 生成请求拦截点（SessionContext 全形态）。

### title（2.0 新增）

```ts
interface SessionTitle extends SessionRequest {
  /** Set to use this title and skip the model request. */
  result?: string                           // 设值即短路标题生成的模型请求
}
```

### retry（错误重试决策）

```ts
type SessionRetryDecision = { retry: false } | { retry: true; delay: number }
interface SessionRetry {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly error: SessionError.Error
  readonly attempt: number
  decision: SessionRetryDecision                  // 可变：控制是否重试与延迟
}
```

### model.request / http.request / http.response

`model.request`：`{ sessionID, agent, model, request }`，`request` 可变（改写模型请求体；接受 providerID 限定）；`kind: "primary"|"compaction"|"title"|"generate"` 判别辅助请求与主 loop（beta-19242 起）。`http.request`/`http.response`：底层 fetch 层 `{ request }` / `{ request, response }`，可变。

## 3. GenerateApi（ctx.generate）

`GenerateApi = Client["generate"]`，核心方法 `generate.text(input, options?)`——插件可脱离会话直接调用模型生成（内部走 `/api/generate` 路由，宿主实测存在）。输入含 model、prompt、generation 参数；SDK 层另有 structured output 能力（`format: {type:"json_schema", schema, retryCount?}`，官方 sdk 页口径，属 `@opencode-ai/sdk` 包能力，plugin 侧经 generate 间接可用部分功能）。

## 4. EventDomain

```ts
interface EventDomain extends Pick<EventApi, "subscribe"> {}
```

订阅宿主全局事件流（SSE，`/api/event` 路由）。事件联合类型 `OpenCodeEvent` 覆盖 `session.*` / `session.message.*` / `plugin.*` / `skill.updated` / `permission.*` / `vcs.*` / `worktree.*` / `workspace.*` 等（schema `server-event.d.ts` 等）。beta-18721 新增事件：`session.message.content.updated`；多个 session 事件新增 optional `metadata`（宿主注入，含从父会话继承的注解——subagent 会话血缘相关）。**beta-19271 变化**：`session-event`/`session-message`/`session-transfer` 新增 optional `providerContext: { version: 1; provenance: { providerID, provider, modelID, route, protocol, endpoint(摘要) }; messages: Json }`（新 schema 文件 `session-provider-context.d.ts`；记录产生消息的 provider 上下文，安装/回放时校验 canonical AI Message[] 载荷，明确不含凭据/连接 ID）。**2.0 变化（beta-19507 落地）**：

- **会话级权限**：`Session.Info`（schema `session.d.ts`）新增 optional `permissions: Array<{ action, resource, effect: "allow"|"deny"|"ask" }>`，注释明确 **"Evaluated after the agent's rules; the last matching rule wins"**——评估顺序在 agent 规则之后、最后匹配胜出；`session.created`/`session.updated` 事件携带；官方 V2 口径子会话继承创建时规则。
- **新事件 `session.permissions.updated`**（`PermissionsUpdated`，durable 事件；`session-event.d.ts`/`event-manifest.d.ts` 登记，transfer 载荷同步）。
- provider/model 新增 optional `websocket: boolean` 会话 WebSocket 传输策略（model 侧注释"omitted inherits the provider policy, then defaults to disabled"）。
- **2.0.3**：`CompactionCompleted`/`CompactionFailed` 事件新增 optional `cost: Money.USD` 与 `tokens: { input, output, reasoning, cache: { read, write } }`——压缩成本/用量可观测（`session-message.d.ts`/`session-transfer.d.ts`）。

## 5. RpcDomain（beta-18721 全新）

```ts
interface RpcDomain extends RpcApi<Pick<RpcCallOptions, "signal"> & { location?: never; headers?: never }> {
  register: <const D extends Rpc.PortableDefinition>(
    definition: D,
    handlers: RpcHandlers<D>
  ) => Promise<RpcRegistration<D>>
}
// RpcRegistration 额外提供 events.emit(...args)
// handler 形态：(input, context: { signal, error: ErrorFactory }) => Promise<Output | HandlerError>
```

- 用途：插件间 / server↔TUI 的结构化通信。`definition` 声明方法与事件（`Rpc.PortableDefinition`，schema `rpc.d.ts`），handlers 实现方法。
- 与 `Plugin.Info.features.rpc: true` 对应：注册了 RPC 的插件在宿主侧声明该能力。
- HTTP 路由 `/api/rpc/*`（宿主实测存在）。

## 6. 会话相关 HTTP API 面（宿主实测，beta-18721 二进制）

`/api/session`、`/api/session/active`、`/api/session/import`、`/api/session/stats`、`/api/session/:id/*`（message/prompt/generate 等经 `/api/message`、`/api/generate`）、`/api/event`（SSE）、`/api/rpc/*`、`/api/generate`、`/api/form/request`。客户端方法面（18230 类型）：`session.{list, create, stats, import, export, active}`、`generate.text`、`message.list`、`event.subscribe`、`plugin.list`。

## 7. 版本兼容锚点（18230 → 2.0.3）

| 事实 | 状态 |
|---|---|
| SessionHooks.prompt / retry | 18721 正式入类型（18230 仅运行时存在） |
| SessionContext.generation / providerOptions | 18721 新增；**2.0（beta-19507）合并为 `options` 并拆出 `SessionRequest` 基类（breaking）** |
| SessionHooks.compaction / generate / title | 2.0 新增（beta-19507），title/compaction 支持 `result` 短路 |
| 会话级 `permissions` + `session.permissions.updated` 事件 | 2.0 新增（beta-19507） |
| SessionDomain 增加 "move" | 18721 新增 |
| SessionDomain.active | 至 2.0.3 均未暴露（HTTP 有路由） |
| RpcDomain | 18721 新增，至 2.0.3 无变化 |
| SessionDomain 其余方法面 | 无变化 |
