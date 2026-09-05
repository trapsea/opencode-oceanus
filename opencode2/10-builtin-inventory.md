# 宿主内置清单：工具 / Agent / 命令 / Skill

> 版本基线：插件/schema `0.0.0-beta-18743`（与 beta-18721 的 dist 全量 diff 为零）；宿主实测基线为 `opencode2 v0.0.0-beta-18721`
> 证据源与等级：①运行中宿主的会话工具目录（最强实证——本记录即在宿主 beta-18721 会话内取得）；②宿主二进制 strings 交叉（`bash/edit/list/patch/question/read/task/write` 独立字符串命中）；③干净目录 `opencode2 api get /api/command`、`/api/skill` 实测；④官方文档 tools/agents 页（v1/v2 混杂，仅作参考并标注）。

## 1. 内置工具（宿主原生，实测 beta-18721；18743 宿主未单独复测）

| 工具 | 证据 | 说明 |
|---|---|---|
| `read` | ①②③ | 读文件（支持文本/图片/PDF，行号前缀） |
| `write` | ①② | 写文件（覆盖式）；宿主显式 `codemode: false`（实测 registry） |
| `edit` | ①② | 精确文本替换（oldString/newString） |
| `bash` | ①② | shell 执行（workdir/timeout/background） |
| `glob` | ① | 文件名 glob 搜索 |
| `grep` | ① | 内容正则搜索（ripgrep 语法） |
| `list` | ①②③ | 目录列表 |
| `apply_patch` | ① | 补丁应用 |
| `patch` | ② | 二进制 strings 命中；疑为 `apply_patch` 内部/别名形态，会话目录未见独立条目 |
| `task` | ①② | 子代理派发（`subagent({agent, description, prompt, background})` 结构化对象参数） |
| `question` | ①② | 向用户提问（结构化选项 + 自定义输入） |
| `webfetch` | ① | URL 抓取（宿主显式 `codemode: false`，实测） |
| `websearch` | ① | 网络搜索 |
| `execute`（Code Mode） | ① | Code Mode JS 运行时编排工具（`tools.<ns>.<name>` 目录），非会话直接工具 |

甄别：官方 tools 页的 `todowrite`/`todoread`/`lsp(experimental)` 为 v1 stable 口径；v2 beta-18721 会话目录中未出现（todo 管理并入其它机制或移除，LSP 走 `config/lsp` 配置域）。`skill` 工具：宿主经 skill 机制暴露（见 §4），会话目录以 skill 描述形式提供。

## 2. 内置 Agent

| Agent | 证据 | 说明 |
|---|---|---|
| `build` | ②④（strings + 官方 `default_agent: build\|plan` 口径） | 构建/修改模式主 agent |
| `plan` | ②④ | 计划模式主 agent（只读建议） |
| `general`/`generic` | ②（strings hint，弱证据） | 通用 agent 名称命中，语义待宿主复测 |

注意：干净目录下 `/api/agent` 返回空列表（data: []）——内置 agent 不经该端点枚举或需项目上下文；`/api/agent` 实际返回的是含插件注册 agent 的合并目录（本项目目录实测返回 oceanus/sisyphus 等插件 agent）。

## 3. 内置命令（干净目录 `/api/command` 实测）

| 命令 | 描述 |
|---|---|
| `init` | guided AGENTS.md setup |
| `review` | review changes [commit\|branch\|pr], defaults to uncommitted |

插件注册命令混排同目录（如本插件 `preset`、CBM 的 `codebase-memory-mcp:explore_codebase` 等）。内置 `share`/`undo`/`redo`/`connect`/`compact` 等为官方文档口径（v1 TUI 内建，v2 未见类型层定义，属宿主 UI 层行为）。

## 4. 内置 Skill（干净目录 `/api/skill` 实测）

| Skill | 描述 |
|---|---|
| `opencode` | OpenCode 自身使用/配置/插件开发等问题的官方 skill |
| `report` | 报告 opencode issue/bug 的官方 skill |

插件注册 skill 混排同目录（本插件 8 个：opencode-oceanus、sisyphus-* ×6、clipboard-image-observer）。

## 5. 内置插件与来源

schema `Plugin.Source` 含 `builtin` 类型；宿主二进制内嵌 builtin 插件清单未在类型层公开（获取方式：运行中 `/api/plugin` 路由，实测存在）。`features.rpc` 等 capability 位见 `Plugin.Info`（`02-plugin-lifecycle.md` §3.3）。

## 6. 版本兼容锚点

- 工具 `codemode: false` 注入面（read/write/edit/bash/glob/grep/list/apply_patch/question/task 等会话直接工具）两版行为一致（宿主 registry 实测，18230 与 18721 同口径）。
- 官方文档 tools 页与 v2 实测存在名称差异（todowrite/apply_patch 口径），引用时以 §1 证据 ① 为准。
