# codebase-memory-mcp（CBM）

Oceanus 将 CBM 作为可选的代码库结构化检索能力；CBM 不可用时不会阻塞 agent 注册或普通工具执行。

## 安装、下载与缓存

默认配置为 `codebaseMemory.enabled=true`、`autoDownload=true`、`version="0.10.8"`、`mcp=true`、`cliFallback=true`、`autoIndex=true`，`indexOnStart=false`。首次需要 CBM 时，插件可后台按需下载；并发调用共享同一安装任务，不会重复下载。

缓存根目录优先级为 `codebaseMemory.cacheDir` → 外部环境变量 `CBM_CACHE_DIR` → 平台默认：Unix 使用 `${XDG_CACHE_HOME:-~/.cache}/opencode-oceanus/codebase-memory-mcp/`，Windows 使用 `%LOCALAPPDATA%/opencode-oceanus/codebase-memory-mcp/`。插件 `setup` 完成后会固定本次 setup 的缓存根快照；之后即使环境或配置变化，当前实例也不会切换缓存根目录。也可设置 `codebaseMemory.cacheDir` 或 `CBM_CACHE_DIR`。已安装二进制解析顺序是显式 `binaryPath` → Oceanus 缓存 → PATH 上的 `codebase-memory-mcp`。

这里的缓存目录是**二进制安装缓存**，用于保存版本/平台归档、解压后的二进制及 `current.json`；它不是 CBM daemon 的数据目录。daemon 的索引、运行时状态等数据由 daemon 自己管理，不能把二者混同，也不要通过删除安装缓存来清理索引数据。

安装或修复不会仅凭文件存在就认为安装有效：会检查 `current.json`，确认其中的版本和平台与当前配置/运行平台匹配，并检查二进制存在且 `--version` 可执行、输出有效。任一检查失败都会重新安装（或返回诊断）。

daemon 按缓存根目录隔离。若已经运行的 daemon 使用了不同的 cache root，插件不会自动接管或复用它；请先关闭旧会话/daemon，再用目标缓存根目录重启。

下载归档来源固定为官方 DeusData 仓库：
`https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.10.8/`。
归档名按平台选择（Windows 为 `.zip`，其余平台为对应 `.tar.gz`）。每个平台的 canonical manifest 随插件提供受信任 SHA-256；下载完成后必须校验 64 位小写 SHA-256，校验失败会清理临时文件且不会写入 `current.json`。不要把旧的 `-ui-` 归档当作强制依赖；UI 是独立的按需能力。

### daemon 生命周期与连接自愈

CBM 0.10.8 的 daemon 有两种形态：**session-managed**（随最后一个客户端断开而退出）与 **permanent**（跨空闲与会话存活）。上游默认由首个客户端以 session-managed 模式拉起；只有 `codebase-memory-mcp daemon start` 能建立 permanent daemon，且当 session-managed daemon 已存在时该命令退化为 no-op（不会自动升级为 permanent）。

为避免宿主每次重启后 daemon 冷启动（及间歇性的「活着但不接受新客户端」30s 拒绝）导致的 MCP 连接失败，插件在 `setup` 的 `cbm-daemon` 阶段（先于 `mcp` 注册）执行**前台等待式 daemon 预热**：宿主重启、daemon 已死时执行 `codebase-memory-mcp daemon start` 并等待其返回（0.10.8 语义下 exit 0 即 daemon 已可服务——permanent 新建或幂等命中），随后 MCP reload 时宿主 spawn 的所有 stdio MCP server 均 connect-to-warm，不再有首个连接落在冷启动窗口内。就绪等待默认上限 15s（实测冷启动 3-4s），超时或失败一律 fail-open：记录日志、不阻塞其它能力，MCP 可能缺失但 CLI wrapper 兜底。二进制缓存缺失（首次安装/下载中）时预热保持后台非阻塞，MCP 走 disabled 占位，安装完成、启用 server 前会再次确保 daemon 就绪后再 reload。

wrapper 层另带有限自愈：当 CLI 报 `could not accept this client within`、版本/指纹冲突等 daemon 坏状态特征时，自动执行一次 `daemon stop` retire 后重试一次原调用（`daemon stop` 被 committed client 拒绝也无害——瞬时性 accept 拒绝靠直接重试即可恢复）。自愈最多一次，不循环。

## 权限与隐私

CBM 子进程使用受限环境变量白名单，不继承 provider token；调用参数使用参数数组而非 shell，并限制在工作区根目录内，拒绝越界路径。CBM 处理的是用户主动指定的本地代码库；插件不因启用集成而上传源码。网络下载仅访问上述 HTTPS GitHub release（如使用显式 `binaryPath`，可完全跳过下载）。请按组织策略审查 GitHub 访问、缓存目录权限和本地索引内容。

## codebase-memory-mcp 优先与 cbm wrapper 兜底

结构化代码发现默认使用宿主注册的 `codebase-memory-mcp` MCP server 原生工具：`search_graph`、`trace_path`、`get_code_snippet`、`detect_changes`（及 `index_status` 项目确认、只读 `get_graph_schema`/`query_graph`）。调用前必须先调用 `list_projects` 并用 `index_status({ project })` 确认当前 workspace 绝对 `root_path` 的唯一健康项目；没有匹配、存在多个匹配或 catalog 不可用时，不得猜测项目名，直接回退 `grep/read/glob`。direct 参数与 wrapper 字段不混用：

| 目的 | direct MCP（默认主通道） | 关键参数 |
|---|---|---|
| 结构化搜索 | `codebase-memory-mcp.search_graph` | `project`、`name_pattern` |
| 调用链 | `codebase-memory-mcp.trace_path` | `project`、`function_name`、`direction` |
| 符号源码 | `codebase-memory-mcp.get_code_snippet` | `project`、`qualified_name` |
| 影响面 | `codebase-memory-mcp.detect_changes` | `project`、`since`、`direction`、`depth` |

仅当会话 tool catalog 无 `codebase-memory-mcp`、`list_projects`/`index_status` 失败、传输/超时、工具缺失或明确参数协议拒绝时，才回退到 `cbm_*` wrapper（由 `src/cbm/registry.ts` 的 `CBM_TOOLS` 注册）：`cbm_search_graph(query)`、`cbm_trace(symbol, direction, depth)`、`cbm_code(qualified_name)`、`cbm_detect_changes(since, direction, depth)`、`cbm_status`；`cbm_trace` 使用 canonical `trace_path`，旧二进制才回退 `trace_call_path`。索引生命周期与 Cypher 保持 wrapper 专用：首次索引与 Review 刷新使用 `cbm_index`，Cypher 只使用 `cbm_query`（本地拦截写入型语句）。追踪前先定位 exact symbol；`cbm_trace.symbol` 传函数/方法名，不把 wrapper 字段 `symbol` 与 direct 字段 `function_name` 混用。未找到、歧义、空结果是业务结论：缩小搜索或返回诊断，不是切换通道的理由。两条通道均不可用时回退 `grep/read/glob`。

不得调用 `delete_project`、`ingest_traces`、`manage_adr` 或其他写入型 MCP 工具。

### depth 场景矩阵

`detect_changes` 与 `trace_path`（direct MCP 主通道；wrapper 兜底 `cbm_detect_changes`/`cbm_trace` 沿用相同 depth 语义）按场景显式传 `depth`：

| 工具 | 场景 | depth |
|---|---|---:|
| `detect_changes` | 单文件、局部或低风险变更 | 2 |
| `detect_changes` | 常规跨模块变更（默认） | 3 |
| `detect_changes` | 公共契约、权限、注册、生命周期或重构 | 4 |
| `trace_path` | 私有实现定位 | 1 |
| `trace_path` | 模块内调用核对 | 2 |
| `trace_path` | 公共函数、接口、路由或配置契约 | 3 |
| `trace_path` | 高风险跨层链路或重构 | 4 |

所有调用都显式传 `depth`。不自动使用 5；结果过多时缩小目标或降低深度。空结果不扩大深度，超时/传输/daemon 错误按 fallback 规则处理。

UI 默认 `enabled=true`、`autoStart=false`、`host="127.0.0.1"`、`port=9749`、`open=false`；因此只有显式 `/cbm ui` 或设置 `ui.autoStart=true` 才启动，不会自动打开浏览器。

## 配置示例

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
    "cacheDir": "/absolute/path/to/opencode-oceanus/codebase-memory-mcp",
    "ui": { "enabled": true, "autoStart": false, "host": "127.0.0.1", "port": 9749, "open": false }
  }
}
```

`cacheDir` 示例使用绝对路径；当前实现不会展开 `~`。省略该字段即可使用平台默认缓存目录。

字段位于用户级 `~/.config/opencode/opencode-oceanus.jsonc` 或项目级 `.opencode/opencode-oceanus.jsonc`；项目配置优先。未知字段会被 schema 拒绝。

## 失败回退与 Windows 降级

安装、MCP 注册、索引和 UI 操作均 fail-open：失败只返回可读诊断，不伪造索引结果，也不阻塞其它插件能力。direct MCP 出现 catalog 缺失、传输/超时、工具缺失或明确参数协议拒绝时，按「codebase-memory-mcp 优先与 cbm wrapper 兜底」一节回退 `cbm_*` wrapper；wrapper 的 `binary_missing`、`spawn_failed`、`timeout`、daemon/传输失败、`invalid_json` 属通道错误，与 direct 不可用同层处理。两条通道均不可用时回退 `grep/read/glob`。查询的空结果是业务结果，不得当作通道故障或跨项目重试。关闭 `autoIndex` 时查询不会自动索引，可调用受控的 `cbm_index`。

Windows 支持下载 `.zip`、`.exe` 二进制及缓存路径；若 Windows 上 `index_repository` 的索引器不可用或失败，插件报告降级并允许回退原生工具，不声称已完成完整索引。可使用有效 `binaryPath`、手动调用 `cbm_index` 或关闭 CBM 后继续工作。

## Agent 调度矩阵

CBM 沿六阶段工作流形成三阶段主线：

1. **Intake 首次初始化**：在任何代码调研开始之前，Intake 基于用户请求预判代码相关性并立即触发受控 `cbm_index`（预判非代码不触发）；正式分类后修正偏差（漏判补触发、误判记录不回滚）；失败、超时或 in-progress 均 fail-open 并记录。
2. **Discuss / Plan / Execute 查询**：优先 `codebase-memory-mcp`（direct，先 `list_projects` 确认唯一健康 project）；catalog 无该 server 或出现允许的通道错误时回退 `cbm_*` wrapper。复杂架构或高风险业务仍有未知时，Sisyphus 可按需咨询 Oracle advisory。
3. **Review 影响面复查**：开始时按实际 diff 判断是否以 `cbm_index` 刷新；索引后优先 direct `trace_path`/`detect_changes`，catalog 无该 server 或出现允许的通道错误时回退 `cbm_trace`/`cbm_detect_changes`。CBM 失败时记录 `cbm: stale`、降级工具、覆盖范围和残余风险，继续使用 grep/read 与手工 diff 复查；发现遗漏时解释或退回 execute。

查询型工具可由需要的 agent 使用；finish 阶段不调用 CBM，只读 Review 报告汇总。CBM 仅提供 advisory 证据，不是依赖门控、权限边界或完成事实；Ledger/Review schema 不得伪造宿主状态。

| Agent | CBM 使用建议 | 不可用时 |
|---|---|---|
| `oceanus` / `sisyphus` | 编排复杂任务，要求检索证据 | 明确记录降级证据 |
| `explorer` | 优先 `codebase-memory-mcp` 只读查询（确认唯一健康 project） | 通道不可用时 `cbm_search_graph`/`cbm_trace`/`cbm_code` 兜底，再 `read`/`grep`/`glob` |
| `librarian` | 外部文档研究，不依赖 CBM | 使用 `webfetch`/`websearch` |
| `oracle` | 复杂架构或高风险业务按需读取结构与调用链，为 spec/plan 提供 advisory | 静态检查并说明不确定性 |
| `fixer` | 逃生舱场景实现前按需查询，写入仍用受控编辑工具 | 依据原生检索工具实现 |
| `designer` / `observer` | UI/视觉任务按需使用 | 使用现有上下文；`observer` 需要视觉模型（默认启用） |

矩阵是调度约定而非运行时强制路由；agent 必须如实报告 CBM 不可用及回退路径。

调用示例：优先 codebase-memory-mcp 的 `search_graph({ project, name_pattern: ".*OrderHandler.*", limit: 20 })`、`trace_path({ project, function_name: "OrderHandler", direction: "inbound", depth: 3 })`、`get_code_snippet({ project, qualified_name: "pkg/orders.OrderHandler" })`、`detect_changes({ project, since: "HEAD~1", direction: "inbound", depth: 3 })`（project 先经 `list_projects` 按 `root_path` 确认）。索引初始化由 Sisyphus Intake 与 Review 的 `cbm_index` 负责；Cypher 使用 `cbm_query({ query: "MATCH (n) RETURN n LIMIT 20" })`。仅当 catalog 无 codebase-memory-mcp 或出现允许的通道错误时，才回退 wrapper 同义调用：`cbm_search_graph({ query: ".*OrderHandler.*", limit: 20 })`、`cbm_trace({ symbol: "OrderHandler", direction: "inbound", depth: 3 })`、`cbm_code({ qualified_name: "pkg/orders.OrderHandler" })`、`cbm_detect_changes({ since: "HEAD~1", direction: "inbound", depth: 3 })`。

### CBM CLI 参数契约

CLI fallback 统一使用当前 workspace 的目录名作为 `project`，不再使用完整路径拼接名称；建索引时同时传入 `name`，确保后续查询使用同一名称。已使用旧的全路径 project 名建立的索引需要重新调用 `cbm_index`。`search_graph`、`trace_path`、`get_code_snippet`、`query_graph`、`detect_changes` 和 `index_status` 最终只发送 `project` 加该操作支持的业务字段（`search_graph`/`trace_path`/`detect_changes`/`query_graph` 强制 `format: "json"`，因为 CLI 缺省输出人类可读 tree 文本）。`index_repository` 最终只发送 `repo_path` 与 `name`。所有路径字段（包括 `projectPath`、`repository_path`、`repo_path`、`project_path`、`path`、`workspace_root`）会在执行前校验不得越出 workspace 且不进入最终 payload；越界时不会启动任何 CBM 子进程。该路径保护属于 CLI wrapper；直接 MCP 必须按本节的 catalog 与 `root_path` 项目确认规则使用，不能把两者混为一谈。

## 后台任务通信协议（T5）

`oceanus` / `sisyphus` 与后台子任务之间的通信是拉取式（pull-based）协议：

- 不存在默认的 queue 完成通知：prompt 不得要求或暗示等待 queue 推送终态；沉默不代表完成。
- 宿主无法确认状态时返回 `verified:false` / `certainty:uncertain`，绝不伪装完成；跨 parent 访问统一返回 `PARENT_OWNERSHIP`。
