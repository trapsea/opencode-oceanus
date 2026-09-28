# 宿主能力：TUI / API Server / ACP / Worktree / Form / PTY

> 版本基线：`@opencode/plugin@2.0.3`（GA；TUI 面与 beta-19271 唯一差异为 `session.tabs` 语义调整 + `move`，beta-19507 落地）；宿主实测基线 `@opencode/cli@2.0.3`（2026-09-14 隔离 serve）
> 证据源：tarball `plugin/dist/tui/*.d.ts` 全量、schema `{worktree,workspace,location,form,question,pty}.d.ts`、宿主 CLI/路由实测（beta-18721 + 2.0.3）；官方 V2 文档站（opencode.ai/v2/docs/build/plugins/cli）。
> **beta-19242 变化**：slot tree 新增 `"session.panel": PanelInput`（`{ name, sessionID, width, presentation: "panel"|"fullscreen", focused, focus(), close(), toggleFullscreen() }`）；`ui.panel` 新增 `open(name, {presentation?})/close()/current()`（current 在 Solid computation 内响应式）；`PromptFooterInput` 新增 `showDetails: boolean`；peerDeps `@opentui/{core,solid}` 提升至 `>=0.5.10`（2.0.3 peerDeps 同款，另增 optional `@opencode/theme`）。侧栏插件面板可评估迁移到 `session.panel` 官方路径。
> **2.0 变化**：`session.tabs.open` 改为只开不聚焦、`focus` 改为需要时先开再聚焦、新增 `move(sessionID, index)`（见 §1.4）。

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
- **tabs**（2.0 语义）：`enabled()/list()/open(sessionID)/focus(sessionID)/move(sessionID, index)/close(sessionID?)`（含 busy/attention/unread 状态）。**beta-19507 起**：`open` 只打开不聚焦（旧版"open or focus"）；`focus` 需要时先打开再聚焦（旧版要求已打开）；`move` 新增（移动已开 tab 到指定序号，未开返回 false）。
- **dialog**：`show(render, onClose?)/set(options)/clear` + 快捷 `alert/confirm/prompt/select`。（beta-19271 变化：`DialogSelectOption` 新增 optional `footer?: string`）
- **toast**：`show({title?, message, variant: info|success|warning|error, duration?})`。
- **attention**：`notify({title?, message, notification?, sound?}) → {ok, notification, sound, skipped?}`（声音名：default/question/permission/error/done/subagent_done）。
- **model**（**2.0.17 新增**）：`current() → { providerID, modelID, variant? } | undefined`（Solid computation 内响应式；无选中模型返回 undefined，`variant` 为 undefined 表示模型默认）+ `variant.list() → readonly string[]` + `variant.set(variant: string | undefined) → boolean`（无选中模型或 variant 不可用返回 false；传 `undefined` 回模型默认）。官方 `cli.mdx` 给出绑定命令替换内置 variant 循环的示例。本插件 `tui.tsx` 未消费（可选接入）。

配套：`PluginContextProvider` / `usePlugin()`（`tui/solid.d.ts`）在 Solid 组件树注入 Context。

## 2. API Server

- 启动：`opencode serve [--port] [--hostname] [--cors] [--service] [--stdio]`；默认形态为后台 service（`opencode service` 管理），`--standalone`（顶层 flag）走私有 server。
- 认证：serve 启动时生成随机 **server password**（2.0.3 实测：stdout 打印；宿主 `api` 子命令自动携带；`OPENCODE_SERVER_PASSWORD` 为官方 server 页口径的环境变量注入方式）。
- API 面：见 `01-overview.md` 第 5 节（60+ 实测路由）；SSE 事件流 `/api/event`；OpenAPI 文档路径官方口径为 `/doc`（v2 实测 `/api/openapi.json` 404，以路由表为准）。
- 客户端：`@opencode/sdk` 的 `createOpencode()`（拉起 server + client）/ `createOpencodeClient()`（仅连接）；structured output `format: {type: "json_schema", schema, retryCount?}`（官方 sdk 页）。
- 2.0.3 新增 turn diff 路由（GitHub v2.0.2...v2.0.3 compare：`feat(session): add turn diff route` #47821）。

## 3. ACP（Agent Client Protocol）

`opencode acp`：启动 ACP server，允许外部编辑器/IDE 客户端以标准协议驱动 opencode 会话（官方 acp 页）。插件层无专属 API；交互经会话与权限体系。

## 4. Worktree / Workspace / Location

- schema `worktree.d.ts`：`{ id, branch, directory, adopted?, created, from, force, durable, aggregate... }`；路由 `/api/worktree/*`、`/api/workspace/*`、事件 `worktree.*`/`workspace.*`。2.0（beta-19507）根级 `worktree.d.ts` 仅补 JSDoc（`directory` 为"建议目标"，策略可返回不同目录）。
- `Location.Info`：`{ directory: AbsolutePath, workspaceID?, project }`——`Context.location` 即此结构；`/api/location`、`/api/debug/location` 路由实测存在。
- 宿主启动参数 `opencode <directory>` 直接指定项目目录。

## 5. Form / Question / PTY

- **Form**（schema `form.d.ts`）：结构化表单（fields/answer/custom/default...），TUI `data.session.form.reply/cancel` 与路由 `/api/form/request` 构成问答闭环；`question` 工具与 Form/Question schema 联动（`label/description` 选项结构）。
- **PTY**：schema `pty.d.ts`（command/args/cwd/env/cols/data/exitCode）+ `persistent-pty.d.ts`（checkpoint/cursor/attachmentID 等增强）；路由 `/api/pty/*`、`/api/experimental/persistent-pty/*`；插件侧 `Context.experimental.terminal.read` 为唯一只读入口。

## 6. 版本兼容锚点（18230 → 2.0.3）

- `tui/context.d.ts`：beta-18721 等价类型重构；beta-19242 `session.panel` + `ui.panel`；beta-19507 tabs 语义调整 + `move`（本节 §1.4）；**2.0.17** 新增 `ui.model` 域（本节 §1.4）——其余 TUI 面至 2.0.3 无变化。
- `persistent-pty.d.ts` 有细节差异（18721 调整）。
- TUI Definition、solid 工具、SlotMap 无变化。
- 2.0.3 宿主对双入口插件识别 `features: { server: true, tui: true }`（实测）。
