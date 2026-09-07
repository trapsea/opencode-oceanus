# 插件生命周期与入口

> 版本基线：`@opencode-ai/plugin@0.0.0-beta-18743`（与 beta-18721 的 dist 全量 diff 为零）
> 证据源：npm tarball 类型声明（`dist/promise/plugin.d.ts`、`dist/effect/plugin.d.ts`、`dist/tui/*.d.ts`、`dist/app.d.ts`、`dist/options.d.ts`）；schema `dist/plugin.d.ts`；宿主行为实测证据为 `opencode2 v0.0.0-beta-18721`；官方文档 opencode.ai/docs/plugins（v1/v2 混杂，已按类型定义甄别）。

## 1. 三种插件入口

`@opencode-ai/plugin` 包通过 package.json exports 暴露三个入口，对应三种插件形态：

| 入口 | 形态 | define 签名 | 运行环境 |
|---|---|---|---|
| `@opencode-ai/plugin`（`.`） | Server 插件（promise 风格） | `define(plugin: Plugin): Plugin` | 后台 server 进程 |
| `@opencode-ai/plugin/effect` | Server 插件（Effect 风格） | `define<R>(plugin: Plugin<R>): Plugin<R>` | 后台 server 进程 |
| `@opencode-ai/plugin/tui` | TUI 插件（Solid/OpenTUI） | `define(plugin: Definition): Definition` | TUI 渲染进程 |

### 1.1 主入口（promise，最常用）

```ts
import { Plugin } from "@opencode-ai/plugin"

export const myPlugin = Plugin.define({
  id: "my-plugin",
  // vcs?: VcsDiscovery   // beta-18721 新增：声明插件自带 VCS 发现逻辑
  setup: async (ctx) => {
    // ctx: Context（20+ 域，见 03-plugin-context.md）
    return () => {
      // 可选 Cleanup：插件卸载/热重载时调用
    }
  },
})
```

`Plugin` 接口（`dist/promise/plugin.d.ts:50-54`）：

```ts
export interface Plugin {
  readonly id: string
  readonly vcs?: VcsDiscovery   // beta-18230 此处是 tui?: boolean，已移除；**beta-19242 变化：vcs 字段已删除，Plugin 回归 { id, setup }**
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
}
export type Cleanup = () => Promise<void> | void
```

**适配注意**：`tui?: boolean` 字段在 beta-18721 已移除（breaking，详见 `versions/changelog.md`）。同一 npm 包不再通过该字段声明"同时提供 TUI 入口"；TUI 与 server 插件是两个独立入口文件，由宿主分别加载。

**beta-19242 变化**：除 `Plugin.vcs` 删除外，`Context.plugin` 类型从 `PluginApi` 收窄为 `Pick<PluginApi, "list">`（插件上下文只能列插件，不能安装/更新）；`Context` 新增 `readonly worktree: WorktreeDomain`；plugin 包新增根级 `host` / `source`（bun/node 条件分发）导出，属宿主加载器内部能力外移，插件作者一般不消费。详见 `versions/changelog.md`。

### 1.2 Effect 入口

`dist/effect/plugin.d.ts:50-55`：

```ts
export interface Plugin<R = Scope.Scope> {
  readonly id: string
  readonly vcs?: VcsDiscovery   // beta-19242 变化：vcs 字段已删除
  readonly effect: (context: Context) => Effect.Effect<void, never, R>
}
```

Context 域与 promise 版一一对应（方法返回 `Effect` 而非 `Promise`）。类型导出（`Agent`/`Command`/`Model`/`Skill`/`Vcs` 等 schema 符号）两个入口一致。

### 1.3 TUI 入口

`dist/tui/plugin.d.ts`：

```ts
export interface Definition {
  readonly id: string
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
}
```

TUI `Context`（`dist/tui/context.d.ts`）与 server Context 完全不同，面向渲染：`renderer`（OpenTUI CliRenderer）、`client`（OpenCodeClient）、`data`（响应式数据集合）、`ui`（dialog/toast/router/tabs/slot）、`keymap`、`theme`、`storage`（durable store + ephemeral memory 双轨）、`attention`、`markdown`（自定义代码块渲染器）。详见 `08-host-capabilities.md` TUI 一节。

配套 Solid 工具：`PluginContextProvider` / `usePlugin()`（`dist/tui/solid.d.ts`）。

## 2. setup 生命周期

1. 宿主加载插件模块（见 §3 加载规则），取其导出的插件定义。
2. 为每个插件调用一次 `setup(context)`；`Context.app` 提供 `{ name, version, channel }`（`dist/app.d.ts`），`Context.location` 提供项目位置（`Location.Info`，含 `directory` 等）。
3. `setup` 返回的 `Cleanup` 在插件禁用/热重载/进程退出时调用。
4. 所有注册（agent/skill/command/tool/mcp 等）都在 `setup` 内通过 `ctx.<domain>.transform()` 或 `ctx.<domain>.draft` 完成；注册句柄是 `Registration`（promise，可 `dispose`）。
5. 插件配置经 `ctx.options`（`PluginOptions = Readonly<Record<string, any>>`，`dist/options.d.ts`）传入——即宿主配置中该插件条目下的自定义字段。

## 3. 加载与发现

### 3.1 插件来源（schema `dist/plugin.d.ts` `Plugin.Source`）

```ts
type Source =
  | { type: "builtin" }                        // 宿主内置
  | { type: "package"; package: string }       // npm 包
  | { type: "local"; path: string }            // 本地路径
  | { type: "sdk" }                            // SDK 注入
```

### 3.2 配置声明（实测，宿主 beta-18721）

宿主配置 `plugins` 字段声明插件列表。本地路径条目**必须指向含 index 入口文件的目录**（如构建产物的 `dist/` 目录，内含 `index.js`）：

- ✅ `"plugins": ["./path/to/dist"]` — 目录内解析 `index` 入口，正常加载
- ❌ 指向单文件 → WARN `configured plugin path must be a directory`，插件整体跳过
- ❌ 指向无 index 文件的目录 → WARN `configured plugin directory has no index entrypoint`，插件整体跳过

插件加载失败（含上述跳过）时，该插件注册的全部 agent/skill/command/tool 均不出现。日志见 `~/.local/share/opencode/log/opencode.log`。

> 甄别：官方文档 plugins 页描述的"全局 config → 项目 config → 全局 plugins 目录 → 项目 plugins 目录"加载顺序及 `project/directory/worktree/client/$` Context 形态为 v1/旧口径；v2 beta-18721 以本文类型定义与实测为准。

### 3.3 宿主视角的插件状态（schema `Plugin.Info`）

beta-18721 起 `Plugin.Info` 为结构化对象（beta-18230 为 active/failed 联合类型，见 changelog）：

```ts
interface Info {
  id?: Plugin.ID
  source: Source
  features: { server?: true; tui?: true; rpc?: true }   // 声明的能力面
  state: { status: "active" } | { status: "failed"; error: string }
}
```

`features` 取代旧顶层 `tui: boolean`；`rpc: true` 表示插件注册了 RPC 端口（见 `06-session-and-events.md`）。

## 4. 版本兼容锚点

| 事实 | 证据 |
|---|---|
| `Plugin.define` 签名自 beta-18230 起稳定（除 `tui` 字段移除） | 两版 `.d.ts` diff |
| `Cleanup` 可选；`setup` 可同步返回 | 类型签名 |
| 宿主对 local 插件要求目录 + index 入口 | 宿主 beta-18721 实测（本仓库 `docs/opencode-v2-compatibility.md` 同口径） |
| 同名插件加载去重规则（npm 包只加载一次等） | 官方文档 v1 口径，v2 未在类型层体现，版本归属不明——依赖时需宿主实测 |

## 5. 相关文档

- `03-plugin-context.md` — server Context 全部域速查
- `05-tools-and-hooks.md` — 工具注册与 hook
- `08-host-capabilities.md` — TUI 插件上下文细节、宿主 CLI
- `versions/changelog.md` — beta 版本间差异（含 `tui` 字段移除详情）
