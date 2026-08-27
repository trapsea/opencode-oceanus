# Plan：统一 CBM 缓存根并消除 daemon 目录冲突

## 状态

- TDD：严格 RED → GREEN → SURFACE
- Worktree：当前共享工作区
- 方案审查：待 @momus（二次）
- CBM：`cbm_index` 因 active/requested cache directory 冲突失败，按 fail-open

## 任务图

### Wave 1：RED

#### T1：补充缓存根一致性测试

- Files：`src/cbm/wiring.test.ts`、`src/cbm/mcp.test.ts`、`src/cbm/ui.test.ts`、`src/cbm/commands.test.ts`、`src/tools/cbm/builders.test.ts`、`src/cbm/indexer.test.ts`、`src/smoke/cbm-wiring.test.ts`
- Depends on：无
- Goal：先覆盖显式 `cacheDir`、外部 `CBM_CACHE_DIR`、XDG/default 优先级；验证 setup 快照不随环境变化，以及 install/MCP/UI/commands/buildCbmTools 不能被调用方覆盖 root。
- Validation：运行 `bun test src/cbm/wiring.test.ts src/cbm/mcp.test.ts src/cbm/ui.test.ts src/cbm/commands.test.ts src/tools/cbm/builders.test.ts src/cbm/indexer.test.ts src/smoke/cbm-wiring.test.ts` 并记录 RED；逐项记录入口 root、indexer root、优先级、builder 的 `cacheRoot/CBM_CACHE_DIR` 和覆盖防护断言。

#### T2：补充安装有效性与环境覆盖测试

- Files：`src/cbm/provision.test.ts`、`src/tools/cbm/cli.test.ts`
- Depends on：无
- Goal：覆盖 `provision/ensureInstalled` 的有效安装复用、manifest 损坏、版本/平台不匹配、二进制缺失或 `--version` 失败；验证相同 root+version 复用、不同 version/root 不复用；覆盖 CLI custom root、默认 root 冲突、PATH fallback 及子进程最终 `CBM_CACHE_DIR`。
- Validation：运行 `bun test src/cbm/provision.test.ts src/tools/cbm/cli.test.ts` 并记录逐项 RED；明确只有 `ensureInstalled` 执行健康检查，`defaultInstallStatus` 只报告 manifest/文件状态，不冒充健康检查。

### Wave 2：实现

#### T3：统一 resolvedCacheRoot 与所有入口注入

- Files：`src/cbm/wiring.ts`、`src/cbm/mcp.ts`、`src/cbm/provision.ts`、`src/cbm/indexer.ts`、`src/tools/cbm/index.ts`、`src/tools/cbm/builders.ts`、`src/tools/cbm/types.ts`、`src/tools/index.ts`、`src/index.ts`、`src/cbm/ui.ts`、`src/cbm/commands.ts`
- Depends on：T1、T2
- Goal：setup 只解析一次 `cacheDir > process.env.CBM_CACHE_DIR > getCacheRoot()`；安装、MCP、CLI、indexer、commands、UI 统一消费该值；MCP 注入共享 `ensureInstalled`，所有安装 Promise 绑定 `cacheRoot + version`；使用 `{ ...opts, cacheRoot: sharedRoot }` 或等价清洗逻辑禁止调用方覆盖；builders/types/tools 显式携带 root 并最终设置 `CBM_CACHE_DIR=sharedRoot`；MCP 已有二进制执行可注入健康检查，失败不启用。
- Validation：T1/T2 的入口一致性、恶意 root 覆盖、MCP 注入共享 `ensureInstalled`（wiring → index → registerCbmMcp）、共享 root/配置版本、健康成功/失败/autoDownload=false 和环境优先级测试 GREEN；typecheck 通过。

#### T4：修复 CLI 与底层路径的 custom root 查找

- Files：`src/tools/cbm/cli.ts`、`src/cbm/paths.ts`
- Depends on：T3
- Goal：`resolveCachedBinary`、manifest 和 binary 查找显式接收 resolved root；`buildCbmTools` 仅配置 custom `cacheDir` 时也把 root 传入 CLI/indexer；custom root 下正确命中，不隐式回退默认根；保留 PATH fallback 和 `binaryPath > cache root > PATH` 优先级。
- Validation：CLI custom-root 测试 GREEN；默认 root、binaryPath、PATH 优先级及 builder custom root 测试 GREEN。

### Wave 3：文档与全量验证

#### T5：同步文档、回归验证与构建

- Files：`README.md`、`docs/codebase-memory-mcp.md`、`dist/**`（生成且被 gitignore）；仅验证、不修改前序测试文件
- Depends on：T3、T4
- Goal：说明缓存根优先级、二进制缓存与 daemon 数据目录区别、旧 daemon 需重启；说明已有不同 root 的外部 daemon 只报告结构化错误，不自动接管/迁移/杀进程；完成全量测试、构建和 dist 验证。
- Validation：T5 明确作为 SURFACE 阶段执行：`bun test`、`bun run typecheck`、`bun run build`、既有 `verify-dist-skills.ts`，再运行 `git diff --check` 和指定文档 grep；所有命令成功、无路径分裂断言失败；记录 daemon 冲突诊断来自现有 CBM CLI 结构化错误，真实 daemon 验证仍可能受环境冲突影响。

## 约束

- 不删除 `CBM_CACHE_DIR`，不自动杀掉/迁移外部 daemon，不删除已有缓存。
- 显式 `codebaseMemory.cacheDir` 优先；否则使用外部 `CBM_CACHE_DIR`；最后才使用平台默认目录。
- 子任务不得修改 ledger、执行 git/Worktree 操作；并行任务文件范围不得重叠。

## Momus

- Verdict：待审查
- Revision：4；根据最终代码审查补充 MCP 共享安装注入、版本绑定、独立 buildCbmTools custom root 和 MCP 健康边界
