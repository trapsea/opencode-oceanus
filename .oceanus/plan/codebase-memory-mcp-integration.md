# codebase-memory-mcp 集成实施计划

## 范围

将包含内建 UI 的官方 canonical `codebase-memory-mcp` release 集成到 `opencode-oceanus`，包含：

- 首次插件加载后台自动下载与安装含 UI 的 canonical 归档；
- 官方 release 归档、平台识别、SHA-256 校验、原子安装、并发锁；
- OpenCode v2 `ctx.mcp.transform` 本地 MCP 注入；
- Oceanus `cbm_*` CLI 兜底工具；
- 项目索引状态、自动首次索引、失败回退；
- 按需启动/停止 UI；
- `/cbm` 命令；
- oceanus/sisyphus/explorer/oracle/librarian/fixer 的 CBM 调度规则；
- Hook 引导、诊断、文档和完整测试。

不包含：修改 codebase-memory-mcp 本体、实现新的图谱算法、默认启动 UI、将 CBM 用于纯文本或 AST 搜索。

## 已确认策略

- TDD：测试先行；每个核心模块先写失败测试，再实现。
- 工作区：当前共享工作区，不创建 worktree；同 Wave 只并行执行完全不重叠文件且无共享进程/缓存状态的任务，否则串行。
- 安装：首次插件加载后台安装；首次 CBM 调用等待同一个安装 Promise。
- 版本：默认固定当前官方支持的 `v0.10.8`；不能无条件依赖 latest。版本变更必须更新内置 platform manifest、校验和测试夹具。
- UI：官方 0.10.x 每个平台使用唯一 canonical 归档，UI 内建于二进制；默认只启动 MCP；`/cbm ui` 以 `--ui=true` 按需启动 `127.0.0.1:9749`。
- 降级：CBM 任一环节失败不阻塞 Oceanus，回退到 ast_grep_search、grep、glob、read。

## 目标文件映射

### 新增目录

```text
src/cbm/
  types.ts              # 配置、安装、索引、UI 状态契约
  constants.ts          # 默认版本、下载 URL、缓存目录、端口、限制
  paths.ts              # 平台与缓存路径解析
  manifest.ts           # canonical release 归档和内置 SHA-256 manifest
  provision.ts          # 后台安装、校验、解压、原子替换、锁、修复
  process.ts            # 二进制/UI 子进程管理
  mcp.ts                # ctx.mcp.transform 注入/更新/移除
  indexer.ts            # 索引状态、首次自动索引、状态缓存
  guidance.ts           # 调度提示和错误归一化
  ui.ts                 # UI 按需启动/停止/status
  commands.ts           # /cbm 命令实现
  index.ts              # CBM 模块聚合导出

src/tools/cbm/
  types.ts              # CLI 输入、输出和错误类型
  args.ts               # workspace 和 JSON 参数校验
  cli.ts                # cbm cli 子命令执行与 JSON 解析
  builders.ts           # cbm_* ToolDefinition 构造
  index.ts              # 工具导出
```

### 修改文件

```text
src/config/schema.ts       # codebaseMemory 配置、cbm_* 工具配置、cbm hook 配置
src/config/utils.ts        # CBM 配置读取和 enable 判断
src/config/loader.ts       # 保持深度合并覆盖规则，补充配置测试
src/agents/oceanus.ts      # 主 agent 的 CBM 调度策略
src/agents/sisyphus.ts     # 五阶段工作流中 CBM 调用时机
src/agents/explorer.ts     # 符号/调用链优先 CBM
src/agents/oracle.ts       # 影响面/架构/审查优先 CBM
src/agents/librarian.ts    # 本地代码交叉时使用 CBM
src/agents/fixer.ts        # 高风险修改前的 CBM 检查
src/tools/index.ts         # 注册 cbm_* 兜底工具
src/hooks/index.ts         # CBM 引导和索引健康 hook
src/index.ts               # setup 中接线 MCP、安装、命令、工具、hook
README.md                  # 自动安装、配置、命令、调度行为
package.json               # 如需新增运行时依赖，只允许经过评估后修改
```

## Wave 计划

### Wave 1：契约和纯函数基础

#### CBM-01 配置 schema 与默认值

- **目标**：增加 `codebaseMemory` 配置和 `cbm_*` 工具/hook 配置，固定严格校验和默认行为。
- **Files**：`src/config/schema.ts`、`src/config/utils.ts`、对应 `src/config/*.test.ts`。
- **Depends on**：无。
- **实现要点**：
  - `enabled`、`autoDownload`、`version`、`binaryPath`、`cacheDir`、`autoIndex`、`indexOnStart`；
  - `mcp`、`cliFallback`、`guidance`；
  - `ui.enabled`、`ui.autoStart`、`ui.host`、`ui.port`、`ui.open`；
  - 默认 `autoDownload=true`、UI `autoStart=false`、`autoIndex=true`；
  - 未知字段继续被 `.strict()` 拒绝；
  - 用户配置和项目配置按现有深度合并规则合并。
- **测试先行**：合法配置、默认值、未知字段拒绝、用户/项目覆盖、数组/对象合并。
- **验证证据**：配置单测通过；`bun run typecheck`。

#### CBM-02 平台路径和 release manifest

- **目标**：定义 canonical 归档平台映射、缓存目录、固定版本、下载 URL 和内置校验和契约。
- **Files**：`src/cbm/types.ts`、`src/cbm/constants.ts`、`src/cbm/paths.ts`、`src/cbm/manifest.ts`、对应测试。
- **Depends on**：无。
- **实现要点**：
  - 支持 macOS/Linux/Windows；架构映射 `arm64/aarch64`、`x64/amd64`；
  - 基线版本为 `v0.10.8`，归档名按官方 canonical release manifest，不强制 `-ui-` 后缀；
  - 0.10.x 的 UI 内建于每个平台唯一归档，manifest 记录 `uiBuiltIn=true`；
  - 复用官方安装脚本中 platform 规则，不复制其自动改写用户 agent 配置行为；
  - SHA-256 必须随插件版本内置，网络只提供归档；解析必须限制大小、校验 64 位十六进制格式并拒绝同名冲突 digest；
  - 版本 manifest 同时记录 archive、URL、sha256、binary 相对路径和 UI 能力；可选验证官方 Sigstore/SLSA bundle；
  - 开发/测试允许注入 manifest 和下载 URL，不访问真实网络。
- **测试先行**：平台映射、canonical 归档名、Windows 扩展名、拒绝不支持平台、URL 必须 HTTPS、manifest 缺失字段/超限/格式错误/冲突 digest、内建 UI 标志。
- **验证证据**：纯函数测试通过；Windows/macOS/Linux 夹具均覆盖。

#### CBM-01F codebaseMemory 深度合并

- **目标**：补齐用户级与项目级 `codebaseMemory` 配置的深度合并，特别是 `ui` 子对象，避免项目只覆盖 `ui.port` 时丢失用户的 `ui.host` 等字段。
- **Files**：`src/config/loader.ts`、`src/config/codebase-memory.test.ts` 或对应 loader 测试。
- **Depends on**：CBM-01。
- **实现要点**：在现有 `mergePluginConfigs` 中对 `codebaseMemory` 使用 `deepMerge`，保持数组/标量覆盖语义；schema 校验和默认补齐继续由 CBM-01 提供。
- **测试先行**：用户级和项目级 codebaseMemory/ui 分别设置字段时合并结果完整，显式项目值优先，现有配置行为不变。
- **验证证据**：配置与 loader 单测通过；`bunx tsc --noEmit`。

#### CBM-02F 官方 release 事实修正

- **目标**：修正 CBM-02 中经官方资料复核发现的仓库 URL 与归档架构 token，确保下载地址可用。
- **Files**：`src/cbm/types.ts`、`src/cbm/constants.ts`、`src/cbm/manifest.ts` 及对应测试。
- **Depends on**：CBM-02。
- **实现要点**：release 基址固定为 `https://github.com/DeusData/codebase-memory-mcp/releases/download`；canonical 资产使用 `darwin/linux/windows` + `arm64/amd64`，Windows 使用 `.zip`，其余使用 `.tar.gz`；保留 Node `win32/x64` 等内部平台映射。
- **测试先行**：断言六平台归档文件名、官方 URL、平台 token 与 manifest URL。
- **验证证据**：`bun test src/cbm`、`bunx tsc --noEmit`。

#### CBM-03 CLI 执行器和错误模型

- **目标**：实现安全、可测试的 `codebase-memory-mcp cli <tool> <json>` 执行基础设施。
- **Files**：`src/cbm/process.ts`、`src/tools/cbm/types.ts`、`src/tools/cbm/args.ts`、`src/tools/cbm/cli.ts`、对应测试。
- **Depends on**：CBM-01F、CBM-02F。
- **实现要点**：
  - 二进制解析顺序为 `binaryPath` → Oceanus 缓存 → PATH；
  - 所有进程使用 `spawn` 参数数组，不拼接 shell 字符串；
  - workspace root 强制来自 `resolveWorkspaceRoot`；
  - 超时、退出码、空 stdout、非 JSON stdout、stderr、进程不存在分别建模；
  - 输出字节数、查询结果数量和调用超时有默认上限；
  - `cbm_index` 使用独立的较长超时并返回 `indexing in progress` 状态；
  - `ensureInstalled()` 接入后，多个调用共享同一个 Promise。
- **测试先行**：成功 JSON、错误 JSON、超时、ENOENT、非零退出、超大输出、路径越界、环境变量白名单、并发调用只触发一次安装、MCP/CLI 共享缓存协调。
- **验证证据**：CLI 单测通过；无真实网络、无真实进程依赖。

#### CBM-04 Agent 调度提示契约

- **目标**：先定义各 agent 的 CBM 调度规则和输出证据格式，避免实现阶段 prompt 漂移。
- **Files**：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/agents/explorer.ts`、`src/agents/oracle.ts`、`src/agents/librarian.ts`、`src/agents/fixer.ts`、对应 agent 测试。
- **Depends on**：CBM-01F。
- **实现要点**：
  - “定义/调用/依赖/影响/架构”优先 CBM；
  - “字符串/注释”走 grep；“AST 模式”走 AST-Grep；“文件名”走 glob；外部资料走 Web；
  - explorer：search → trace → code → fallback；
  - oracle：code → trace → query/detect_changes → 审查；
  - librarian：外部资料优先 Web，本地交叉才用 CBM；
  - fixer：高风险公共符号修改前做 trace/impact，普通小改动不强制；
  - 输出必须带 qualified name、文件路径、行号和 CBM 可用性说明。
- **测试先行**：生成的 system prompt 包含调度规则、降级规则、非 CBM 场景规则；自定义 prompt 覆盖行为保持现有语义。
- **验证证据**：agent prompt 单测通过。

### Wave 2：安装和生命周期

#### CBM-05 含 UI canonical release 自动 provision

- **目标**：实现首次启动后台下载含 UI 的 canonical 归档、校验、解压、原子安装、版本复用、repair。
- **Files**：`src/cbm/provision.ts`、`src/cbm/manifest.ts` 如需补充、对应测试和测试夹具。
- **Depends on**：CBM-02F、CBM-03。
- **实现要点**：
  - `setup()` 触发后台任务，不 await；
  - 内置 `v0.10.8` 六平台 SHA-256：darwin-amd64 `2b193085410af3801634a522f4b17dcd6699695e015a068393c87817c1d260d4`、darwin-arm64 `9bd840dfb3ec7eaef4f310382057adaa5b0e904df883104d03ffcf39836afd07`、linux-amd64 `e5cba4cad6ca8254a85f45041fc8a831908d7d5cb64f98fc3f8eb70a58671793`、linux-arm64 `5697d986d9716c913163b4bff7b3a294287f3b843e993bc1ff71e78dcdc21781`、windows-amd64 `b43ad982994c4d829670749e08d3b622a74bb20041fc0a7d02bef6113f81c34d`、windows-arm64 `254b26e819f00bab7f430c5f809d37d22b07bb3eb6427e290e5a27ba5b8e983e`；
  - 临时文件 `.partial`，完成后 SHA-256 校验；
  - 临时目录解压并验证二进制存在、可执行、`--version` 可运行；
  - 原子替换 current manifest；失败不覆盖旧版本；
  - 安装锁覆盖下载→校验→解压→替换全流程，记录 owner PID/创建时间并支持陈旧锁接管；
  - 缓存命中前重新校验 current manifest SHA-256，并执行 `--version` 健康检查；
  - 解压前拒绝绝对路径、`..` 路径和越界 archive member；
  - 只记录阶段、版本、平台、错误码，不记录敏感环境变量；
  - 支持 `repair` 清理临时/损坏目录后重试；
  - 不调用官方 `install` 自动改写用户 agent 配置，避免与 Oceanus MCP 注入重复。
- **测试先行**：成功安装、缓存命中重校验、校验失败、归档损坏、旧版本保留、并发下载、陈旧锁恢复、断点临时文件、权限错误、路径穿越、模拟 `--version` 失败。
- **验证证据**：provision 单测通过；使用本地 fixture 完成一次完整 tar/zip 安装模拟。

#### CBM-06 索引生命周期和自动首次索引

- **目标**：在首次结构化查询前检查项目状态，并按配置自动初始化索引。
- **Files**：`src/cbm/indexer.ts`、`src/cbm/guidance.ts`、对应测试。
- **Depends on**：CBM-03、CBM-05。
- **实现要点**：
  - `list_projects`/`index_status` 结果规范化；
  - 按 workspace root 做 session 级状态缓存；
  - `autoIndex=true` 时只对首次需要 CBM 的项目调用一次 `index_repository`；
  - 并发首次查询共享同一个 indexing Promise；
  - 未索引且自动索引关闭时返回操作性提示并允许 fallback；
  - 不在插件启动阶段全量索引，除非显式 `indexOnStart=true`；
  - 索引后的增量同步交给 CBM watcher。
- **测试先行**：已索引命中、未索引自动建图、并发只建图一次、自动索引失败降级、项目切换隔离。
- **验证证据**：索引生命周期单测通过。

#### CBM-07 UI 按需进程管理

- **目标**：使用已安装的 canonical 二进制按需启动/停止 Web UI，默认不启动。
- **Files**：`src/cbm/ui.ts`、对应测试；复用 CBM-03/05 已提供的 process/provision 接口，不修改 `src/cbm/process.ts`。
- **Depends on**：CBM-05。
- **实现要点**：
  - 默认 host `127.0.0.1`、port `9749`；
  - `/cbm ui` 使用 `--ui=true --port=<port>` 启动 UI，支持端口占用诊断和配置端口；
  - `/cbm ui stop` 只停止 Oceanus 自己持有的 PID；
  - `/cbm status` 输出 UI 状态、PID、URL；
  - 记录 owner marker，避免误杀用户手动进程；
  - 插件 cleanup 或服务重启时清理自己创建的子进程；
  - `open=true` 只作为可选行为，不能阻塞命令成功。
- **测试先行**：默认不启动、启动成功、端口冲突、stop ownership、重复启动复用、异常退出状态回收。
- **验证证据**：UI 进程管理单测通过；使用 mock spawn，不启动真实浏览器。

### Wave 3：MCP、工具和命令接线

#### CBM-08 MCP 注册器

- **目标**：通过 `ctx.mcp.transform` 注入本地 `codebase-memory-mcp` MCP server。
- **Files**：`src/cbm/mcp.ts`、`src/cbm/index.ts`、对应测试、`src/runtime/types.ts` 类型扩展。
- **Depends on**：CBM-01、CBM-05。
- **实现要点**：
  - `command: [binaryPath]`，不使用 shell；
  - 若 host 接受缺失 command 的 disabled local server，先注入 `disabled: true` 占位配置；安装完成后更新 command/environment、设置 `disabled: false`，最多执行一次 `ctx.mcp.reload()`；
  - 若 host 不接受占位配置，使用安装完成后自动注册的 fallback，并由 host smoke 固定行为；
  - 注入 `CBM_CACHE_DIR` 和必要的 UI/daemon 环境变量，采用环境变量白名单；
  - 同名 server 尊重 Oceanus 管理 marker，不静默覆盖未知来源配置；
  - 支持 `mcp=false` 时只保留 CLI fallback；
  - transform/reload 失败只影响 MCP，不影响 CLI 工具；
  - cleanup 时移除只由 Oceanus 管理的 server，不删除用户自有配置。
- **测试先行**：draft.set 参数、禁用配置、同名配置保护、reload 失败隔离、binary 缺失不注册。
- **验证证据**：MCP 注册单测通过；使用 fake MCP draft。

#### CBM-09 CLI 兜底工具

- **目标**：注册 `cbm_status/index/search_graph/trace/code/query/detect_changes`，供所有 agent 使用。
- **Files**：`src/tools/cbm/builders.ts`、`src/tools/cbm/index.ts`、`src/tools/index.ts`、`src/config/schema.ts`、对应测试。
- **Depends on**：CBM-03、CBM-06。
- **实现要点**：
  - 工具名称不与原生 MCP 工具冲突；
  - `cbm_trace` 映射 canonical `trace_path`，仅对旧版本兼容 `trace_call_path` alias；`cbm_detect_changes` 映射 `detect_changes`；
  - `cbm_status` 不触发索引；`cbm_index` 显式触发索引；查询型工具通过 indexer 进行首次状态检查；
  - 所有路径/参数经过 schema 和 workspace 校验；
  - `cbm_query` 默认只允许只读 Cypher 子集，拒绝写入型语句；
  - 输出截断沿用 Oceanus `tool-output-truncator`；
  - 工具注册失败独立容错，不能阻塞已有工具。
- **测试先行**：每个 builder 输入校验、工具调用映射、错误归一化、禁用配置、输出限制。
- **验证证据**：工具注册单测、tooling registration 测试通过。

#### CBM-10 `/cbm` 命令

- **目标**：提供自动安装后的可见运维入口。
- **Files**：`src/cbm/commands.ts`、`src/commands.ts` 如需抽象、`src/index.ts` 接线、对应测试。
- **Depends on**：CBM-05、CBM-06、CBM-07、CBM-08。
- **命令语义**：
  - `/cbm`：显示安装、版本、MCP、索引、UI 状态；
  - `/cbm install`：等待/触发自动安装并注册 MCP；
  - `/cbm repair`：清理损坏安装并重新下载含 UI 的 canonical 归档；
  - `/cbm index`：索引当前 workspace；
  - `/cbm ui`：启动 UI；
  - `/cbm ui stop`：停止 Oceanus 持有的 UI；
  - `/cbm uninstall`：仅移除 Oceanus 管理的 MCP/进程/缓存，不删除用户索引，除非显式确认参数。
- **测试先行**：命令路由、状态输出、失败消息、reload、UI ownership、不会转发原 prompt 额外字段。
- **验证证据**：commands 单测通过。

### Wave 4：Agent 调度与 Hook

#### CBM-11 调度引导 Hook

- **目标**：在合适时机提示 CBM，但不拦截合法原生搜索。
- **Files**：`src/hooks/index.ts`、`src/cbm/guidance.ts`、`src/config/schema.ts`、对应测试。
- **Depends on**：CBM-06、CBM-09。
- **实现要点**：
  - 首次结构化查询前执行 index health check；
  - 检测已索引项目中对 grep/read 的重复探索时给 advisory hint；
  - 字符串/注释、AST、glob 场景不提示或降低提示强度；
  - CBM 错误归一化为“未安装/未索引/不可用/查询失败”；
  - hook 独立注册、fail-open；
  - 防止同一 session 重复提示。
- **测试先行**：触发条件、去重、CBM 不可用、文本/AST 排除、hook 失败不阻塞。
- **验证证据**：hook 单测和 host smoke 测试通过。

#### CBM-12 Agent 调度规则接线

- **目标**：将 CBM 调度规则写入各 agent system prompt，并保持自定义 prompt 行为兼容。
- **Files**：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/agents/explorer.ts`、`src/agents/oracle.ts`、`src/agents/librarian.ts`、`src/agents/fixer.ts`、对应测试。
- **Depends on**：CBM-04、CBM-09、CBM-11。
- **实现要点**：
  - 主 agent 在 Understand/Path Selection/Delegation 阶段分类 CBM 调度；
  - explorer 负责符号和调用链；oracle 负责影响面和架构；librarian 负责本地交叉；fixer 负责高风险改前检查；
  - 将 CBM 结果作为证据而非绝对事实，要求文件/行号/qualified name；
  - 明确 CBM 与 grep/glob/read/AST-Grep/Web 的边界；
  - 明确 sisyphus brainstorm/plan/execute/review 四阶段的 CBM 动作边界；阶段 skill 不能覆盖调度规则；
  - 保持用户自定义 prompt 的完全覆盖/追加语义。
- **测试先行**：各 agent prompt 关键段、四阶段动作表、skill 不覆盖调度规则、禁用 agent、preset、覆盖 prompt。
- **验证证据**：agent/index、config、prompt 单测通过。

### Wave 5：入口集成、文档与验证

#### CBM-13 setup 接线和资源清理

- **目标**：将安装、MCP、工具、hook、命令和 cleanup 按正确顺序接入插件入口。
- **Files**：`src/index.ts`、`src/runtime/types.ts`、`src/cbm/index.ts`、`src/cbm/mcp.ts`/`paths.ts` 如需缓存根接线、对应 smoke 测试。
- **Depends on**：CBM-08、CBM-09、CBM-10、CBM-11、CBM-12。
- **接线顺序**：
  1. 加载配置；
  2. 计算 resolved `cacheDir`，启动后台 `startBackgroundInstall()`；
  3. 注册 agents/skills；
  4. 非阻塞注册 MCP 占位配置，并让安装完成后自动更新/启用；
  5. 注册 CLI fallback tools，传入共享 `ensureInstalled`、indexer 和 `CBM_CACHE_DIR`；
  6. 注册 guidance hooks，复用同一 indexer/安装依赖；
  7. 注册 `/cbm`；
  8. 返回 cleanup，停止 Oceanus 自有 UI/清理资源。
- **实现要点**：每个子系统独立 try/catch；安装/MCP失败不得阻塞现有 agent/tool/skill；安装完成后自动更新 MCP 配置并最多 reload 一次；测试 reload 对已有 MCP 的影响。
- **测试先行**：setup 顺序、后台安装不阻塞、首次调用等待、失败降级、cleanup。
- **验证证据**：`host-smoke`、`tooling-registration`、`tooling-integration` 全部通过。

#### CBM-14 端到端安装与多平台测试夹具

- **目标**：验证“用户无需手动安装，自动获取含 UI 的 canonical 归档”这一核心验收目标。
- **Files**：`src/smoke/*`、`src/cbm/*.test.ts`、`test-fixtures/cbm/`、必要的测试脚本。
- **Depends on**：CBM-05、CBM-07、CBM-08、CBM-13。
- **测试范围**：
  - Linux x64 当前平台真实归档格式模拟；
  - macOS arm64/x64 和 Windows x64 的 manifest/路径模拟；
  - 内置 manifest checksum 正确/错误、远程 checksum 不能替换信任根；
  - 首次后台安装与并发 session；
  - MCP draft 注册；
  - MCP 占位→安装完成自动启用、reload 最多一次；
  - 子 agent CLI fallback；
  - MCP 与 CLI 交替查询同一项目，不重复创建 daemon；
  - Windows `index_repository` 上游已知限制的明确降级行为；
  - UI 按需启动/停止；
  - 网络失败、权限失败、端口冲突和二进制损坏。
- **验证证据**：不依赖外网的完整集成测试通过；如配置真实 release smoke，必须显式环境变量开启，默认 CI 不访问网络。

#### CBM-15 文档、配置示例和第三方声明

- **目标**：让用户知道插件会自动下载含 UI 的 canonical 归档、缓存位置、权限、UI 命令、配置和回退行为。
- **Files**：`README.md`、必要的 `THIRD_PARTY_NOTICES.md`、配置样例文件和版本常量。
- **Depends on**：CBM-05、CBM-07、CBM-10、CBM-12。
- **内容**：自动安装流程、网络/磁盘要求、SHA-256 校验、UI 访问、`/cbm` 命令、关闭方式、隐私说明、故障诊断、CBM 调度矩阵。
- **验证证据**：README 示例与 schema/defaults 一致；第三方许可证和 release 来源明确。

## 依赖图与调度批次

```text
CBM-01 -> CBM-01F
CBM-01F -> CBM-03, CBM-04
CBM-02 -> CBM-02F
CBM-02F -> CBM-03, CBM-05
CBM-03 -> CBM-05, CBM-09
CBM-04 -> CBM-12
CBM-05 -> CBM-06, CBM-07, CBM-08, CBM-10, CBM-14, CBM-15
CBM-06 -> CBM-09, CBM-10, CBM-11
CBM-07 -> CBM-10, CBM-14, CBM-15
CBM-08 -> CBM-10, CBM-13, CBM-14
CBM-09 -> CBM-10, CBM-11, CBM-12, CBM-13
CBM-10 -> CBM-13, CBM-15
CBM-11 -> CBM-12, CBM-13
CBM-12 -> CBM-13, CBM-15
CBM-13 -> CBM-14
```

共享工作区下的安全批次：

- **Batch 1**：CBM-01、CBM-02 可并行；文件完全不重叠。
- **Batch 2**：CBM-01F 串行补齐配置深度合并。
- **Batch 3**：CBM-02F 串行修正官方 release 事实；随后 CBM-03 与 CBM-04 可并行，CBM-03 依赖 CBM-01F/02F，CBM-04 依赖 CBM-01F，文件完全不重叠。
- **Batch 4**：CBM-05 完成后，CBM-06、CBM-07、CBM-08 可并行；CBM-07 不修改 `process.ts`，三者测试均使用 mock，避免真实缓存、端口和进程共享。
- **Batch 5**：CBM-09 与 CBM-10 串行，避免同时修改工具/命令入口。
- **Batch 6**：CBM-11 串行完成；它修改 guidance/hook，是 CBM-12 的前置条件。
- **Batch 7**：CBM-12 串行完成，再执行 CBM-13 接线。
- **Batch 8**：CBM-14、CBM-15 可并行，均只读最终接口；之后统一验证。

## 全局验收命令

```bash
bun run typecheck
bun test
bun run build
```

额外验收：

1. 全新缓存目录下启动插件，不预装 `codebase-memory-mcp`，确认后台下载含 UI 的 canonical 归档；
2. 验证内置 platform manifest 的 SHA-256；网络不能替换校验信任根；
3. 首次 CBM 查询自动等待安装并完成项目索引；
4. `/mcp` 能发现 `codebase-memory-mcp`；
5. 子 agent 使用 `cbm_*` 完成符号搜索和调用链查询；
6. `/cbm ui` 启动 UI，`/cbm status` 显示 URL/PID，`/cbm ui stop` 只停止自有进程；
7. 模拟网络、校验、权限、索引和端口失败，Oceanus 仍可用并回退原生工具；
8. 检查 git diff，确认没有下载二进制、缓存或生成目录进入仓库。

## 未决实现约束

- 首个实现 Wave 必须固定 `v0.10.8`（或经复核后更新的受支持版本），并将对应 archive/sha256 内置到 Oceanus platform manifest，不能把运行时 `latest` 或远程 `checksums.txt` 当作唯一信任根。
- 需要确认当前 OpenCode host 对 `ctx.mcp.transform` 注入 server 的生命周期行为；单元测试用 fake draft，集成测试用 host smoke 验证。
- UI 进程基线参数为 `--ui=true --port=<port>`，仍必须以固定版本发布二进制 `--help` 与 host smoke 验证。
- 需要将官方 Windows `index_repository` 已知缺陷纳入降级说明；不得把 Windows CLI fallback 误报为完整成功。
