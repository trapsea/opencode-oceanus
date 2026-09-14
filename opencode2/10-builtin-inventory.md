# 宿主内置清单：工具 / Agent / 命令 / Skill

> 版本基线：插件/schema `@opencode/{plugin,schema}@2.0.3`（GA）；宿主实测基线 `@opencode/cli@2.0.3`（2026-09-14 隔离 serve）
> 证据源与等级：①宿主会话工具目录（beta-18721 会话内取得）+ **2.0.3 `/api/plugin`、`/api/agent`、`/api/skill` 干净 location 实测**；②宿主二进制 strings 交叉（beta-18721）；③官方 V2 文档 tools/agents 页。
> **2.0 结构性变化**：宿主内置能力全面 **builtin 插件化**——工具/provider 接入/配置域/websearch/VCS/prompt 适配均以 `opencode.*` builtin 插件形态组织（2.0.3 实测约 90 个，见 §5）。

## 1. 内置工具（宿主原生；beta-18721 会话目录实测 + 2.0.3 builtin 插件名交叉）

| 工具 | 证据 | 说明 |
|---|---|---|
| `read` | ①② + `opencode.tool.read` | 读文件（支持文本/图片/PDF，行号前缀） |
| `write` | ①② + `opencode.tool.write` | 写文件（覆盖式）；宿主显式 `codemode: false`（实测 registry） |
| `edit` | ①② + `opencode.tool.edit` | 精确文本替换（oldString/newString） |
| `bash`→`shell` | ①② + `opencode.tool.shell` | shell 执行（workdir/timeout/background）。**工具名与权限 action 双版本**：beta 宿主为 `bash`/权限键 `bash`；**OpenCode 2.0（beta-19507+）改名 `shell`**（`@opencode/core@2.0.3` `normalizeAction2`）。**2.0.3 会话目录实证（2026-09-14）：名为 `shell`，无 `bash`** |
| `glob` | ① + `opencode.tool.glob` | 文件名 glob 搜索 |
| `grep` | ① + `opencode.tool.grep` | 内容正则搜索（ripgrep 语法） |
| `list` | ①②③ | 目录列表（**2.0.3 会话目录实证存在**——builtin 插件清单未见独立条目，经其它 builtin 组装；与 read 分工） |
| `patch` | ② + `opencode.tool.patch` | 补丁应用（beta 时代会话目录为 `apply_patch`，strings 命中 `patch`；2.0.3 builtin 名 `opencode.tool.patch`。**2.0.3 会话目录实证：`patch`/`apply_patch` 均未直接暴露**——工具名未闭合，插件侧双名键控保守覆盖，见 `docs/opencode-v2-compatibility.md` 适配记录） |
| `task`→`subagent` | ①② + `opencode.tool.subagent` | 子代理派发（`subagent({agent, description, prompt, background})` 结构化对象参数；宿主按裸 agent 名评估权限）。**2.0.3 会话目录实证（2026-09-14）：名为 `subagent`、权限 action `subagent`（`permission.assert({action: name})` 源码证据），无 `task`** |
| `question` | ①② + `opencode.tool.question` | 向用户提问（结构化选项 + 自定义输入） |
| `webfetch` | ① + `opencode.tool.webfetch` | URL 抓取（宿主显式 `codemode: false`，实测） |
| `websearch` | ① + `opencode.tool.websearch` | 网络搜索 |
| `skill` | ③ + `opencode.tool.skill` | skill 加载（宿主经 skill 机制暴露） |
| `execute`（Code Mode） | ① | Code Mode JS 运行时编排工具（`tools.<ns>.<name>` 目录），非会话直接工具 |

甄别：官方 tools 页的 `todowrite`/`todoread`/`lsp(experimental)` 为 v1 stable 口径；v2 会话目录中未出现。**2.0.3 会话工具目录完整实证（2026-09-14，2.0.3 宿主真实会话内取得）：`read`/`write`/`edit`/`glob`/`grep`/`list`/`question`/`shell`/`subagent`/`webfetch`/`websearch`/`skill` + Code Mode `execute`——无 `bash`/`task`/`apply_patch`/`patch`/`lsp`**。

## 2. 内置 Agent（2.0.3 `/api/agent` 干净 location 实测）

| Agent | mode | 说明 |
|---|---|---|
| `general` | subagent | 通用 subagent |
| `explore` | subagent | 只读探索 subagent |
| `compaction` | primary | 上下文压缩（配合 session `compaction` 能力） |
| `title` | primary | 标题生成 |
| `summary` | primary | 摘要生成 |

- **beta→2.0 变化**：beta-18721 时代 strings 证据的 `build`/`plan` agent 在 2.0.3 `/api/agent` 中不存在（`opencode.plan` 为 builtin 插件而非 agent；`default_agent: build|plan` 为官方文档旧口径）。新增 `compaction`/`title`/`summary` 辅助 primary agent——与 session hooks 的 `kind: "compaction"|"title"|"generate"` 判别对应。
- 插件注册 agent 与内置混排同目录（本插件 9 agent + 内置 5 = 14，2.0.3 实测）。

## 3. 内置命令（干净目录 `/api/command` 实测，beta-18721）

| 命令 | 描述 |
|---|---|
| `init` | guided AGENTS.md setup |
| `review` | review changes [commit\|branch\|pr], defaults to uncommitted |

插件注册命令混排同目录（如本插件 `preset`、CBM 的 `codebase-memory-mcp:explore_codebase` 等）。2.0.3 起 builtin 命令经 `opencode.command` builtin 插件组织。内置 `share`/`undo`/`redo`/`connect`/`compact` 等为官方文档口径（宿主 UI 层行为，v2 未见类型层定义）。

## 4. 内置 Skill（2.0.3 `/api/skill` 干净 location 实测）

| Skill | 描述 |
|---|---|
| `opencode` | OpenCode 自身使用/配置/插件开发等问题的官方 skill |
| `report` | 报告 opencode issue/bug 的官方 skill |

插件注册 skill 混排同目录（本插件 10 个：opencode-oceanus、oceanus-debugging、oceanus-{intake,discuss,plan,execute,review,finish}、clipboard-image-observer、agent-browser；合计 12，2.0.3 实测）。

## 5. 内置插件（2.0 结构性变化；`/api/plugin` 干净 location 实测，2026-09-14）

宿主内置能力以 builtin 插件形态组织（`Plugin.Source.type: "builtin"`），2.0.3 实测约 90 个 `opencode.*`，按族分组：

| 族 | 成员（节选） | 说明 |
|---|---|---|
| `opencode.tool.*` | read/write/edit/shell/glob/grep/patch/question/skill/subagent/webfetch/websearch | 内置工具的宿主实现 |
| `opencode.provider.*` | openai/anthropic(经 prompt 族)/azure/bedrock/google.vertex/github.copilot/openrouter/ollama/lmstudio/vllm/dynamic 等 40+ | provider 接入（models.dev 目录：`opencode.models.dev`） |
| `opencode.config.*` | agent/command/skill/provider/compaction/shell/worktree/websearch/snapshot/formatter/image/tool-output/location-watcher/policy/reference/instruction | 配置文件域解析（每域一插件） |
| `opencode.websearch.*` | exa/firecrawl/parallel/tavily/tinyfish | 搜索 provider（TinyFish 为 2.0.2 新增） |
| `opencode.vcs.*` | git/hg | VCS 后端 |
| `opencode.prompt.*` | openai/anthropic/kimi/arcee/meta | prompt 适配层 |
| 其它 | `opencode.agent`、`opencode.plan`、`opencode.command`、`opencode.skill`、`opencode.wellknown`、`opencode.browser`、`opencode.mcp.codemode.exclusion`、`opencode.warming`、`opencode.variant`、`opencode.config.mcp` | agent/plan/命令/skill 内置实现、浏览器集成、**codemode 排除机制**（佐证 `codemode` 工具目录分流延续）、模型变体、预热等 |

本插件（local 来源）与 builtin 混排：`opencode-oceanus | local | active | features: {server: true, tui: true}`。

## 6. 版本兼容锚点

- 工具 `codemode: false` 注入面（read/write/edit/bash/glob/grep/patch/question/task 等会话直接工具）beta 时代与 2.0.3 行为一致（2.0.3 `opencode.mcp.codemode.exclusion` builtin 插件 + 本插件工具注册实测佐证）。
- 内置 agent 清单 beta（strings：build/plan）→ 2.0.3（API：general/explore/compaction/title/summary）发生变化；`default_agent` 引用旧口径时以 API 实测为准。
- 官方文档 tools 页与 v2 实测存在名称差异（todowrite/apply_patch 口径），引用时以 §1 证据 ① 为准。
