# 宿主能力：TUI / API Server / ACP / Worktree / Form / PTY

> 版本基线：`@opencode-ai/plugin@0.0.0-beta-18743`（与 beta-18721 的 dist 全量 diff 为零）；宿主实测基线为 `opencode2 v0.0.0-beta-18721`
> 证据源：tarball `plugin/dist/tui/*.d.ts` 全量、schema `{worktree,workspace,location,form,question,pty}.d.ts`、宿主 CLI/路由实测；官方 server/sdk 页（标注处为文档口径）。
> **beta-19242 变化**：slot tree 新增 `"session.panel": PanelInput`（`{ name, sessionID, width, presentation: "panel"|"fullscreen", focused, focus(), close(), toggleFullscreen() }`）；`ui.panel` 新增 `open(name, {presentation?})/close()/current()`（current 在 Solid computation 内响应式）；`PromptFooterInput` 新增 `showDetails: boolean`；peerDeps `@opentui/{core,solid}` 提升至 `>=0.5.10`。侧栏插件面板可评估迁移到 `session.panel` 官方路径。详见 `versions/changelog.md`。

## 1. TUI 插件上下文（`plugin/dist/tui/context.d.ts`）

TUI 插件 `setup(context)` 收到的 `Context`（与 server Context 完全不同）：

```ts
interface Context {
  readonly options: Readonly<Record<string, any>>
  readonly location: LocationRef | undefined
  readonly app: App                                   // { version, channel }
  readonly renderer: CliRenderer                      // OpenTUI 渲染器
  readonly client: OpenCodeClient                     // 完整 HTTP 客户端
  readonly data: Data                                 // 响应式数据集合（见 §1.1）
  readonly attention: Attention                       // 通知（notify + sound）
  readonly theme: ResolvedTheme
  readonly themeMode: "dark" | "light"
  readonly markdown: { registerCodeBlockRenderer(language, render): () => void }
  readonly keymap: Keymap                             // 键位系统（见 §1.2）
  readonly storage: Storage                           // durable/ephemeral 双轨（见 §1.3）
  readonly ui: UI                                     // 对话框/路由/tabs/slot（见 §1.4）
}
```

### 1.1 Data（响应式缓存层）

```ts
data.on(eventType, handler) / data.listen(handler)                    // 事件订阅
data.session.{ list/get/root/family/cost/status/sync/invalidate }     // 会话（family=血缘）
data.session.pending.{...}                                            // inbox 待投递
data.session.message.{list/get/sync/invalidate}                       // 消息
data.session.permission.{...}                                         // 权限请求
data.session.form.{list/sync/invalidate/reply/cancel}                 // 表单
data.project.{list/get/sync/invalidate/permission.{...}}
data.shell.{list/get/sync/invalidate}
data.location.{default/sync/invalidate/vcs.info/agent/command/integration/mcp.{server,resource}/model/provider/reference/skill}
```

全部带 `sync`（拉取）/`invalidate`（失效）反应式缓存语义；`LocationCollection.list(location?)` 按 location 分桶。

### 1.2 Keymap（键位系统）

- `layer(input: () => KeymapLayer)`：组件级响应式键位层；`KeymapLayer{mode?, enabled?, target?, priority?, commands?, bindings?}`。
- `KeymapCommand{id?, title?, description?, group?, enabled?, bind?: false|string, palette?: true, slash?: {name, aliases?, arguments?}, suggested?, run(input?, event?)}`——命令可同时进命令面板与 prompt slash 补全。
- `dispatch(id, input?)`、`shortcuts(id)`、`commands()`、`pending()`、`active()`、`mode.{current, push}`（互斥输入模式）。

### 1.3 Storage（双轨）

```ts
storage.store(key, { initial })   // durable JSON：落盘、热重载存活、跨 TUI 实例同步 → [SolidStore, async mutate]
storage.memory(key, { initial })  // ephemeral：热重载共享、TUI 退出即失 → [SolidStore, sync mutate]
```

### 1.4 UI（宿主界面接管）

- **Slot 系统**（`SlotMap`/`SlotClaim`）：宿主 UI 的具名边界树，插件可 `prepend/append/before/after/replace` 认领。已发布路径：`app`、`home.footer`、`prompt.footer{,.status,.file}`、`session.composer.top`、`sidebar.content`、`sidebar.footer`。`replace` 压制原内容与内部认领（记录不丢弃）；宿主路径消失时 additive 认领降级挂到最近存活祖先、replacement 被压制。同目标多认领按启用序共存，`replace` 后启用者胜、祖先 replacement 恒胜后代。
- **router**：`register(page: {name, render})`（插件页面路由 `Route.type: "plugin"`）+ `navigate(destination)` + `current()`。
- **tabs**：`enabled()/list()/open(sessionID)/focus/close`（含 busy/attention/unread 状态）。
- **dialog**：`show(render, onClose?)/set(options)/clear` + 快捷 `alert/confirm/prompt/select`。（beta-19271 变化：`DialogSelectOption` 新增 optional `footer?: string`）
- **toast**：`show({title?, message, variant: info|success|warning|error, duration?})`。
- **attention**：`notify({title?, message, notification?, sound?}) → {ok, notification, sound, skipped?}`（声音名：default/question/permission/error/done/subagent_done）。

配套：`PluginContextProvider` / `usePlugin()`（`tui/solid.d.ts`）在 Solid 组件树注入 Context。

## 2. API Server

- 启动：`opencode2 serve [--port] [--hostname] [--cors]`；默认形态为后台 service（`opencode2 service` 管理），`--standalone` 走私有 server。
- 认证：`OPENCODE_SERVER_PASSWORD` 启用 HTTP Basic Auth（官方 server 页口径）。
- API 面：§见 `01-overview.md` 第 5 节（60+ 实测路由）；SSE 事件流 `/api/event`；OpenAPI 文档路径官方口径为 `/doc`（v2 实测 `/api/openapi.json` 404，以路由表为准）。
- 客户端：`@opencode-ai/sdk` 的 `createOpencode()`（拉起 server + client）/ `createOpencodeClient()`（仅连接）；structured output `format: {type: "json_schema", schema, retryCount?}`（官方 sdk 页）。

## 3. ACP（Agent Client Protocol）

`opencode2 acp`：启动 ACP server，允许外部编辑器/IDE 客户端以标准协议驱动 opencode2 会话（官方 acp 页）。插件层无专属 API；交互经会话与权限体系。

## 4. Worktree / Workspace / Location

- schema `worktree.d.ts`：`{ id, branch, directory, adopted?, created, from, force, durable, aggregate... }`；路由 `/api/worktree/*`、`/api/workspace/*`、事件 `worktree.*`/`workspace.*`。
- `Location.Info`：`{ directory: AbsolutePath, workspaceID?, project }`——`Context.location` 即此结构；`/api/location`、`/api/debug/location` 路由实测存在。
- 宿主启动参数 `opencode2 <directory>` 直接指定项目目录。

## 5. Form / Question / PTY

- **Form**（schema `form.d.ts`）：结构化表单（fields/answer/custom/default...），TUI `data.session.form.reply/cancel` 与路由 `/api/form/request` 构成问答闭环；`question` 工具与 Form/Question schema 联动（`label/description` 选项结构）。
- **PTY**：schema `pty.d.ts`（command/args/cwd/env/cols/data/exitCode）+ `persistent-pty.d.ts`（checkpoint/cursor/attachmentID 等增强）；路由 `/api/pty/*`、`/api/experimental/persistent-pty/*`；插件侧 `Context.experimental.terminal.read` 为唯一只读入口。

## 6. 版本兼容锚点（18230 → 18721）

- `tui/context.d.ts` 仅等价类型重构（OpenCodeEventMap），无行为变化。
- `persistent-pty.d.ts` 有细节差异（18721 调整）。
- TUI Definition、solid 工具、SlotMap 无变化。
