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

## 权限与隐私

CBM 子进程使用受限环境变量白名单，不继承 provider token；调用参数使用参数数组而非 shell，并限制在工作区根目录内，拒绝越界路径。CBM 处理的是用户主动指定的本地代码库；插件不因启用集成而上传源码。网络下载仅访问上述 HTTPS GitHub release（如使用显式 `binaryPath`，可完全跳过下载）。请按组织策略审查 GitHub 访问、缓存目录权限和本地索引内容。

## 工具与 `/cbm` 命令

注册的 Oceanus 工具名为：`cbm_status`、`cbm_index`、`cbm_search_graph`、`cbm_trace`、`cbm_code`、`cbm_query`、`cbm_detect_changes`；该清单的唯一来源是 `src/cbm/registry.ts` 的 `CBM_TOOLS`。其中 `cbm_trace` 使用 canonical `trace_path`；遇到仅支持旧版 `trace_call_path` 的二进制时才回退。`cbm_query` 仅接受只读 Cypher。

内置命令：

```text
/cbm status                 # 查看缓存、安装及 UI 状态（不触发安装）
/cbm install                # 后台安装（立即返回状态）
/cbm repair                 # 强制修复并等待
/cbm index                  # 为当前工作区索引
/cbm ui                     # 按配置启动 UI
/cbm ui stop                # 停止本插件持有的 UI
/cbm uninstall              # 移除 Oceanus 管理的 MCP/UI 资源
```

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

安装、MCP 注册、索引和 UI 操作均 fail-open：失败只返回可读诊断，不伪造索引结果，也不阻塞其它插件能力。CBM CLI 缺失、超时、非零退出、无效/超大 JSON 输出都会作为结构化错误返回；关闭 `autoIndex` 时查询不会自动索引，可先运行 `/cbm index`。

Windows 支持下载 `.zip`、`.exe` 二进制及缓存路径；若 Windows 上 `index_repository` 的索引器不可用或失败，插件报告降级并允许回退原生工具，不声称已完成完整索引。可使用有效 `binaryPath`、手动 `/cbm index` 或关闭 CBM 后继续工作。

## Agent 调度矩阵

CBM 沿六阶段工作流形成三阶段主线：

1. **Intake 初始化**：代码或混合任务由 Sisyphus 直接调用一次 `cbm_index`（非代码任务跳过）；失败、超时或 in-progress 均 fail-open 并记录。这是全工作流唯一初始化点，Brainstorm/Plan 不重复初始化，普通文本探索不触发全量索引。
2. **Momus 影响面预估（plan 门禁）**：`@momus` 审查计划时，对计划声明的修改文件/公共符号用查询型 CBM 排查影响面——`cbm_search_graph` 定位符号 → `cbm_trace` 查调用方/被调用方 → 必要时 `cbm_code` 读源码；发现计划未声明的受影响调用方/契约 → REJECT 并列出具体符号。预估结论（受影响符号与差异）记入 plan status，供 Review 阶段对比。momus 只做查询、不重建索引；CBM 不可用时标注不确定性、不虚构影响面，简单任务跳过预估需记录理由。
3. **Review 影响面复查**：开始即调用 `cbm_index` 重建索引（execute 已修改代码），再对实际 diff 用 `cbm_trace`/`cbm_detect_changes` 再次排查影响面，并与 plan status 中 momus 的预估对比：一致 → 记为验证证据；不一致（新调用方受影响/预估遗漏）→ 解释或退回 execute；CBM 不可用时明确记录降级证据。

查询型工具可由需要的 agent 使用；finish 阶段不调用 CBM，只读 Review 报告汇总。CBM 仅提供 advisory 证据，不是依赖门控、权限边界或完成事实；Ledger/Review schema 不得伪造宿主状态。

| Agent | CBM 使用建议 | 不可用时 |
|---|---|---|
| `oceanus` / `sisyphus` | 编排复杂任务，要求检索证据 | 明确记录降级证据 |
| `explorer` | 优先 `cbm_search_graph`、`cbm_trace`、`cbm_code` 等只读查询 | 回退 `read`/`grep`/`glob` |
| `librarian` | 外部文档研究，不依赖 CBM | 使用 `webfetch`/`websearch` |
| `oracle` / `metis` / `momus` | 按需读取结构与调用链 | 静态检查并说明不确定性 |
| `fixer` | 实现前按需查询，写入仍用受控编辑工具 | 依据原生检索工具实现 |
| `designer` / `observer` | UI/视觉任务按需使用 | 使用现有上下文；`observer` 默认禁用 |

矩阵是调度约定而非运行时强制路由；agent 必须如实报告 CBM 不可用及回退路径。

参数示例：`cbm_status({})`、`cbm_search_graph({ query: ".*OrderHandler.*", limit: 20 })`、`cbm_trace({ symbol: "pkg/orders.OrderHandler", direction: "inbound" })`、`cbm_code({ qualified_name: "pkg/orders.OrderHandler" })`、`cbm_query({ query: "MATCH (n) RETURN n LIMIT 20" })`、`cbm_detect_changes({ since: "HEAD~1" })`；索引初始化由 Sisyphus Intake 与 Review 阶段负责。

### CBM CLI 参数契约

CLI fallback 统一使用当前 workspace 的目录名作为 `project`，不再使用完整路径拼接名称；建索引时同时传入 `name`，确保后续查询使用同一名称。已使用旧的全路径 project 名建立的索引需要重新执行 `/cbm index`。`search_graph`、`trace_path`、`get_code_snippet`、`query_graph`、`detect_changes` 和 `index_status` 最终只发送 `project`。`index_repository` 最终只发送 `repo_path` 与 `name`。所有路径字段（包括 `projectPath`、`repository_path`、`repo_path`、`project_path`、`path`、`workspace_root`）会在执行前校验不得越出 workspace；越界时不会启动任何 CBM 子进程。

## 后台任务通信协议（T5）

`oceanus` / `sisyphus` 与后台子任务之间的通信是拉取式（pull-based）协议：

- 终态确认必须通过 `task_status` / `task_result` 显式查询；宿主事实（session active / outcome）优先于 registry 本地观察，registry 只是索引。
- 不存在默认的 queue 完成通知：prompt 不得要求或暗示等待 queue 推送终态；沉默不代表完成。
- `task_result` 只读终态：宿主已确认 running 时旧 observation 的终态一律不返回；宿主已确认终态时以宿主 outcome 为准；任务被 revive（generation 递增）后，旧 generation 的结果以 `STALE_GENERATION` 拒绝。
- 宿主无法确认状态时返回 `verified:false` / `certainty:uncertain`，绝不伪装完成；跨 parent 访问统一返回 `PARENT_OWNERSHIP`。
