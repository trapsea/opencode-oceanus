# Oceanus 集成 codebase-memory-mcp 设计规格

> **状态：superseded**。Sisyphus 六阶段、Intake 初始化及 Review 前刷新以 `.oceanus/spec/sisyphus-intake-stage.md` 为权威。

## 目标

在不要求用户手动安装的前提下，将包含内建 UI 的 `codebase-memory-mcp` 官方 release 完整集成到
`opencode-oceanus`：

- 插件首次加载时后台自动下载并安装包含 UI 的 canonical release 归档；
- 通过 OpenCode v2 `ctx.mcp.transform` 注入本地 MCP；
- 通过 Oceanus 工具注册提供 CLI 兜底，确保子 agent 在无法继承 MCP 时仍能查询；
- 在主 agent 与检索型子 agent 中固化调用调度规则；
- 在代码开发、修改或查询任务进入 brainstorm 前，按配置检查并按需初始化项目索引；
- UI 能力始终随归档安装，但 Web UI 只按需启动；
- 安装、校验、启动、索引失败时不阻塞 Oceanus，回退到 grep/glob/read/AST-Grep。

## 已确认决策

1. 采用插件托管的完整集成方案，不依赖用户预先安装二进制。
2. 安装时机为首次插件加载后台安装；插件启动不等待下载完成。
3. 首次 CBM 调用前必须等待同一个安装 Promise；安装失败时给出诊断并降级。
4. 当前官方 release 已将 UI 内建到每个平台唯一的 canonical 标准归档；安装后必须用 `--ui=true` 验证 UI 能力，不能假设存在独立 `-ui-` 归档。
5. 默认只启动 MCP，不自动启动 Web UI。
6. 通过 `/cbm ui` 或显式配置按需启动 UI，默认端口为 `9749`，支持配置覆盖。
7. MCP 是主通道，Oceanus CLI 工具是子 agent 可见性兜底通道。
8. codebase-memory-mcp 自身负责索引后的文件变更同步；Oceanus 不重复实现文件 watcher。
9. 自动索引默认开启但只在首次需要 CBM 查询时触发，不在插件启动阶段阻塞索引整个项目。

## 集成架构

```text
OpenCode v2
└── opencode-oceanus
    ├── Provision 层
    │   ├── 平台识别
     │   ├── 含内建 UI 的 canonical release 下载
    │   ├── SHA-256 校验
    │   ├── 原子解压/替换
    │   └── 并发安装锁与失败恢复
    ├── MCP 主通道
    │   └── ctx.mcp.transform -> codebase-memory-mcp 本地 stdio server
    ├── CLI 兜底通道
    │   └── ctx.tool.transform -> cbm_* -> binary cli <tool> <json>
    ├── Agent 调度层
    │   ├── oceanus/sisyphus：分类任务、委派检索、要求证据
    │   ├── explorer：符号/调用链优先 CBM
    │   ├── oracle：影响面/架构/审查优先 CBM
    │   └── librarian：本地代码交叉时使用 CBM，外部资料仍用 Web
    ├── 生命周期层
    │   ├── 首次结构化查询前自动 index
    │   ├── codebase-memory-mcp 自身负责增量同步
    │   └── /cbm status/index/ui/repair
    └── 降级层
        └── CBM 不可用时回退 grep/glob/read/ast_grep_search
```

## 自动安装设计

### 解析优先级

1. 显式配置的 `binaryPath`；
2. Oceanus 私有缓存中的含 UI 二进制；
3. 系统 `PATH` 中已有的 `codebase-memory-mcp`；
4. 若均不存在，下载包含 UI 的 canonical release 到 Oceanus 私有缓存。

### 缓存位置

- macOS/Linux：`$XDG_CACHE_HOME/opencode-oceanus/codebase-memory-mcp/`，否则
  `~/.cache/opencode-oceanus/codebase-memory-mcp/`；
- Windows：`%LOCALAPPDATA%/opencode-oceanus/codebase-memory-mcp/`。

缓存按版本和平台隔离，至少包含：

```text
<cache>/
├── versions/<version>/<platform>/codebase-memory-mcp
├── versions/<version>/<platform>/runtime-assets/...
├── downloads/<archive>.partial
├── manifests/<version>-<platform>.json
├── install.lock
└── current.json
```

### 下载与安全

- 默认固定到官方当前支持的 release 版本，计划基线为 `v0.10.8`，不直接无条件跟随 latest；
- 从官方 GitHub release 下载 canonical 平台归档；当前归档内建 UI，安装后用 `--ui=true` 验证；
- SHA-256 必须随 Oceanus 版本内置到 platform manifest；网络只提供归档，不提供运行时信任根；
- manifest 解析限制大小、校验 64 位十六进制格式、拒绝同名冲突 digest；
- 可选验证官方 Sigstore/SLSA bundle，不能把未验证的远程 `checksums.txt` 当作唯一信任根；
- 下载到 `.partial`，完成后校验 SHA-256；
- 校验成功后解压到临时目录，再原子 rename 到版本目录；解压前拒绝绝对路径、`..` 路径和越界 archive member；
- 校验失败删除临时文件，不覆盖当前可用版本；
- 安装锁覆盖下载→校验→解压→替换全流程，记录 owner PID/创建时间并支持陈旧锁接管；多个 session 共享同一个安装 Promise；
- 二进制权限在 Unix 下设置为可执行；
- Windows 处理 `.exe` 与归档格式；
- 下载、校验、解压、启动过程禁止把 token、源码或路径之外的敏感环境变量写入日志。

### 后台安装状态机

```text
idle -> resolving -> downloading -> verifying -> extracting -> health-check -> ready
                                      └──────> failed
任何状态 -> cancelled/failed -> fallback
```

要求：

- `setup()` 触发后台安装但不 await；
- 状态由进程级单例维护，避免每个 session 重复下载；
- 首次 CBM MCP/CLI 调用 await `ensureInstalled()`；
- 安装失败只影响 CBM，不能阻塞 agent、普通工具和 Oceanus 启动；
- `/cbm repair` 清理损坏临时文件并重新安装；
- 已有有效当前版本时复用前校验 current manifest 的 SHA-256，并执行 `--version` 健康检查；失败则进入 repair。

## MCP 主通道

在 `ctx.mcp.transform` 中注册名称固定为 `codebase-memory-mcp` 的 local server：

```text
type: local
command: [resolvedBinaryPath]
cwd: currentWorkspace
environment:
  CBM_CACHE_DIR: configuredOrDefaultCacheDir
disabled: false
codemode: true
```

设计要求：

- 若 host schema 接受缺失 command 的 disabled local server，setup 阶段先注册 `disabled: true` 占位配置，避免 MCP catalog 长时间缺失；
- 安装成功后更新 command/environment、设置 `disabled: false`，并最多执行一次 `ctx.mcp.reload()`；
- 若 host 不接受占位配置，则采用安装完成后自动注册的 fallback，并通过 host smoke 固定实际行为；
- `ctx.mcp.reload()` 失败不影响 CLI 兜底工具；
- 尊重用户已有同名 MCP 配置，不能静默覆盖非 Oceanus 管理的配置；
- 通过配置允许禁用 Oceanus 托管 MCP，但仍可保留 CLI 兜底；
- MCP 连接状态纳入 `/cbm status` 和首次查询诊断。

## CLI 兜底通道

通过 `ctx.tool.transform` 注册以下工具：

| 工具 | 底层命令 | 主要使用者 |
|---|---|---|
| `cbm_status` | `list_projects` / `index_status` | 所有需要确认状态的 agent |
| `cbm_index` | `index_repository` | Sisyphus Intake 与 Review 阶段 |
| `cbm_search_graph` | `search_graph` | explorer、oracle |
| `cbm_trace` | `trace_path`（兼容旧版本 alias：`trace_call_path`） | explorer、oracle、fixer 改前检查 |
| `cbm_code` | `get_code_snippet` | explorer、oracle |
| `cbm_query` | `query_graph` | oracle、架构分析 |
| `cbm_detect_changes` | `detect_changes` | oracle、改动影响面分析 |

所有 CLI 工具必须：

- 从当前 session 解析 workspace root；
- 默认限制查询深度、结果数量、输出字节数和执行时间；全量 `cbm_index` 使用独立的较长超时并报告进行中状态；
- 使用结构化 JSON 返回，不把原始 stderr 直接当作成功结果；
- 区分二进制缺失、项目未索引、查询失败、超时四类错误；
- 项目路径只能取当前 workspace 或显式允许的项目路径；
- 只读查询禁止写入源码；`cbm_index` 是唯一允许创建/更新索引的工具；
- `trace_path` 是 canonical CLI/MCP 工具名；仅对旧版本保留 `trace_call_path` alias 兼容；
- MCP 与 CLI 使用同一版本和 canonical `CBM_CACHE_DIR`，依赖 CBM 官方 admission barrier/项目锁协调，不在插件侧另起 daemon；
- 子进程采用环境变量白名单，只传 `CBM_CACHE_DIR`、必要的 UI/日志设置和显式用户配置，不继承 provider token。

## Agent 调度设计

### 主 agent 调度规则

在 `oceanus` 与 `sisyphus` 的系统提示词中加入以下分类规则：

```text
代码知识图谱调度：
- “在哪里定义/谁调用/调用了谁/依赖关系/修改影响/架构结构” -> 优先 CBM。
- 需要代码库上下文时，优先委派 explorer；需要影响面、架构或审查时委派 oracle。
- 委派检索任务时，明确要求返回 CBM 证据、qualified name、文件路径和行号。
- 代码开发、修改或查询任务进入 brainstorm 前，主 agent 先读取 `autoIndex`（无法读取时按 `true` 处理），执行一次 `cbm_status`；未索引且开启时执行 `cbm_index`。已索引、关闭、失败或状态未知均 fail-open，回退原生工具。
- Intake 阶段代码/混合任务由 Sisyphus 初始化；Review 开始时再次刷新；Brainstorm/Plan 不重复初始化。
- 字符串、注释、正则文本 -> grep/search_code，不使用 CBM 替代。
- AST 结构匹配 -> ast_grep_search，不使用 CBM 替代。
- 文件名/目录发现 -> glob/read，不使用 CBM 替代。
- 外部库资料 -> librarian 使用 websearch/webfetch；仅在本地代码交叉验证时使用 CBM。
```

`sisyphus` 四个阶段的动作边界：

| 阶段 | CBM 动作 |
|---|---|
| brainstorm | 仅做必要的架构/符号定位；不因普通文本探索触发全量索引 |
| plan | 使用已有初始化结果确定文件范围或影响面；不在此阶段重复触发索引 |
| execute | 高风险公共符号修改前做 trace/impact；普通机械修改不强制查询 |
| review | 对变更入口和影响面做独立验证；CBM 不可用时明确记录降级证据 |

阶段 skill 只能补充工作流步骤，不能覆盖上述 CBM 调度边界或把 CBM 强制用于不适合的文本/AST 任务。

### 子 agent 调度规则

#### explorer

优先级：

1. `cbm_search_graph` 定位函数、类、方法、接口和模块；
2. `cbm_trace` 追踪 inbound/outbound 调用；
3. `cbm_code` 获取关键符号源码；
4. `ast_grep_search` 做 AST 模式搜索；
5. `grep/glob/read` 处理文本、文件发现和 CBM fallback。

`explorer` 可调用上述只读查询工具，但不允许调用 `cbm_index`；索引初始化由主 agent 在 brainstorm 前完成。

输出必须包括：符号名、qualified name、文件路径、行号、调用方向、是否来自 CBM。

#### oracle

架构/调试/审查任务的固定顺序：

1. `cbm_code` 读取关键入口和目标符号；
2. `cbm_trace` 获取调用方、被调用方和关键深度；
3. `cbm_query` 或 `cbm_detect_changes` 评估影响面；
4. 再读取必要的上下文文件并给出判断；
5. CBM 证据不足时明确标记不确定性，不把图谱结果当作完整证明。

#### librarian

- 外部文档、官方 API、GitHub 示例仍使用 websearch/webfetch；
- 需要把外部结论映射到当前仓库时，使用 `cbm_search_graph`/`cbm_code` 定位本地实现；
- 不因本地代码问题而启动大范围 Web 搜索。

#### fixer

- 普通实现不强制调用 CBM；
- 涉及公共函数、接口、路由、配置契约或高风险重构时，修改前调用 `cbm_trace` 或
  `cbm_query`；
- 修改后由主 agent 或 oracle 再做一次影响面验证。

#### designer/observer

- 默认不调度 CBM；
- 只有涉及组件依赖、数据流或 UI 代码架构时才由主 agent 显式要求使用。

### 并行调度

CBM 查询是只读操作，可与独立检索 lane 并行：

- explorer：符号定位与调用链；
- oracle：影响面与架构判断；
- librarian：外部文档与版本资料。

每条后台任务必须声明自己的查询目标，避免多个 agent 对相同符号做完全重复的深度追踪。
主 agent 只汇总带有文件/行号/qualified name 的结果。

## 调用时机

### 必须优先调用 CBM

- 任务要求理解模块架构；
- 查找某个函数/类/接口/方法定义；
- 追踪调用方或被调用方；
- 评估修改的影响面；
- 查找死代码、低入度高影响符号或依赖边界；
- 分析 REST 路由和跨服务 HTTP 调用；
- 读取某个已知符号的完整源码；
- 计划阶段需要确定文件范围和变更边界。

### 不应调用 CBM

- 查找字符串、注释、TODO、FIXME、错误文本；
- AST 结构模式替换或语法重写；
- 只知道文件名或扩展名；
- 查官方文档或外部仓库；
- 处理图谱尚未覆盖的生成文件/临时文件；
- 需要实时文件内容但索引尚未同步。

### 生命周期调用时机

| 时机 | 动作 | 是否阻塞 |
|---|---|---|
| 插件首次加载 | 启动后台含 UI canonical release 安装 | 否 |
| 首次 CBM 调用前 | 等待安装 Promise | 是，仅对当前 CBM 调用 |
| 代码开发/修改/查询任务进入 brainstorm 前 | 读取 `autoIndex`（读取失败按 `true`），执行一次 `cbm_status` | 是，仅主 agent 一次 |
| 未索引且 `autoIndex=true` | 主 agent 自动 `cbm_index` | 是，仅一次 |
| 已索引、`autoIndex=false`、初始化失败或状态未知 | fail-open，回退原生工具 | 否 |
| 已索引项目文件变化后 | 交给 CBM watcher 增量同步 | 否 |
| 分支切换/大规模变更 | 可选 `detect_changes` 或显式重新索引 | 否/按命令 |
| 用户执行 `/cbm ui` | 启动 UI 进程 | 命令内等待启动确认 |
| 用户执行 `/cbm repair` | 清理并重装含 UI canonical release | 命令内等待 |

### 参数级工具示例

以下示例只使用已注册的 Oceanus 工具名；查询工具允许主 agent 与子 agent 使用，`cbm_index` 仅允许主 agent 使用：

```text
cbm_status({})
cbm_search_graph({ query: ".*OrderHandler.*", limit: 20 })
cbm_trace({ symbol: "pkg/orders.OrderHandler", direction: "inbound" })
cbm_code({ qualified_name: "pkg/orders.OrderHandler" })
cbm_query({ query: "MATCH (n) RETURN n LIMIT 20" })
cbm_detect_changes({ since: "HEAD~1" })
cbm_index({})                 # 仅主 agent
```

非代码文本、AST、glob/文件发现及 Web 任务跳过上述初始化和 CBM，分别使用 `grep`/`ast_grep_search`/`glob`/`websearch` 等原生工具。

### 失败回退链

```text
CBM MCP 原生工具
  -> cbm_* CLI 工具
    -> ast_grep_search / grep / glob / read
      -> 主 agent 标记“CBM 不可用或索引不完整”并继续任务
```

任何失败不能伪造“已完成索引”或“完整影响分析”。

## UI 设计

- 下载归档必须是官方 canonical 归档；UI 已内建于二进制，不再依赖独立 `-ui-` 文件名；
- MCP server 默认不带 `--ui=true`，避免端口和资源常驻；
- `/cbm ui` 启动同一缓存版本的 UI server；
- UI 启动参数以当前版本 CLI 帮助为准，基线为 `--ui=true --port=<port>`，不能凭空猜测参数；
- 默认监听 `127.0.0.1:9749`，支持 `ui.host`、`ui.port`、`ui.open` 配置；
- `/cbm ui stop` 停止 UI；
- `/cbm status` 显示 UI 状态、PID、端口和 URL；
- UI 进程只能由 Oceanus 启动的实例被自动停止，不能误杀用户手动启动的进程；
- 插件退出/服务重启时按平台清理自己持有的 UI 子进程。

## 配置草案

```jsonc
{
  "codebaseMemory": {
    "enabled": true,
    "autoDownload": true,
    "version": "0.10.8",
    "autoIndex": true,
    "indexOnStart": false,
    "mcp": true,
    "cliFallback": true,
    "guidance": true,
    "ui": {
      "enabled": true,
      "autoStart": false,
      "host": "127.0.0.1",
      "port": 9749,
      "open": false
    }
  }
}
```

默认值应满足：`autoDownload=true`、归档必须包含内建 UI、`autoStart=false`、
`autoIndex=true`、`mcp=true`、`cliFallback=true`、`guidance=true`。

## 验收标准

1. 全新机器仅安装 Oceanus，不执行任何用户手动安装命令，插件能自动下载官方 canonical 归档并完成校验；归档包含 UI 能力。
2. 下载中 OpenCode 能正常启动，普通 agent/tool 不被阻塞。
3. 首次 CBM 查询会等待安装完成；安装失败能明确诊断并回退 grep/read。
4. OpenCode `/mcp` 能看到 `codebase-memory-mcp`；安装完成后能调用 `search_graph`、`get_architecture`，并验证 MCP 自动注册或占位配置更新路径。
5. 子 agent 即使看不到 MCP，也能调用 `cbm_search_graph`、`cbm_trace`、`cbm_code`、`cbm_query`、`cbm_detect_changes` 只读工具完成查询；`cbm_index` 仅由主 agent 使用。
6. 首次结构化查询能自动完成项目索引；后续查询复用索引，不重复全量索引。
7. 含 UI 的 canonical 归档已下载但 UI 默认不启动；`/cbm ui` 能以 `--ui=true` 启动并在 `/cbm status` 显示 URL/PID。
8. 校验失败、网络失败、权限失败、索引失败、MCP 连接失败均不阻塞 Oceanus。
9. 字符串搜索、AST 搜索、文件发现和外部文档任务仍按原工具路由，不被 CBM 过度拦截。
10. 多 session 并发加载时只有一次下载、一次安装和一个受控 UI 实例；陈旧锁可恢复，缓存命中会重新校验。
11. 校验和来自插件内置 manifest；远程网络仅提供归档，不能替换校验信任根。
12. MCP 与 CLI 交替查询同一项目时共享缓存协调，不重复创建 daemon；`cbm_query` 拒绝写入型 Cypher。
