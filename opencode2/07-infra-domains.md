# 基础设施域：MCP / Permission / Storage / VCS / Shell / WebSearch / Reference / Integration / AISDK / Experimental

> 版本基线：`@opencode-ai/plugin@0.0.0-beta-18743` + schema beta-18743（与 beta-18721 的 dist 全量 diff 为零）
> 证据源：tarball `promise/{mcp,permission,storage,vcs,shell,websearch,reference,integration,aisdk}.d.ts`、根级 `storage.d.ts`、`vcs.d.ts`；schema `{mcp,permission,vcs,websearch,persistent-pty}.d.ts`。

## 1. MCPDomain

```ts
interface MCPDraft {
  list(): readonly [string, DeepMutable<Mcp.ServerConfig>][]
  get(name: string): DeepMutable<Mcp.ServerConfig> | undefined
  set(name: string, config: Mcp.ServerConfig): void
  update(name: string, update: (config) => void): void
  remove(name: string): void
}
interface MCPDomain extends Pick<McpApi, "list"> {
  readonly transform: Transform<MCPDraft>
  readonly reload: () => Promise<void>
}
```

- beta-18230 为 `Omit<McpApi, "resource">`，beta-18721 收窄为 `Pick<McpApi, "list">`——插件 MCP 域只剩 list + transform + reload。
- 注入方式：`ctx.mcp.transform(d => d.set("my-mcp", config))` 后 `await ctx.mcp.reload()`。

### Mcp.ServerConfig（schema `mcp.d.ts`）

```ts
type ServerConfig =
  | LocalConfig:  { type: "local"; command: string[]; cwd?; environment?; disabled?; codemode?: boolean; timeout? }
  | RemoteConfig: { type: "remote"; url: string; headers?; oauth?: OAuthConfig | false; disabled?; codemode?: boolean; timeout? }
```

**`codemode?: boolean`（两分支均有）**：MCP server 整体可声明仅进 Code Mode catalog（同 Tool.Options.codemode 语义）。缺省 undefined 时进会话工具目录；`true` 限制为 Code Mode。

OAuth：`{ clientId, clientSecret, scope }`，支持 Dynamic Client Registration（RFC 7591）；CLI 侧 `opencode2 mcp auth/list/logout/debug <name>` 管理。

## 2. PermissionDomain

```ts
interface PermissionEvaluation {
  readonly sessionID: Session.ID
  readonly agent?: Agent.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  effect: Permission.Effect          // 可变："allow" | "deny" | "ask"
  message?: string                   // 可变
}
interface PermissionDomain = Pick<PermissionApi, "list" | "get" | "reply"> & {
  readonly hook: Hooks<{ evaluate: PermissionEvaluation }>
}
```

- `hook("evaluate")` 在权限判定时触发，改写 `effect` 即可覆盖判定结果。
- 配置层权限面（官方 permissions 页）：action 键含 read/edit/glob/grep/bash/task/skill/webfetch/websearch/external_directory/lsp/question/doom_loop；细粒度对象语法（如 `bash: {"git *": "allow", "rm *": "deny"}`）；`--auto` 自动批准非 deny。
- `reply` 用于程序化回应挂起的权限请求（配合 `/api/permission/request` 路由）。

## 3. StorageDomain（插件持久化）

```ts
interface StorageDomain {
  readonly get: (key: string) => Promise<Json | undefined>
  readonly set: (key: string, value: Json) => Promise<void>
  readonly remove: (key: string) => Promise<void>
  readonly scan: (options: StorageScanOptions) => Promise<StorageScanResult>
}
interface StorageScanOptions { prefix: string; after?: string; limit?: number }
interface StorageScanResult { entries: readonly { key: string; value: Json }[]; next?: string }
```

JSON 值 KV，`scan` 前缀分页遍历。存储位置与插件实例绑定（宿主数据目录）。TUI 侧另有独立 `Storage`（durable store / ephemeral memory 双轨，见 08）。

## 4. VcsDomain

```ts
interface VcsDomain extends VcsApi {
  readonly transform: Transform<VcsDraft>
  readonly reload: () => Promise<void>
}
interface VcsDraft {
  add(definition: VcsDefinition): void
  readonly default: { get(): string | undefined; set(selection: string): void }
}
interface VcsDefinition {
  readonly id: string
  readonly name: string
  info(input: VcsScope, { signal }): Promise<Vcs.Info>
  base?(input: VcsScope, { signal }): Promise<Vcs.Base | null>      // beta-18721 新增
  branches(input: VcsBranchesInput, { signal }): Promise<Vcs.BranchList>
  status(input: VcsScope, { signal }): Promise<readonly Vcs.FileStatus[]>
  diff(input: VcsDiffInput, { signal }): Promise<readonly FileDiff.Info[]>
}
interface VcsScope { directory; worktree; canonical; store? }
interface VcsDiffInput extends VcsScope { mode: Vcs.Mode; base?: string; context: number; maxOutputBytes: number }
```

- 插件可注册完整自定义 VCS 后端（配合 `Plugin.vcs: VcsDiscovery = { id?, markers }` 声明目录标记命中）。
  - **beta-19242 变化**：`Plugin.vcs` 字段已移除（根级 `vcs.d.ts`/`VcsDiscovery` 删除）；`VcsDraft` 更名 `VcsEditor` 并新增 `default.get()/set()` 显式默认后端选择；worktree 管理拆分到新 `ctx.worktree: WorktreeDomain`（`WorktreeEditor.add(WorktreeDefinition)`，create/remove/list + AbortSignal；schema `worktree.d.ts` 的 `strategy`/`directory` 变 optional，`ListInput` 改为 `ListEntry { directory, type: "root"|"worktree" }`）。
- `diff` 的 `base?` 与 `base()` 方法为 beta-18721 新增（基准 ref 查询/对比）。
- HTTP 路由：`/api/vcs`、`/api/vcs/{base,branches,diff,status}`（实测存在）。

## 5. ShellDomain

```ts
interface ShellDomain {
  readonly hook: Hooks<{ "create.before": ShellCreateBefore }>
}
interface ShellCreateBefore {
  command: string                                    // 可变
  cwd: string                                        // 可变
  timeout: number                                    // 可变
  shell: string                                      // 可变
  env: Record<string, string | undefined>            // 可变
}
```

宿主执行 shell（bash 工具等）前触发；可改写命令、目录、超时与环境。

## 6. WebSearchDomain

```ts
interface WebSearchDraft {
  add(definition: WebSearchDefinition): void
  readonly default: { get(): string | false | undefined; set(selection: string | false): void }
}
interface WebSearchDefinition {
  readonly id: string
  readonly name: string
  execute(input: WebSearch.ProviderInput, { signal }): Promise<readonly WebSearch.Result[]>
}
interface WebSearchDomain extends WebSearchApi {
  readonly transform: Transform<WebSearchDraft>
  readonly reload: () => Promise<void>
}
```

注册自定义搜索 provider；`default.set(id | false)` 设默认或禁用搜索。HTTP 路由：`/api/websearch`、`/api/websearch/provider`。

## 7. ReferenceDomain

```ts
interface ReferenceDraft {
  add(name: string, source: ReferenceLocalSource | ReferenceGitSource): void
  remove(name: string): void
  list(): readonly (readonly [string, Source])[]
}
```

注册 `@别名` 文件引用：本地目录（`{ path }`）或 Git 仓库（`{ repository, branch? }`）。官方口径：别名不得含 `/`、空白、反斜杠逗号；Git 引用异步克隆；带 description 的 reference 自动进入 agent 上下文。

## 8. IntegrationDomain

```ts
interface IntegrationDomain extends Omit<IntegrationApi, "wellknown"> {
  readonly transform: Transform<IntegrationDraft>
  readonly reload: () => Promise<void>
  readonly connection: {
    readonly active: (integrationID: string) => Promise<ConnectionInfo | undefined>
    readonly resolve: (connection: ConnectionInfo) => Promise<Credential.Value | undefined>
  }
}
```

`IntegrationDraft`：integration 增删改 + `method.update(IntegrationMethodRegistration)` 注册认证方法，四种：

| 方法 | 字段 |
|---|---|
| OAuth | `{ type: "oauth", id, label, form? }` + `authorize(answer) → { mode: "auto" \| "code", callback, url, instructions }` + `refresh?` |
| Command | `{ type: "command", id, label, command: string[] }` |
| Key | `{ type: "key", label?, form? }` |
| Env | `{ type: "env", names: string[] }` |

## 9. AISDKDomain

```ts
interface AISDKDomain { readonly hook: ModelHooks<AISDKHooks> }
interface AISDKHooks {
  sdk:      { readonly model: Model.Info; readonly package: string; readonly options: Record<string, any>; sdk?: any }
  language: { readonly model: Model.Info; readonly sdk: any; readonly options: Record<string, any>; language?: LanguageModelV3 }
}
```

按 `package`（如 `@ai-sdk/openai`）拦截 SDK 装配：`sdk` hook 替换 SDK 实例，`language` hook 直接给出 `LanguageModelV3`（`@ai-sdk/provider`）。两者均接受 `ModelHookOptions.providerID` 限定。

## 10. Experimental

```ts
readonly experimental: {
  readonly terminal: Pick<OpenCodeClient["experimental"]["persistentPty"], "read">
}
```

持久 PTY 读取（beta-18721 新增）。PersistentPty schema 字段含 command/args/cwd/env/cols/data/cursor/checkpoint/exitCode/attachmentID 等。相关路由：`/api/experimental/persistent-pty/*`、`/api/experimental/integration/wellknown`、`/api/experimental/migration/v1`、`/api/experimental/session/:id/*`（实测存在）。

## 11. 版本兼容锚点（18230 → 18721）

| 事实 | 状态 |
|---|---|
| MCPDomain 方法面 | 收窄：`Omit<McpApi,"resource">` → `Pick<McpApi,"list">` |
| Mcp.ServerConfig.codemode | 两版均存在（optional boolean） |
| VcsDiffInput.base / VcsDefinition.base / VcsDraft | 18721 新增（VcsDraft 此前不存在 transform 面） |
| 其余域 | 无变化 |
