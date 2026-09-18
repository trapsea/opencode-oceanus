# 配置全景（opencode.jsonc）

> 版本基线：`@opencode/schema@2.0.5`
> 证据源：2.0.3/2.0.5 tarball schema `dist/config.d.ts` 与 `dist/config/*.d.ts` 全量 diff；官方 V2 config 页。字段为 schema 声明级事实；标注"官方"处为文档口径。
> **2.0 实测注意**：项目目录配置文件应使用 `opencode.jsonc` 扩展名（2.0.3 实测 `opencode.json` 未被识别，见 `02-plugin-lifecycle.md` §3.2）。
> **2.0.5 变化**：provider/model `websocket: boolean` 重命名为 `transport?: "http" | "websocket"`；`Preferences`/`PreferencesPatch` 收敛为仅含必填 `shell: string | null` 的 `Patch`。

## 1. 顶层 Config 字段（schema `config.d.ts`）

| 字段 | 类型/子结构 | 说明 |
|---|---|---|
| `model` | ModelRef（provider/model/variant） | 默认模型 |
| `small_model`*（官方） | ModelRef | 轻量任务模型（官方 config 页口径，schema 顶层未见独立字段，经 model 族表达） |
| `shell` | shell 配置 | 默认 shell |
| `default_agent` | string | 默认 agent（如 build/plan） |
| `autoupdate` | — | 自动更新（**beta-19242 变化**：已移除，改为 `update: "disable" \| "notify" \| "auto"`；另新增 `worktree: { directory }`；`config/command` 命令新增 `subagent?: boolean`；`config/provider`、`model`、`project` 新增 `canonical` 字段。**beta-19271 变化**：`config/provider` 与 `model` 条目新增 optional `compaction: { mode: "local" } \| { mode: "provider"; threshold?: number }`。**2.0.5 变化**：旧 `websocket: boolean` 已改为 `transport?: "http" \| "websocket"`） |
| `share` | — | 会话共享 |
| `enterprise` | — | 企业配置 |
| `username` | string | 用户名 |
| `permissions` | 权限规则 | 见 §permissions |
| `agents` | Record<string, AgentConfig> | agent 覆盖/定义 |
| `snapshots` | — | 快照 |
| `watcher` | `{ ignore }` | 文件 watcher 忽略 |
| `formatter` | `{ disabled, command, environment, extensions }` | 代码格式化器 |
| `lsp` | LSP 配置族 | LSP server |
| `media` | `{ auto_resize, max_width, max_height, image }` | 图片附件处理 |
| `tool_output` | `{ max_lines, max_bytes }` | 工具输出限制 |
| `mcp` | `{ timeout, servers }` | MCP server 表 |
| `compaction` | `{ tokens, auto, keep, buffer }` | 上下文压缩 |
| `skills` | — | skill 配置 |
| `commands` | — | 命令配置 |
| `instructions` | string[] | 附加指令文件/URL（如 `["CONTRIBUTING.md", "docs/*.md"]`） |
| `references` | Record<alias, RefSource> | `@别名` 文件引用 |
| `websearch` | `{ provider }` | 默认搜索 provider |
| `plugins` | (string \| PluginConfig)[] | 插件列表（见 §plugins） |
| `warming` | `{ prompt, interval, duration }` | 预热 |
| `providers` | Provider 配置族 | provider 覆盖 |
| `experimental` | `{ portable_shell_scanner, subagent_depth, policies }` | 实验特性 |

\* 版本归属：`small_model`、`server{port,hostname,mdns,cors}`、`attachment` 等字段在官方 config 页出现但未见于 beta-18721 schema 顶层提取，属文档站滞后或 v1 口径——引用前以 schema/宿主实测为准。

## 2. agents（`config/agent.d.ts`）

单 agent 覆盖：`model`（ModelRef）、`request{settings,headers,body}`、`system`、`description`、`mode`（subagent/primary/all）、`hidden`、`color`、`steps`、`disabled`、`permissions`（action/resource/effect 数组）。与插件 `Agent.Info` 同构（多 `disabled`）。

## 3. commands（`config/command.d.ts`）

`template`、`description`、`agent`、`model`、`subtask`（boolean，强制子代理执行）——markdown 命令文件 frontmatter 同款字段。

## 4. plugins（`config/plugin.d.ts`）

```ts
type PluginEntry = string                  // npm 包名或本地目录路径
                  | { package: string; options: Record<string, any> }
```

- 本地路径必须指向含 index 入口的目录（宿主实测，见 `02-plugin-lifecycle.md` §3.2）。
- `options` 即插件 `ctx.options` 来源。

## 5. permissions / policies

- `permissions`：按 action（read/edit/bash/task/skill/webfetch/...）配置 `allow|ask|deny` 或模式对象（官方口径，schema `permission.d.ts` 为运行时结构 `{action, resource, effect}`）。
- `experimental.policies: Array<{ action, resource, effect }>`：策略引擎（如 `provider.use` 控制可用 provider），通配符匹配、后匹配优先、全局 config 优先于项目 config；无匹配默认 allow（官方 policies 页，实验性）。

## 6. mcp（`config/mcp.d.ts` + schema `mcp.d.ts`）

```jsonc
{
  "mcp": {
    "timeout": { /* TimeoutConfig */ },
    "servers": {
      "name": {
        "type": "local",  "command": ["npx", "..."], "cwd": "...", "environment": {},
        "disabled": false, "codemode": false, "timeout": {}
      },
      // 或
      "remote-config": {
        "type": "remote", "url": "https://...", "headers": {},
        "oauth": { "clientId": "", "clientSecret": "", "scope": "" },
        "disabled": false, "codemode": false
      }
    }
  }
}
```

`codemode: true` 的 server 工具仅进 Code Mode catalog。

## 7. media / tool_output / compaction / watcher / warming

- `media`：`auto_resize`、`max_width`、`max_height`、`image`（max_base64_bytes 等，官方）。
- `tool_output`：`max_lines`、`max_bytes`。
- `compaction`：`tokens`、`auto`、`keep`、`buffer`。
- `watcher.ignore`：glob 忽略表。
- `warming`：`prompt`/`interval`/`duration`（模型预热）。

## 7a. Preferences / Patch 与 shell 选择

- 2.0.2 的 `Preferences`/`PreferencesPatch` 在 2.0.5 移除，改为 `Patch: { shell: string | null }`；旧的 `websearch` 偏好字段不再位于该 schema。
- 新 schema 文件 `config/shell.d.ts`：`ConfigShell.Option = { path: string; name: string; acceptable: boolean }`——宿主 shell 候选项（与 Windows/跨平台 shell 探测链 pwsh→powershell→Git Bash→COMSPEC 配套；宿主侧选择逻辑见本仓库 `docs/opencode-v2-compatibility.md` Windows shell 事实矩阵）。

## 8. providers / model（`config/provider.d.ts`、`config/model.d.ts`）

- provider 覆盖：`settings`/`headers`/`body`（请求覆盖）、`read`/`write`（能力位）、`tier`、`cost{input,output,cache}`、`context{input,output}`、`capabilities`、`variants`、`disabled`、npm registry 等。
- `config/model.d.ts` 定义 ModelRef：`{ providerID, model, variant? }`。
- 2.0.5 的 provider 条目/顶层与 model 条目使用 optional `transport: "http" | "websocket"`（会话传输策略）；迁移旧 `websocket: true` 为 `transport: "websocket"`，`false` 为 `transport: "http"`。

## 9. references（`config/reference.d.ts`）

```jsonc
{ "references": { "alias": { "path": "../docs", "description": "...", "hidden": false } } }
// 或 { "repository": "owner/repo", "branch": "main", "description": "...", "hidden": false }
```

## 10. lsp / formatter（`config/lsp.d.ts`、`config/formatter.d.ts`）

- formatter：`disabled`、`command`、`environment`、`extensions`。
- lsp：`disabled`、`command`、`extensions`、`env`、`initialization`（多段结构）。

## 11. 官方口径的加载与合并（文档站，版本归属混合）

- 格式：JSON / JSONC（带注释）。
- 优先级（低→高）：remote → global → `OPENCODE_CONFIG` env → project → `.opencode` → `OPENCODE_CONFIG_CONTENT` → managed → macOS managed；合并而非替换，冲突键后加载覆盖。
- 变量插值：`{env:VAR}`、`{file:path}`。
- 目录：项目 `.opencode/`、全局 `~/.config/opencode/`（Linux），子目录复数形式（`agents/`、`commands/`、`skills/`、`tools/`）；`OPENCODE_CONFIG_DIR` 可改全局目录。

## 12. 版本兼容锚点（18230 → 2.0.3）

config 家族 `.d.ts` 演进：beta-18721 仅 `config/provider.d.ts` 有差异；beta-19242 `autoupdate`→`update` 等（见 §1）；beta-19271 `compaction`；beta-19507 `websocket`；2.0.2 新增 `config/shell.d.ts` + `Preferences`；2.0.3 无 config 面变化（增量在 session-message/session-transfer 的 compaction `cost`/`tokens`）。
