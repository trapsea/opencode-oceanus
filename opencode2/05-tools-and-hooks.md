# Tool 域与 Hook 体系

> 版本基线：`@opencode-ai/plugin@0.0.0-beta-18743` + `@opencode-ai/schema@0.0.0-beta-18743`（与 beta-18721 的 dist 全量 diff 为零）
> **beta-19242 变化**：`ToolDraft` 重命名为 `ToolEditor` 并新增 `namespace(namespace: Tool.Namespace)`（`Tool.Namespace = { name, description }`，可注册工具命名空间）；`codemode` 机制无变化（`Tool.Options.codemode` 联合结构与 18743 一致）。Session 模型 hook（`SessionModelRequest/HttpRequest/HttpResponse`）新增 `kind: "primary"|"compaction"|"title"|"generate"`，辅助请求（压缩/标题）也会命中统一 hook。详见 `versions/changelog.md`。
> 证据源：tarball `promise/tool.d.ts`、schema `tool.d.ts`；宿主 beta-18721 registry 实测（codemode 行为，见本仓库 `docs/tooling-and-runtime.md` 同口径）。

## 1. ToolDomain

```ts
interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly reload: () => Promise<void>       // beta-18721 新增
  readonly hook: Hooks<ToolHooks>
}
```

### ToolDraft（beta-18721 完整形态）

```ts
interface ToolDraft {
  list(): readonly (Info & { readonly id: string })[]
  get(id: string): (Info & { readonly id: string }) | undefined
  add(tool: Info<Input, Output>): void
  update(id: string, update: (tool: Types.Mutable<Info>) => void): void   // beta-18721 新增；id 不存在时忽略
  remove(id: string): void                                                // beta-18721 新增
}
```

beta-18230 仅有 `add()`；18721 与 SkillDraft 形态对齐，支持运行时改写/移除（含宿主内置工具）。

## 2. 工具定义（schema `Tool.Info`）

```ts
type Info<Input, Output> = {
  readonly name: string
  readonly input: Input          // ValueSchema：effect Schema.Codec | StandardSchemaV1 | JSON Schema
  readonly description: string
  readonly execute: (input: In, context: Tool.Context) => Effect.Effect<Result<Output>, Error>
  readonly output?: Output
  readonly options?: Options
}
```

插件侧包装（`promise/tool.d.ts`）：`execute` 的 context 换成 **ToolContext**（`progress: (update: Metadata) => Promise<void>` promise 化），返回 `Promise<Tool.Result>`，其余同。

```ts
interface ToolContext extends Omit<Tool.Context, "progress"> {
  readonly progress: (update: Tool.Metadata) => Promise<void>
}
// Tool.Context（schema）：{ sessionID, agent, messageID, id: CallID, progress }
```

### Tool.Result 与 Content

```ts
interface Result<Output> {
  readonly output?: OutputValue<Output>            // 结构化输出（经 output schema 编码）
  readonly content?: string | ReadonlyArray<TextContent | FileContent>
  readonly metadata?: Record<string, any>
}
type Content = { type: "text"; text: string }
            | { type: "file"; uri: string; mime: string; name?: string }

class Tool.Error extends Error { /* message + error? + metadata? */ }
```

### Tool.Options 与 codemode 机制（本插件核心依赖）

```ts
interface BaseOptions {
  readonly namespace?: string      // 工具名前缀分组
  readonly permission?: string     // 自定义权限 action 名
}
type Options = BaseOptions & (
  | { readonly codemode?: true; readonly pinned?: boolean }   // 缺省/true：仅进 Code Mode catalog
  | { readonly codemode: boolean; readonly pinned?: never }   // false：进会话直接工具目录
)
```

**实测行为（宿主 beta-18721，同 18230）**：`codemode !== false`（含缺省）的工具只出现在 Code Mode catalog——仅 `execute` JS 运行时内 `tools.<name>` 可调，subagent 与普通会话不可直接调用；`codemode: false` 的工具进入会话直接工具目录。宿主原生 `write`/`webfetch`/`websearch` 等均显式 `codemode: false`。注册包装层注入 `codemode: false` 是让工具对全部 agent 可见的正确方式（本仓库 `src/tools/index.ts` 同款）。

## 3. Tool Hooks

```ts
interface ToolHooks {
  readonly "execute.before": {
    tool: string                      // 可变（beta-18721 起为 mutable；inputSchema 字段已移除）
    readonly sessionID: Session.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly id: Tool.CallID
    input: unknown                    // 可变：改写工具入参
  }
  readonly "execute.after": {
    tool: string
    readonly sessionID: Session.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly id: Tool.CallID
    readonly input: unknown
  } & (
    | { readonly status: "completed"; result: Tool.Result }   // result 可变
    | { readonly status: "error";    error: Tool.Error }      // error 可变
  )
}
```

注册：`ctx.tool.hook("execute.before", async (event) => { ... })`；输入对象中的非 readonly 字段（`tool`、`input`、`result`、`error`）可就地改写影响宿主行为。

**适配注意**：beta-18230 的 `execute.before` 含 `inputSchema: JsonSchema` 字段，beta-18721 已移除；如需 schema 请从 `ToolDraft.get(id)` 的 `Info.input` 自取。

## 4. 全部 Hook 一览（跨域）

| 域 | Hook | 可变字段 | 用途 |
|---|---|---|---|
| tool | `execute.before` | tool, input | 拦截/改写工具调用（守卫、注入、审计） |
| tool | `execute.after` | result \| error | 截断输出、改写错误、记账 |
| session | `prompt` | prompt, metadata | **beta-18721 正式**；提示词进入模型前拦截（附件物化等） |
| session | `context` | tools, generation, providerOptions | 组装会话上下文（工具目录、生成参数覆盖） |
| session | `model.request` | request | 每次模型请求前改写（支持 `ModelHookOptions.providerID` 限定） |
| session | `http.request` | request | 底层 HTTP 请求改写 |
| session | `http.response` | response | 底层 HTTP 响应处理 |
| session | `retry` | decision | **beta-18721 正式**；错误重试决策 `{retry:false}` \| `{retry:true, delay}` |
| permission | `evaluate` | effect, message | 权限判定覆盖（action/resources/metadata 输入） |
| shell | `create.before` | command, cwd, timeout, shell, env | shell 执行前改写 |
| aisdk | `sdk` / `language` | sdk / language | 替换 provider SDK 实例 / LanguageModelV3（含 model 字段，接受 providerID 限定） |

Session hooks 详情见 `06-session-and-events.md`。

## 5. 事件订阅（EventDomain）

`ctx.event.subscribe`（`Pick<EventApi, "subscribe">`）：订阅宿主全局事件流（`OpenCodeEvent`，schema `server-event.d.ts`/`session-event.d.ts` 等定义的事件联合，SSE 口径）。典型事件类型前缀：`session.*`、`session.message.*`（含 beta-18721 新增 `session.message.content.updated`）、`plugin.*`、`skill.updated`、`permission.*`、`vcs.*`、`worktree.*` 等。

## 6. VcsDiscovery（Plugin.vcs 字段）

```ts
interface VcsDiscovery {
  readonly id?: string
  readonly markers: readonly string[]   // 目录标记文件（如 .git），命中则宿主采用该插件作为 VCS 后端
}
```

beta-18721 起插件可通过 `Plugin.define({ vcs: {...} })` 声明自定义 VCS 后端（配合 `VcsDomain`，见 07）。

## 7. 版本兼容锚点（18230 → 18721）

| 事实 | 状态 |
|---|---|
| `Tool.Options.codemode` 语义与联合结构 | 无变化（宿主行为两版一致） |
| ToolDraft.list/get/update/remove | 18721 新增 |
| ToolDomain.reload | 18721 新增 |
| execute.before.inputSchema | 18721 移除 |
| ToolHooks/ToolContext/Result 结构其余部分 | 无变化 |
