# opencode-oceanus

opencode **v2** 插件：注册 Oceanus agent 编排器及其专家 agent，agent 定义参考 oh-my-opencode-slim 实现（oceanus 颜色 #0FFFFF）。

## 兼容性

- 需要 **opencode v2（beta）**
- 依赖 `@opencode-ai/plugin@beta`（当前锁定 `0.0.0-beta-18743`）
- 入口为 v2 的 `Plugin.define({ id, setup })`，通过 `ctx.agent.transform` 注册 agent

## Agent 列表

| Agent | 角色 | mode |
|-------|------|------|
| `oceanus` | AI 编码编排器（颜色 `#0FFFFF`） | primary |
| `sisyphus` | 六阶段工作流主导（intake → brainstorm → plan → execute → review → finish） | primary |
| `explorer` | 快速代码库检索 | subagent |
| `librarian` | 外部文档 / 库研究 | subagent |
| `oracle` | 架构决策 / 复杂调试 / 评审 | subagent |
| `designer` | UI/UX 设计与实现 | subagent |
| `fixer` | 有界实现执行 | subagent |
| `observer` | 视觉 / 多媒体分析（**默认禁用**，需要视觉模型） | subagent |
| `metis` | 实现前方案分析（需求缺口/风险/边界/反例/验收标准） | subagent |
| `momus` | 执行前方案质量检查（依赖/范围/测试/可执行性），输出 `OKAY`/`REJECT`（仅 BLOCKER 触发 REJECT，附最小修订集） | subagent |

`metis`、`momus` **默认启用、只读**，不写文件、不委派、不执行 task；`observer` 默认禁用（需要视觉模型）。

### 复杂任务门禁：metis → momus → execute

对复杂任务（需求模糊、风险高、多文件、方案未定型），`sisyphus` / `oceanus` 工作流遵循以下协议：

1. 上下文优先：Sisyphus 直接完成 Intake、澄清目标与验收；仅当 Intake 已有、澄清完成后仍有未决方案，且主 Agent 明确需要独立分析时，才条件委派 `@metis` 做方案分析。
2. `@momus`（执行前方案质量检查）：方案形成后、进入 execute 前检查依赖、范围、测试与可执行性，输出 `OKAY` 或 `REJECT`；问题按 BLOCKER/SUGGESTION 分级，仅 BLOCKER 触发 `REJECT` 且附最小修订集（逐条修改建议 + 验证方式），`REJECT` 时按最小修订集回到 plan 修订后重新检查，`OKAY` 才放行 execute。
3. 简单任务（单文件、低风险、方案明确）可明确跳过该门禁，并说明跳过理由。

> **重要**：该门禁是 **prompt 工作流门禁**，由 `sisyphus` / `oceanus` 的提示词与工作流约定强制执行，**不是**插件注册的自动运行时 supervisor——插件不会在运行时自动硬拦截执行路径。`metis` / `momus` 只负责分析与判断，最终决策与放行由 orchestrator / sisyphus 决定。

### 默认只读权限

`explorer`、`librarian`、`oracle`、`observer`、`metis`、`momus` 在无显式 `agents.<name>.permission` 时，集中应用默认只读 v2 permission（allow `read`/`glob`/`grep`/`list`/`lsp`/`codesearch`/`webfetch`/`websearch`，deny `bash`/`edit`/`write`/`apply_patch`/`ast_grep_replace`/`task`/`todowrite`）。显式 `agents.<name>.permission` 始终覆盖该默认值。

### CBM 调度约定

CBM 沿六阶段工作流形成三阶段主线。**Intake 初始化**：代码或混合任务由 Sisyphus 直接调用一次 `cbm_index`（非代码任务跳过），失败、超时或 in-progress 均 fail-open 并记录；这是全工作流唯一初始化点，Brainstorm/Plan 不重复初始化。**Momus 影响面预估**：plan 门禁审查时，`@momus` 对计划声明的修改文件/公共符号用查询型 CBM（`cbm_search_graph` → `cbm_trace` → 必要时 `cbm_code`）排查影响面，发现计划未声明的受影响调用方/契约则 REJECT，预估结论记入 plan status。**Review 影响面复查**：开始即 `cbm_index` 重建索引（execute 已修改代码），再对实际 diff 用 `cbm_trace`/`cbm_detect_changes` 再次排查并与 momus 预估对比——一致记为验证证据，不一致则解释或退回 execute；CBM 不可用时记录降级证据。查询型工具可由需要的 agent 使用，finish 阶段不调用 CBM。详见 `docs/codebase-memory-mcp.md`。

## 安装

opencode v2 有两种加载插件的方式。注意配置字段是 **`plugins`（复数）**，v1 的 `plugin`（单数）已废弃。

### 方式 1：放入插件目录（推荐，本地使用）

构建后把产物放入插件目录，启动时自动加载：

```bash
bun install
bun run build
```

将 `dist/index.js` 复制到以下任一目录：

- 项目级：`.opencode/plugins/opencode-oceanus.js`
- 全局：`~/.config/opencode/plugins/opencode-oceanus.js`

`.opencode/plugins/`（v2 规范，复数）目录下的文件在启动时自动加载。

### 方式 2：`plugins` 数组（opencode.json）

在 `opencode.json`（或 `~/.config/opencode/opencode.json`）的 `plugins` 数组加入：

**本地路径引用构建产物：**

```json
{
  "plugins": ["./opencode-oceanus/dist"]
}
```

**绝对路径：**

```json
{
  "plugins": ["/path/to/opencode-oceanus/dist"]
}
```

> **注意**：OpenCode 宿主 `0.0.0-beta-18721` 起，`plugins` 数组中的本地路径必须是**目录**（目录内需有 `index.js` 入口文件），不再接受 `dist/index.js` 这类单文件路径——指向文件会被跳过并记录 WARN `configured plugin path must be a directory`，导致插件完全不加载。

**发布到 npm 后使用包名：**

```json
{
  "plugins": ["opencode-oceanus"]
}
```

**对象形式（携带插件 options）：**

```json
{
  "plugins": [{ "package": "opencode-oceanus", "options": {} }]
}
```

> 本地文件 / 未发布 npm 时建议方式 1 或方式 2 的路径引用。构建产物已将 zod 内联，插件自包含，仅依赖运行时提供的 `@opencode-ai/plugin`。

### 自动升级

插件默认在加载后 2 秒后台检查一次 npm 最新稳定版本（每进程一次），跨进程按 `checkIntervalMs`（默认 3 小时）节流，不阻塞插件加载；裸名安装走宿主原生 `plugin.update`（热重载免重启），固定版本与旧宿主回退自管安装。
可通过配置关闭：

```jsonc
{
  "autoUpdate": {
    "enabled": false,
    "checkIntervalMs": 10800000
  }
}
```

同一 major 的 installer-managed 固定版本会在专用缓存中 staging 安装并校验，成功后原子替换，失败保留旧版本；更新后需要重启 OpenCode。`@latest`、`file://`/本地路径、OpenCode-managed sandbox 和 major 版本只记录提示，不会被插件强行覆盖。手工安装可使用 `opencode plugin --force opencode-oceanus@latest`。

插件 npm 版本与 CBM 二进制版本解耦。CBM 仍由内置 SHA-256 manifest 驱动的 `provision` 流程安装和升级，不信任网络返回的哈希。

### TUI sidebar 配置

CLI 插件和 TUI 插件分别配置在不同文件中，但使用**同一个包名**。主入口
`opencode-oceanus` 负责注册 agents、skills 和 commands；该包通过 `./tui` 导出 TUI 入口，
OpenCode 会在 `tui.json` 中自动加载它。

在 `opencode.jsonc` 中配置 CLI 插件：

```json
{
  "plugins": ["opencode-oceanus"]
}
```

在 `tui.json` 中配置 TUI 插件：

```json
{
  "plugin": ["opencode-oceanus"]
}
```

本地开发时，OpenCode 会把文件路径当作具体入口处理，不会解析 npm 的
`exports["./tui"]`。因此应分别配置：`opencode.jsonc` 指向 `dist/index.js`，
`cli.json` 指向 `dist/tui.js`。只有发布并安装为 npm 包后，两个配置才都可以使用
同一个包名 `opencode-oceanus`。

sidebar 显示 Oceanus 标题、当前会话 agent，以及已注册 Oceanus agents 的模型信息。
agent 未配置专用模型时显示“跟随会话”；如果模型包含 variant，也会一并显示。
`observer` 默认禁用（该 agent 需要视觉模型），如需启用，在配置中将其从
`disabled_agents` 移除或设置 `"disabled_agents": []`。

### 内置 skill

插件在启动时通过 `ctx.skill.transform` 注入 Oceanus 配置 skill 和 sisyphus 工作流的六个阶段 skill，**安装插件即可使用，无需拷贝任何 skill 文件**：

| Skill | 作用 |
|-------|------|
| `opencode-oceanus` | 说明 Oceanus 配置、preset 优先级、v2 限制及 `/preset` 命令 |
| `oceanus-brainstorm` | 读取 Intake 已确认的执行配置、研究优先澄清需求、按复杂度分层呈现方案（Trivial 单方案精简 / Standard 推荐+备选 / Architecture 2-3 方案全维度）、再以方案总批准单问完成方向批准；SDD 开启时保存设计 spec 到 `.oceanus/spec/` |
| `oceanus-plan` | 映射文件、按规模适配任务、保存实现计划到 `.oceanus/plan/`、Momus 审核=开时经 `@momus` 门禁（关闭时记录 `SKIPPED_BY_USER` 仅保留人工门禁）、消费执行配置批问中的 Metis/Momus/TDD 决策（不重复提问） |
| `oceanus-intake` | 由 Sisyphus 直接完成背景、最小需求 intake、任务分类、执行配置批问与 CBM 初始化 |
| `oceanus-execute` | 按计划实现、后台并行委派 `task(run_in_background=true)`、同步 todo 状态 |
| `oceanus-review` | 阶段间证据化评审、重评审转交 @oracle、验证发现后才接受 |

`sisyphus` agent 会按阶段自动加载对应 skill。

Agent 负责路由、委派和阶段推进；Skill 负责阶段契约、输入/输出与禁止事项，不能替代运行时权限或 supervisor。Ledger 记录进度而非宿主事实；Review 报告记录证据和结论，Finish 只能只读该报告。

### Sisyphus 六阶段工作流

`sisyphus` 执行六阶段工作流（`intake → brainstorm → plan → execute → review → finish`），各阶段职责与产物如下：

| 阶段 | 职责 | 产物 / 落点 |
|------|------|-------------|
| **Intake** | `Sisyphus 直接了解背景、完成最小需求 intake、分类任务，并在代码任务中初始化 CBM；不做方案决策 | Intake 结构化摘要 |
| **Brainstorm** | Sisyphus 消费 Intake 已确认的执行配置，负责研究、澄清与方案决策；调研按分层规则条件委派 `@metis`（Metis 审核=开时 Architecture 默认、Standard 两波自查后仍有未知才委派、Trivial 不委派）；澄清完成后以方案总批准单问完成方向批准 | `.oceanus/spec/` |
| **Plan** | Sisyphus 负责拆分任务并维护进度台账；Momus 审核=开时 `@momus` 做方案质量门禁（人工批准由 Brainstorm 方案总批准覆盖，不重复提问），输出 `OKAY` / `REJECT`；关闭时记录 `SKIPPED_BY_USER` 仅保留人工门禁 | `.oceanus/plan/` + 批准记录 |
| **Execute** | `fixer` / `designer` 实现；若计划发生实质变化或执行失败需重规划，回到 Plan 并**重新经过 momus** | 代码变更 + 更新后的计划 |
| **Review** | 阶段开始先直接刷新当前项目 CBM 索引，再做证据化审查；高风险变更由 `@oracle` 独立审查 | 审查结论 |
| **Finish** | Sisyphus 只读 Review 报告并收口，不测试、不构建、不调用 CBM、不委派、不修改文件 | 交付总结 |

要点：该工作流是 **prompt / skill 层面的约束**，由 `sisyphus` 的提示词与 `sisyphus-*` skill 约定强制执行，**不是**运行时自动 supervisor——插件不会在运行时自动拦截或强制各阶段。禁用相关 Agent 时不得伪造阶段性结果，应如实说明能力缺失。

## 新增工具与运行时保护

插件通过 `ctx.tool.transform` / `ctx.tool.hook` 注册一组原生 v2 工具与运行时保护 Hook，**默认全部启用**，可分别用 `disabled_tools`、`disabled_hooks` 或单项 `enabled: false` 关闭。具体设计见 `.oceanus/spec/tooling-and-runtime-guards.md`。

### 内置工具

| 工具 | 作用 | 说明 |
|------|------|------|
| `ast_grep_search` | 按 AST 语法模式搜索 | 只读；支持 `$VAR` / `$$$` 元变量、语言、路径、glob、上下文；受匹配数与输出字节上限、超时保护 |
| `ast_grep_replace` | 按 AST 语法模式替换 | **默认 dry-run**（只预览不改写）；显式 `dryRun: false` 才真正写入；只改写工作区内的文件 |


默认**关闭**（避免无限保留子会话与副作用重跑风险），通过配置开启：

```jsonc
{
  "taskReuse": {
    "enabled": true,
    "ttlMs": 7200000,
    "maxRetained": 16
  }
}
```


> **验证边界**：是否接受对已完成 subagent 子会话再次 `prompt` 并保留上下文，取决于 opencode v2 运行时的实际能力（官方文档未明确承诺）。插件对此 fail-open（`ok:false → uncertain`），不把"请求被接受"当成"续用成功"。建议在真实 opencode v2 host 上做一次 smoke 确认后再广泛依赖该能力。

### 内置 Hook

Hook 通过 `execute.before` / `execute.after` 注册，每个 Hook 独立容错，单个失败不阻断插件启动。固定执行顺序：`before: apply-patch → tool-loop-guard.before → task-registry-observer.before`；`after: json-error-recovery → tool-output-truncator → tool-loop-guard → task-registry-observer.after`。

| Hook | 位置 | 作用 | 失败边界 |
|------|------|------|----------|
| `apply_patch` | `before` | 校验并保守规范化 `apply_patch` 输入（解析 Codex 风格 patch、路径边界、无损重写） | 工作区外路径、只读输入 **`fail-open`**（交由宿主处理）；输入/校验/内部异常 **`fail-closed`**（抛错阻断执行） |
| `json_error_recovery` | after | 修正工具返回的错误 JSON 参数，避免错误被当作结果吞掉 | **fail-open**：恢复失败不阻断已完成结果 |
| `tool_output_truncator` | after | 截断超长工具输出，避免破坏上下文 | **fail-open**，保留错误、状态、diff 与 hash mismatch 等控制信息 |

### AST CLI 安装与诊断

`ast_grep_search` / `ast_grep_replace` 需要真实 ast-grep CLI。插件不自动下载二进制；解析顺序为：`AST_GREP_BIN` 环境变量 → 缓存目录 → `@ast-grep/cli` 包 → 平台专属包 → PATH 上的 `ast-grep` / `sg`。

每个候选在接受前都会执行短超时 `--version` 验证并确认输出包含 `ast-grep`，从而拒绝同名但非 ast-grep 的程序（如 Linux 上作为 `newgrp` 别名的 `sg`）。当前 AST 写盘工具由自身工具入口和工作区边界保护，不复制宿主 `edit` 的 ask/deny 状态机。安装方式：

```bash
bun add -D @ast-grep/cli   # 或 cargo install ast-grep、brew install ast-grep
```

或设置 `AST_GREP_BIN=/path/to/ast-grep` 指向已有二进制。环境中没有真正可用的 ast-grep 时，工具会返回诊断信息；测试（`src/smoke/host-smoke.test.ts`）也会**明确 skip 真实 CLI 集成并输出诊断**，而不是把环境缺失误报为产品失败。真实 OpenCode v2 host 能力（`session.active` / `interrupt` 等）只在 opencode 会话内执行插件时验证；当前 beta 插件类型未暴露 `session.active` 时，运行时会探测并诚实降级，当前 bun test 环境无真实 host 时相关 smoke 会 skip，仅用 mock ctx 验证注册契约，不声称真实 host 已通过。


## 配置

### codebase-memory-mcp（CBM）

插件内置 CBM 集成，详细的下载、缓存、权限、故障回退及 agent 调度说明见
[`docs/codebase-memory-mcp.md`](docs/codebase-memory-mcp.md)。默认启用 CLI/MCP 与查询前自动索引，Web UI 则按需启动（默认不自动启动）。

CBM 缓存根优先级为 `codebaseMemory.cacheDir` → 外部 `CBM_CACHE_DIR` → 平台默认；插件 `setup` 后固定本次实例的缓存根快照。该目录是二进制安装缓存，不是 daemon 的索引/数据目录。安装会校验 `current.json`、版本与平台、二进制文件及 `--version`；已有使用不同 cache root 的 daemon 不会被自动接管，需先关闭旧会话并按目标缓存根重启。

每个 agent 的模型等可通过独立 jsonc 配置文件定制：

- 用户级：`~/.config/opencode/opencode-oceanus.jsonc`
- 项目级：`.opencode/opencode-oceanus.jsonc`（用于补充/覆盖 `presets`、`agents` 等定义，与用户级合并）

```jsonc
{
  // 当前使用的 preset；名称必须存在于 presets 中
  "preset": "balanced",
  "presets": {
    "balanced": {
      "explorer": {
        "model": "ollama-cloud/deepseek-v4-flash",
        "temperature": 0.2
      },
      "oracle": {
        "model": [
          "openai/gpt-5.6-luna",
          { "id": "openai/gpt-5.6-luna", "variant": "reasoning" }
        ],
        "options": { "effort": "medium" }
      }
    },
    "fast": {
      "explorer": { "model": "openai/gpt-5.6-luna#fast" },
      "fixer": { "temperature": 0.2 }
    }
  },
  "agents": {
    // 显式 agents 优先于当前 preset；此处只覆盖需要例外的字段
    "oceanus":  { "model": "openai/gpt-5.6-luna" },
    "explorer": { "temperature": 0.4 },
    "designer": { "color": "#FFB3BA" }
  },
  "disabled_agents": [],
  "disabled_hooks": [],
  "tools": {
    "ast_grep_replace": { "enabled": true, "dryRun": true },
  },
  "hooks": {
    "tool_output_truncator": { "enabled": true, "maxOutputBytes": 200000 },
    "tool_loop_guard": { "enabled": true, "warnAt": 3, "blockAt": 5 },
  },
  "taskReuse": { "enabled": true }
}
```

### 配置字段

顶层字段：

- `preset`：当前预设名称。插件先读取 `presets[preset]`；名称不存在时发出警告，并仅使用显式 `agents`。
- `presets`：预设名到 agent 覆盖对象的映射。每个预设的内容与 `agents` 使用相同字段。
- `agents`：按 agent 名称配置覆盖。它始终覆盖当前 preset 中同名 agent 的同名字段，适合放例外设置。
- `disabled_agents`：禁用的 agent 名称；默认 `['observer']`，置空数组 `[]` 可启用全部 agent（`oceanus` 受保护，不可禁用）。
- `disabled_tools`：禁用的工具名称数组，对工具拥有最终禁用权。
- `disabled_hooks`：禁用的 Hook 名称数组，对 Hook 拥有最终禁用权。
- `tools`：按工具名深合并的结构化配置（见下方「新增工具与运行时保护」）。
- `hooks`：按 Hook 名深合并的结构化配置（见下方「新增工具与运行时保护」）。
- 文件编辑使用宿主原生 `edit` / `write` / `apply_patch`（原生 diff 渲染与模型通用心智）。详见 `docs/tooling-and-runtime.md`。
- `taskReuse`：subagent 会话复用配置，见「subagent 会话复用」小节。字段：`enabled`（默认 `true`，显式 `false` 可关闭）、`ttlMs`（默认 2h）、`maxRetained`（默认 16）。

`presets.<name>.<agent>` 或 `agents.<agent>` 支持的完整字段：

- `model`：字符串（如 `provider/model` 或 `provider/model#variant`），或非空数组；数组元素可为模型字符串，也可为 `{ "id": "provider/model", "variant": "name" }`。由于 v2 agent 只接受单个 `ModelRef`，数组仅取第一项；未配置时跟随当前会话模型。
- `temperature`：`0` 至 `2` 的数字，映射到 agent 请求设置。
- `variant`：模型变体字符串；可与模型配置配合使用。
- `prompt`：覆盖 agent 系统提示词。
- `orchestratorPrompt`：覆盖编排器提示词。
- `displayName`：覆盖显示名称。
- `description`：覆盖描述。
- `color`：覆盖显示颜色，例如 `#FFB3BA`。
- `options`：传给 agent 的任意请求选项对象。
- `permission`：工具权限规则；可写单个 `ask`、`allow`、`deny`，或按工具名映射这些动作，也支持工具名的 glob/pattern 映射。
- `skills` / `mcps`：schema 接受字符串数组，但当前 OpenCode v2 的 `Agent.Info` 没有对应的直接字段，因此不会映射到 agent；配置时会输出警告。它们不会替代插件注入的 `sisyphus-*` skills。

### 合并优先级

配置按以下顺序合并（越靠后优先级越高）：

1. 用户级 `~/.config/opencode/opencode-oceanus.jsonc`（也支持 `.json`）；
2. 项目级 `.opencode/opencode-oceanus.jsonc`（也支持 `.json`），项目配置覆盖用户配置；同名 `agents` 和 `presets` 会递归合并；
3. 合并后的 `presets[preset]` 作为基础；
4. 合并后的显式 `agents` 覆盖 preset，同一 agent 的同一字段以显式配置为准。

因此，想固定某项目的 preset 可在项目配置设置顶层 `preset`；注意：项目级顶层 `preset` 会覆盖用户级选择（已知边界——`/preset` 的写入目标是用户级全局配置，若项目配置显式设置了 `preset`，该项目内仍以项目级为准）。

### 工具 / Hook 配置规则

新增工具与 Hook 的启停和参数遵循以下规则：

1. **默认全部启用**：未配置时所有新增工具与 Hook 均启用。
2. **禁用列表优先**：`disabled_tools` / `disabled_hooks` 对对应名称拥有最终禁用权；单项 `enabled: false` 等价于禁用；优先级为 `disabled_*` > `item.enabled` > 默认 `true`。
3. **按名称深合并**：`tools` 与 `hooks` 使用按工具/Hook 名称的深度合并，同一项只覆盖显式提供的字段；项目配置覆盖用户配置，`disabled_tools` / `disabled_hooks` 作为数组整体由项目配置覆盖用户配置。
4. **未知项报错**：未识别的工具名、Hook 名或配置字段会被 schema 拒绝，而不是静默忽略。

### 通过 `/preset` 选择

插件注入的原生 command 中可使用以下 slash 命令：

```text
/preset              # 列出预设并标记当前项
/preset fast         # 直接选择名为 fast 的预设
```

选择成功后会原子更新**用户级** `~/.config/opencode/opencode-oceanus.jsonc`（或 `.json`）的顶层 `preset` 字段（全局生效，所有项目共享），不会改写 `presets` 或 `agents`；没有预设、预设不存在或写入失败时命令会报错。preset 名称校验会合并项目级 `.opencode/` 中的 `presets` 定义。命令同时会**立即生效**：当前会话模型同步切换，agent registry 立即重建，后续 subagent 立即使用新模型；仅正在执行中的 subagent 不受影响。TUI sidebar 由 fs.watch 指纹监听自动刷新（~100ms）。

Sisyphus 执行时还会为每个计划维护任务级进度 ledger：`.oceanus/progress/<plan-name>.md`。ledger 按任务记录 `pending`、`in_progress`、`completed`、`failed` 或 `blocked` 状态、worker/session、验证证据和更新时间。并行 worker 不直接写共享 ledger，由 orchestrator 在派发前及每个任务完成后串行更新。

## 开发

```bash
bun install       # 安装依赖
bun run build     # 构建到 dist/（zod 已内联，产物自包含）
bun run typecheck # 类型检查
```

## 项目结构

```
.
├── package.json        # npm 包定义，main 指向 dist/index.js
├── tsconfig.json
├── src/
│   ├── index.ts        # v2 插件入口：Plugin.define + ctx.agent/skill/command/tool/hook 注册
│   ├── config/         # jsonc 配置加载与 schema（paths / loader / schema / utils / constants）
│   ├── agents/         # 各 agent 定义（oceanus / sisyphus + 8 个子 agent）
│   ├── tools/          # 新增工具（ast-grep / clipboard-image / cbm）
│   ├── hooks/          # 运行时保护 Hook（apply-patch / json-error-recovery / tool-output-truncator / tool-loop-guard / task-registry-observer）
│   ├── runtime/        # task registry、workspace 解析等运行时支撑
│   ├── smoke/          # ast-grep CLI 探测与 v2 host smoke
│   └── skills/         # sisyphus 四个阶段 skill（插件注入，安装无需拷贝）
└── dist/               # 构建产物
```

## Sisyphus 文档骨架速查
SDD 开启时 Spec 使用 `Goal / Context / Scope / Non-goals / Requirements / Architecture / Acceptance Criteria / Files touched map / Metis Analysis`；Plan 以 `Spec: .oceanus/spec/<唯一文件>.md` 绑定，并为每个 Task 写明 Files、Consumes/Produces、checkbox、Validation + Expected 与 Acceptance。Execute 先读二者，Review 用 `criterion -> evidence -> status -> gap/next action` 矩阵。
