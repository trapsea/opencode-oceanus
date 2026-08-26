# codebase-memory-mcp（CBM）

Oceanus 将 CBM 作为可选的代码库结构化检索能力；CBM 不可用时不会阻塞 agent 注册或普通工具执行。

## 安装、下载与缓存

默认配置为 `codebaseMemory.enabled=true`、`autoDownload=true`、`version="0.10.8"`、`mcp=true`、`cliFallback=true`、`autoIndex=true`，`indexOnStart=false`。首次需要 CBM 时，插件可后台按需下载；并发调用共享同一安装任务，不会重复下载。

默认缓存位置由平台决定：Unix 使用 `${XDG_CACHE_HOME:-~/.cache}/opencode-oceanus/codebase-memory-mcp/`，Windows 使用 `%LOCALAPPDATA%/opencode-oceanus/codebase-memory-mcp/`。也可设置 `codebaseMemory.cacheDir` 或 `CBM_CACHE_DIR`。已安装二进制解析顺序是显式 `binaryPath` → Oceanus 缓存 → PATH 上的 `codebase-memory-mcp`。

下载归档来源固定为官方 DeusData 仓库：
`https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.10.8/`。
归档名按平台选择（Windows 为 `.zip`，其余平台为对应 `.tar.gz`）。每个平台的 canonical manifest 随插件提供受信任 SHA-256；下载完成后必须校验 64 位小写 SHA-256，校验失败会清理临时文件且不会写入 `current.json`。不要把旧的 `-ui-` 归档当作强制依赖；UI 是独立的按需能力。

## 权限与隐私

CBM 子进程使用受限环境变量白名单，不继承 provider token；调用参数使用参数数组而非 shell，并限制在工作区根目录内，拒绝越界路径。CBM 处理的是用户主动指定的本地代码库；插件不因启用集成而上传源码。网络下载仅访问上述 HTTPS GitHub release（如使用显式 `binaryPath`，可完全跳过下载）。请按组织策略审查 GitHub 访问、缓存目录权限和本地索引内容。

## 工具与 `/cbm` 命令

注册的 Oceanus 工具名为：`cbm_status`、`cbm_index`、`cbm_search_graph`、`cbm_trace`、`cbm_code`、`cbm_query`、`cbm_detect_changes`。其中 `cbm_trace` 使用 canonical `trace_path`；遇到仅支持旧版 `trace_call_path` 的二进制时才回退。`cbm_query` 仅接受只读 Cypher。

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

| Agent | CBM 使用建议 | 不可用时 |
|---|---|---|
| `oceanus` / `sisyphus` | 编排复杂任务，要求检索证据 | 明确记录降级证据 |
| `explorer` | 优先 `cbm_search_graph`、`cbm_trace`、`cbm_code` | 回退 `read`/`grep`/`glob` |
| `librarian` | 外部文档研究，不依赖 CBM | 使用 `webfetch`/`websearch` |
| `oracle` / `metis` / `momus` | 按需读取结构与调用链 | 静态检查并说明不确定性 |
| `fixer` | 实现前按需查询，写入仍用受控编辑工具 | 依据原生检索工具实现 |
| `designer` / `observer` | UI/视觉任务按需使用 | 使用现有上下文；`observer` 默认禁用 |

矩阵是调度约定而非运行时强制路由；agent 必须如实报告 CBM 不可用及回退路径。
