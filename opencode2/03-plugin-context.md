# Plugin Context 域速查

> 版本基线：`@opencode-ai/plugin@0.0.0-beta-18721`（promise 入口 `dist/promise/plugin.d.ts:26-49`）
> 证据源：npm tarball 类型声明全量；`Registration` 原语见 `dist/promise/registration.d.ts`。

## 1. Context 全貌

```ts
export interface Context {
  readonly app: App                                   // { name, version, channel }
  readonly location: Location.Info                    // 项目位置（含 directory）
  readonly options: PluginOptions                     // 插件自定义配置（Record<string, any>）
  readonly agent: AgentDomain
  readonly aisdk: AISDKDomain
  readonly catalog: CatalogDomain
  readonly command: CommandDomain
  readonly event: EventDomain
  readonly experimental: { terminal: ... }            // persistentPty read（实验）
  readonly integration: IntegrationDomain
  readonly mcp: MCPDomain
  readonly generate: GenerateApi                      // 直接生成能力
  readonly permission: PermissionDomain
  readonly plugin: PluginApi                          // 插件自身信息 API
  readonly reference: ReferenceDomain
  readonly rpc: RpcDomain                             // beta-18721 新增
  readonly session: SessionDomain
  readonly shell: ShellDomain
  readonly skill: SkillDomain
  readonly storage: StorageDomain
  readonly tool: ToolDomain
  readonly vcs: VcsDomain
  readonly websearch: WebSearchDomain
}
```

## 2. 注册原语（`registration.d.ts`）

```ts
interface Registration { dispose(): Promise<void> }

// transform：一次性修改某域的 draft（add/update/remove 等），返回 Registration
type Transform<Input> = (cb: (input: Input) => void) => Promise<Registration>

// hook：订阅事件型回调
type Hooks<Spec> = <N extends keyof Spec>(name: N, cb: (input: Spec[N]) => Promise<void> | void) => Promise<Registration>

// ModelHooks：仅当 hook 输入含 model 字段（如 model.request/sdk/language）才接受第三参
type ModelHooks<Spec> = <N extends keyof Spec>(
  name: N, cb: (input: Spec[N]) => Promise<void> | void,
  options?: Spec[N] extends { readonly model: unknown } ? ModelHookOptions : never
) => Promise<Registration>

interface ModelHookOptions { providerID?: string }    // 限定单一 provider
```

## 3. 域速查表

| 域 | 能力 | Draft / Hook | reload | 详见 |
|---|---|---|---|---|
| `agent` | 增删改 agent、设默认 | `AgentDraft`：`list/get/default(id)/update(id,fn)/remove(id)` | ✅ | 04 |
| `skill` | 注册 skill | `SkillDraft`：`list/add(Skill.Info)/update(id,fn)/remove(id)` | ✅ | 04 |
| `command` | 注册 slash 命令 | `CommandDraft`：`add({name, description?, execute})`；执行收 `CommandInvocation{sessionID, prompt: PromptInput.Prompt, delivery: SessionInbox.Delivery}` | ✅ | 04 |
| `catalog` | provider/model 目录与默认模型 | `CatalogDraft.provider.{list/get/update/remove}`、`CatalogDraft.model.{get/update/remove/default.{get,set}}` | ✅ | 04 |
| `tool` | 注册/改写工具 + 工具 hook | `ToolDraft`：`list/get/add/update(id,fn)/remove(id)`（beta-18721 补齐）；`hook("execute.before"/"execute.after")` | ✅（beta-18721 新增） | 05 |
| `session` | 会话操作 + 会话 hook | `Pick<SessionApi, "create"/"get"/"switchAgent"/"switchModel"/"prompt"/"generate"/"command"/"synthetic"/"interrupt"/"rename"/"move"/"wait"/"context">` + `hook`：`prompt/context/model.request/http.request/http.response/retry` | — | 06 |
| `event` | 全局事件订阅 | `Pick<EventApi, "subscribe">` | — | 06 |
| `rpc` | 注册 RPC 端口（server↔TUI 通信） | `register(definition, handlers)` → `{dispose, events.emit}` | — | 06 |
| `generate` | 直接调 LLM 生成 | `GenerateApi` | — | 06 |
| `mcp` | 注入 MCP server 配置 | `MCPDraft`：`add(name,config)/update/remove`；`Pick<McpApi,"list">` | ✅ | 07 |
| `permission` | 权限决策 hook | `hook("evaluate")`；`Pick<PermissionApi,"list"/"get"/"reply">` | — | 07 |
| `storage` | 插件持久化 KV | `get/set/remove/scan`（JSON 值） | — | 07 |
| `vcs` | git 集成 | `info/status/diff/branches/base?`（beta-18721 新增 base） | — | 07 |
| `shell` | shell 执行 hook | `hook("create.before")`：改写 command/cwd/timeout/shell/env | — | 07 |
| `websearch` | 注册搜索 provider | `WebSearchDraft`：`add({id,name,execute})`、`default.{get,set}` | ✅ | 07 |
| `reference` | 注册文件引用别名 | `ReferenceDraft`：`add(name, local/git source)/remove/list` | ✅ | 07 |
| `integration` | 第三方集成（OAuth/key/env/command） | `IntegrationDraft` + `method.update(IntegrationMethodRegistration)`、`connection.{active,resolve}` | ✅ | 07 |
| `aisdk` | AI SDK 适配 hook | `ModelHooks<AISDKHooks>`：`sdk`（换 SDK 实例）、`language`（换 LanguageModelV3） | — | 07 |
| `plugin` | 插件自身 | `PluginApi` | — | 02 |
| `experimental` | 实验能力 | `terminal`：`OpenCodeClient["experimental"]["persistentPty"]` 的 `read` | — | 07 |

## 4. 域的四种形态

1. **Transform 型**（agent/skill/command/catalog/tool/mcp/reference/websearch/integration）：`transform(draft => {...})` 一次性改 draft，多数配 `reload()` 让宿主重载该域。
2. **Hook 型**（session/permission/shell/aisdk）：`hook(name, cb)` 订阅可变输入（hook 输入对象中的非 readonly 字段可改写以影响宿主行为，如 `SessionRetry.decision`）。
3. **直接 API 型**（session/generate/event/storage/rpc/plugin）：`Pick<...Api>` 子集直接调用。
4. **混合型**（tool/mcp/catalog 等）同时具备 transform + hook/reload。

## 5. 版本兼容锚点（beta-18230 → beta-18721）

| 事实 | 状态 |
|---|---|
| `Context.location` | beta-18721 正式声明（18230 未声明，需探测） |
| `Context.rpc` / `Context.experimental.terminal` | beta-18721 新增 |
| `ModelHooks` 第三参约束 | beta-18721 收紧：仅含 `model` 字段的 hook 接受 `ModelHookOptions` |
| 其余域结构 | 两版一致（详见 changelog） |
