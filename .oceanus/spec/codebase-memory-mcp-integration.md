# Oceanus 集成 codebase-memory-mcp 设计规格

## 目标

在不要求用户手动安装的前提下，将 `codebase-memory-mcp` UI 版本完整集成到
`opencode-oceanus`：

- 插件首次加载时后台自动下载并安装 UI 版本；
- 通过 OpenCode v2 `ctx.mcp.transform` 注入本地 MCP；
- 通过 Oceanus 工具注册提供 CLI 兜底，确保子 agent 在无法继承 MCP 时仍能查询；
- 在主 agent 与检索型子 agent 中固化调用调度规则；
- 在首次需要结构化代码检索时自动初始化项目索引；
- UI 版本始终下载，但 Web UI 只按需启动；
- 安装、校验、启动、索引失败时不阻塞 Oceanus，回退到 grep/glob/read/AST-Grep。

## 已确认决策

1. 采用插件托管的完整集成方案，不依赖用户预先安装二进制。
2. 安装时机为首次插件加载后台安装；插件启动不等待下载完成。
3. 首次 CBM 调用前必须等待同一个安装 Promise；安装失败时给出诊断并降级。
4. 下载 `codebase-memory-mcp` 的 UI 版本，而不是标准版本。
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
    │   ├── UI 版 release 下载
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
2. Oceanus 私有缓存中的 UI 版二进制；
3. 系统 `PATH` 中已有的 `codebase-memory-mcp`；
4. 若均不存在，下载 UI 版到 Oceanus 私有缓存。

### 缓存位置

- macOS/Linux：`$XDG_CACHE_HOME/opencode-oceanus/codebase-memory-mcp/`，否则
  `~/.cache/opencode-oceanus/codebase-memory-mcp/`；
- Windows：`%LOCALAPPDATA%/opencode-oceanus/codebase-memory-mcp/`。

缓存按版本和平台隔离，至少包含：

```text
<cache>/
├── versions/<version>/<platform>/codebase-memory-mcp
├── versions/<version>/<platform>/ui-assets/...
├── downloads/<archive>.partial
├── manifests/<version>-<platform>.json
├── install.lock
└── current.json
```

### 下载与安全

- 默认固定到经过验证的 release 版本，不直接无条件跟随 latest；
- 从官方 GitHub release 下载 UI 版平台归档；
- 下载到 `.partial`，完成后校验 SHA-256；
- 校验成功后解压到临时目录，再原子 rename 到版本目录；
- 校验失败删除临时文件，不覆盖当前可用版本；
- 安装锁采用创建锁文件或等价机制，多个 session 共享同一个安装 Promise；
- 二进制权限在 Unix 下设置为可执行；
- Windows 处理 `.exe` 与归档格式；
- 下载、校验、解压、启动过程禁止把 token、源码或路径之外的敏感环境变量写入日志。

### 后台安装状态机

```text
idle -> resolving -> downloading -> verifying -> extracting -> ready
                                      └──────> failed
任何状态 -> cancelled/failed -> fallback
```

要求：

- `setup()` 触发后台安装但不 await；
- 状态由进程级单例维护，避免每个 session 重复下载；
- 首次 CBM MCP/CLI 调用 await `ensureInstalled()`；
- 安装失败只影响 CBM，不能阻塞 agent、普通工具和 Oceanus 启动；
- `/cbm repair` 清理损坏临时文件并重新安装；
- 已有有效当前版本时直接复用，不重复下载。

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

- 只在二进制解析成功后注册；
- `ctx.mcp.reload()` 失败不影响 CLI 兜底工具；
- 尊重用户已有同名 MCP 配置，不能静默覆盖非 Oceanus 管理的配置；
- 通过配置允许禁用 Oceanus 托管 MCP，但仍可保留 CLI 兜底；
- MCP 连接状态纳入 `/cbm status` 和首次查询诊断。

## CLI 兜底通道

通过 `ctx.tool.transform` 注册以下工具：

| 工具 | 底层命令 | 主要使用者 |
|---|---|---|
| `cbm_status` | `list_projects` / `index_status` | 所有需要确认状态的 agent |
| `cbm_index` | `index_repository` | 主 agent、explorer、维护命令 |
| `cbm_search_graph` | `search_graph` | explorer、oracle |
| `cbm_trace` | `trace_call_path` | explorer、oracle、fixer 改前检查 |
| `cbm_code` | `get_code_snippet` | explorer、oracle |
| `cbm_query` | `query_graph` | oracle、架构分析 |

所有 CLI 工具必须：

- 从当前 session 解析 workspace root；
- 默认限制查询深度、结果数量、输出字节数和执行时间；
- 使用结构化 JSON 返回，不把原始 stderr 直接当作成功结果；
- 区分二进制缺失、项目未索引、查询失败、超时四类错误；
- 项目路径只能取当前 workspace 或显式允许的项目路径；
- 只读查询禁止写入源码；`cbm_index` 是唯一允许创建/更新索引的工具；
- 重复调用同一个查询不应在插件侧额外创建 daemon。

## Agent 调度设计

### 主 agent 调度规则

在 `oceanus` 与 `sisyphus` 的系统提示词中加入以下分类规则：

```text
代码知识图谱调度：
- “在哪里定义/谁调用/调用了谁/依赖关系/修改影响/架构结构” -> 优先 CBM。
- 需要代码库上下文时，优先委派 explorer；需要影响面、架构或审查时委派 oracle。
- 委派检索任务时，明确要求返回 CBM 证据、qualified name、文件路径和行号。
- CBM 未索引时，计划阶段自动触发一次 cbm_index；不能索引时回退 grep/read。
- 字符串、注释、正则文本 -> grep/search_code，不使用 CBM 替代。
- AST 结构匹配 -> ast_grep_search，不使用 CBM 替代。
- 文件名/目录发现 -> glob/read，不使用 CBM 替代。
- 外部库资料 -> librarian 使用 websearch/webfetch；仅在本地代码交叉验证时使用 CBM。
```

### 子 agent 调度规则

#### explorer

优先级：

1. `cbm_search_graph` 定位函数、类、方法、接口和模块；
2. `cbm_trace` 追踪 inbound/outbound 调用；
3. `cbm_code` 获取关键符号源码；
4. `ast_grep_search` 做 AST 模式搜索；
5. `grep/glob/read` 处理文本、文件发现和 CBM fallback。

输出必须包括：符号名、qualified name、文件路径、行号、调用方向、是否来自 CBM。

#### oracle

架构/调试/审查任务的固定顺序：

1. `cbm_code` 读取关键入口和目标符号；
2. `cbm_trace` 获取调用方、被调用方和关键深度；
3. `cbm_query` 或 `detect_changes` 评估影响面；
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
| 插件首次加载 | 启动后台 UI 版安装 | 否 |
| 首次 CBM 调用前 | 等待安装 Promise | 是，仅对当前 CBM 调用 |
| 首次结构化查询前 | `cbm_status` 检查项目索引 | 是，仅一次缓存结果 |
| 项目未索引且 `auto_index=true` | 自动 `cbm_index` | 是，仅首次 |
| 项目未索引且自动索引关闭 | 返回可操作提示，回退原生工具 | 否 |
| 已索引项目文件变化后 | 交给 CBM watcher 增量同步 | 否 |
| 分支切换/大规模变更 | 可选 `detect_changes` 或显式重新索引 | 否/按命令 |
| 用户执行 `/cbm ui` | 启动 UI 进程 | 命令内等待启动确认 |
| 用户执行 `/cbm repair` | 清理并重装 UI 版 | 命令内等待 |

### 失败回退链

```text
CBM MCP 原生工具
  -> cbm_* CLI 工具
    -> ast_grep_search / grep / glob / read
      -> 主 agent 标记“CBM 不可用或索引不完整”并继续任务
```

任何失败不能伪造“已完成索引”或“完整影响分析”。

## UI 设计

- 下载归档必须是 UI 版本；
- MCP server 默认不带 `--ui`，避免端口和资源常驻；
- `/cbm ui` 启动同一缓存版本的 UI server；
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
    "version": "0.6.0",
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

默认值应满足：`autoDownload=true`、UI 归档强制开启、`autoStart=false`、
`autoIndex=true`、`mcp=true`、`cliFallback=true`、`guidance=true`。

## 验收标准

1. 全新机器仅安装 Oceanus，不执行任何用户手动安装命令，插件能自动下载 UI 版本并完成校验。
2. 下载中 OpenCode 能正常启动，普通 agent/tool 不被阻塞。
3. 首次 CBM 查询会等待安装完成；安装失败能明确诊断并回退 grep/read。
4. OpenCode `/mcp` 能看到 `codebase-memory-mcp`，且至少能调用 `search_graph`、`get_architecture`。
5. 子 agent 即使看不到 MCP，也能调用 `cbm_*` 兜底工具完成符号搜索和调用链查询。
6. 首次结构化查询能自动完成项目索引；后续查询复用索引，不重复全量索引。
7. UI 版本已下载但默认不启动；`/cbm ui` 能启动并在 `/cbm status` 显示 URL/PID。
8. 校验失败、网络失败、权限失败、索引失败、MCP 连接失败均不阻塞 Oceanus。
9. 字符串搜索、AST 搜索、文件发现和外部文档任务仍按原工具路由，不被 CBM 过度拦截。
10. 多 session 并发加载时只有一次下载、一次安装和一个受控 UI 实例。
