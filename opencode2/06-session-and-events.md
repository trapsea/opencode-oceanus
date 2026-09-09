# Session / Generate / Event / RPC 域

> 版本基线：`@opencode-ai/plugin@0.0.0-beta-18743` + schema beta-18743（与 beta-18721 的 dist 全量 diff 为零）
> 证据源：tarball `promise/{session,rpc}.d.ts`（18743，与 18721 全量一致）；`GenerateApi`/`EventApi` 经 client 包类型（node_modules beta-18230，`GenerateApi = Client["generate"]`，方法面 `generate.text` / `event.subscribe`）；宿主 `/api/*` 路由实测证据为 beta-18721 二进制。client 侧签名以 18230 类型 + 18721 实测交叉，未逐字对齐处已标注。

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

## 2. SessionHooks（beta-18721 全量）

```ts
interface SessionHooks {
  readonly prompt: SessionPrompt            // beta-18721 正式新增
  readonly context: SessionContext
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

beta-18230 类型联合未覆盖该 hook 名（仅运行时探测可用）；18721 转正。图片附件物化/改写是典型用法。

### context（会话上下文组装）

```ts
interface SessionContext {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref                       // 接受 ModelHookOptions.providerID 限定
  tools: Array<{ name: string; description: string; input: JsonSchema.JsonSchema }>   // 可变
  /** Request overrides; unset fields retain route and model defaults. */
  generation: Types.DeepMutable<GenerationOptionsFields>    // beta-18721 新增
  providerOptions: Record<string, unknown>                  // beta-18721 新增
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

`model.request`：`{ sessionID, agent, model, request }`，`request` 可变（改写模型请求体；接受 providerID 限定）。`http.request`/`http.response`：底层 fetch 层 `{ request }` / `{ request, response }`，可变。

## 3. GenerateApi（ctx.generate）

`GenerateApi = Client["generate"]`，核心方法 `generate.text(input, options?)`——插件可脱离会话直接调用模型生成（内部走 `/api/generate` 路由，宿主实测存在）。输入含 model、prompt、generation 参数；SDK 层另有 structured output 能力（`format: {type:"json_schema", schema, retryCount?}`，官方 sdk 页口径，属 `@opencode-ai/sdk` 包能力，plugin 侧经 generate 间接可用部分功能）。

## 4. EventDomain

```ts
interface EventDomain extends Pick<EventApi, "subscribe"> {}
```

订阅宿主全局事件流（SSE，`/api/event` 路由）。事件联合类型 `OpenCodeEvent` 覆盖 `session.*` / `session.message.*` / `plugin.*` / `skill.updated` / `permission.*` / `vcs.*` / `worktree.*` / `workspace.*` 等（schema `server-event.d.ts` 等）。beta-18721 新增事件：`session.message.content.updated`；多个 session 事件新增 optional `metadata`（宿主注入，含从父会话继承的注解——subagent 会话血缘相关）。**beta-19271 变化**：`session-event`/`session-message`/`session-transfer` 新增 optional `providerContext: { version: 1; provenance: { providerID, provider, modelID, route, protocol, endpoint(摘要) }; messages: Json }`（新 schema 文件 `session-provider-context.d.ts`；记录产生消息的 provider 上下文，安装/回放时校验 canonical AI Message[] 载荷，明确不含凭据/连接 ID）。

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

## 7. 版本兼容锚点（18230 → 18721）

| 事实 | 状态 |
|---|---|
| SessionHooks.prompt / retry | 18721 正式入类型（18230 仅运行时存在） |
| SessionContext.generation / providerOptions | 18721 新增 |
| SessionDomain 增加 "move" | 18721 新增 |
| SessionDomain.active | 两版均未暴露（HTTP 有路由） |
| RpcDomain | 18721 新增 |
| SessionDomain 其余方法面 | 无变化 |
