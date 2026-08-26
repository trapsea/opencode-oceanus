# 工具与运行时保护实现计划

## 策略

- TDD：先写纯逻辑和配置测试，再实现；v2 host 行为通过最小注册/执行 smoke test 验证。
- Worktree：共享工作区。Wave 1 只并行处理完全不重叠的文件范围；worker 不执行 `git add`、`git commit`、`git reset`、分支或 worktree 操作，也不修改声明范围外文件。
- 默认启用：所有本次新增 Tool/Hook 默认启用；`disabled_tools`、`disabled_hooks` 和单项 `enabled: false` 均可禁用，禁用列表优先。
- 来源策略：复用 omo-slim/openagent 的算法和测试思想，不复制 v1 client/session shim；所有运行时注册使用 Oceanus 原生 v2 API。
- 最终验证：`bun test`、`bun run typecheck`、`bun run build`，并执行 v2 Tool/Hook 注册 smoke test。

## 文件与依赖关系

```text
配置 schema/合并 ─┐
AST core ─────────┤
hashline core ────┤
四类 Hook core ───┤──> v2 Tool/Hook wiring ──> prompt/权限对齐 ──> 回归/文档
task registry core ┘                         └──> task session 集成
```

## 任务图

### Wave 1：独立核心模块

#### tooling-1-config

- 目标：扩展工具/Hook 配置 schema，实现 `disabled_tools`/`disabled_hooks`、单项 enabled 和 tools/hooks 深度合并。
- Files：`src/config/schema.ts`、`src/config/loader.ts`、`src/config/utils.ts`、新增 `src/config/tooling.test.ts`。
- Depends on：无。
- 验证：schema 严格校验、用户/项目深度合并、禁用列表优先级、默认启用和未知字段测试。

#### tooling-2-ast

- 目标：实现原生 v2 可调用的 AST-grep 核心执行器和参数/结果模型，支持 search、replace、dry-run、超时、输出上限、匹配上限、路径边界。
- Files：`package.json`、新增 `src/tools/ast-grep/**` 及对应测试。
- Depends on：无。
- 验证：参数校验、语言/路径/glob、超时、CLI 缺失、JSON 截断、search/replace/dry-run、工作区外路径拒绝测试。

#### tooling-3-hashline

- 目标：实现 `hashline_edit` 的 hash 锚点解析、replace/append/prepend、文件版本校验、稳定 diff 和 hash mismatch 错误。
- Files：新增 `src/tools/hashline-edit/**` 及对应测试。
- Depends on：无。
- 验证：hash 计算、范围编辑、重复/无效锚点、文件变化检测、空操作、换行格式、diff 和路径边界测试。

#### tooling-4-output-truncator

- 目标：实现工具结果截断纯逻辑，按工具/配置限制输出长度，保留错误、状态、task id、diff、hash mismatch 和截断标记。
- Files：新增 `src/hooks/tool-output-truncator.ts`、`src/hooks/tool-output-truncator.test.ts`。
- Depends on：无。
- 验证：工具级上限、默认上限、非文本结果、控制信息保留、截断标记幂等测试。

#### tooling-5-json-recovery

- 目标：实现 JSON 参数错误识别和恢复提示，移植 slim 的模式集合但适配 v2 `event.result` 形状。
- Files：新增 `src/hooks/json-error-recovery.ts`、`src/hooks/json-error-recovery.test.ts`。
- Depends on：无。
- 验证：错误模式、排除工具、重复 marker、非字符串结果和 v2 result 改写测试。

#### tooling-6-loop-guard

- 目标：实现按 session、tool、稳定参数和稳定结果统计的工具循环保护；task polling 工具必须豁免。
- Files：新增 `src/hooks/tool-loop-guard.ts`、`src/hooks/tool-loop-guard.test.ts`。
- Depends on：无。
- 验证：并发 before 不提前计数、结果变化重置、warn/block 阈值、session 清理、task_* 豁免和有界 session 数测试。

#### tooling-7-apply-patch

- 目标：实现 v2 `execute.before` 的 apply-patch 输入检查/保守重写；明确工作区外路径 fail-open 条件及其它错误 fail-closed 行为。
- Files：新增 `src/hooks/apply-patch.ts`、`src/hooks/apply-patch.test.ts`。
- Depends on：无。
- 验证：v2 `event.input` 读写、patchText 未知/无效输入、可修复 patch、工作区外路径、验证失败和异常策略测试。

#### tooling-8-task-registry

- 目标：实现受 session ownership 约束的轻量 task registry、task id、父子关系、状态索引、终态清理和上限控制；不在此任务伪造 v2 session 操作。
- Files：新增 `src/tools/task/registry.ts`、`src/tools/task/types.ts`、`src/tools/task/registry.test.ts`。
- Depends on：无。
- 验证：注册/解析、父 session ownership、状态更新、终态清理、容量上限、未知任务和跨 session 访问拒绝测试。

### Wave 2：原生 v2 集成

#### tooling-9-v2-wiring

- 目标：统一注册新增 Tools 和 Hooks，落实配置过滤、固定 Hook 顺序、错误隔离、工作区根目录解析，并实现 task_status/result/cancel 的 v2 session 集成。
- Files：`src/index.ts`、新增或更新 `src/tools/index.ts`、新增或更新 `src/hooks/index.ts`、必要的 `src/runtime/**`、新增 `src/tooling-registration.test.ts`。
- Depends on：tooling-1-config、tooling-2-ast、tooling-3-hashline、tooling-4-output-truncator、tooling-5-json-recovery、tooling-6-loop-guard、tooling-7-apply-patch、tooling-8-task-registry。
- 验证：Tool/Hook transform 注册、disabled 过滤、配置默认值、Hook 顺序、v2 event.input/result 映射、session canonical root、task interrupt/get/active ownership 和失败隔离测试。

#### tooling-10-agent-alignment

- 目标：更新 Agent prompt、权限和工具说明，使其使用实际 v2 工具名称；移除不存在能力的调用指令，补充 AST/hashline/task 的正确使用边界。
- Files：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、必要的 `src/agents/explorer.ts`、`src/agents/fixer.ts`、`src/agents/librarian.ts`、相关测试。
- Depends on：tooling-9-v2-wiring、tooling-9-fix-session-cancel。
- 验证：prompt 不再引用未注册工具、只读 Agent 不获得写工具、Sisyphus task polling 规则、Agent 配置覆盖和权限测试。

### Wave 3：集成验证与文档

#### tooling-11-regression

- 目标：补齐跨模块联动测试和 v2 host smoke test，验证 AST → edit protection、hashline → output、subagent → task registry、Hook 顺序和错误策略。
- Files：新增 `src/tooling-integration.test.ts`、必要的 smoke test 脚本和测试 fixture。
- Depends on：tooling-9-v2-wiring、tooling-9-fix-session-cancel、tooling-10-agent-alignment。
- 验证：`bun test`、最小 host smoke test、配置开关矩阵、Tool/Hook 注册数量和现有 Agent/TUI/command 回归。

#### tooling-12-docs

- 目标：更新配置示例、工具说明、权限建议、已知限制和 v2 smoke test 使用方式。
- Files：`README.md`、必要的 `docs/` 文档。
- Depends on：tooling-11-regression、tooling-2-fix-cli-detection。
- 验证：文档配置字段与 schema、工具名、默认启用策略和 task 范围一致。

#### tooling-13-final-verification

- 目标：执行完整验证并检查当前工作树差异，确认没有覆盖用户已有未提交修改。
- Files：无新增文件；只读检查全仓库。
- Depends on：tooling-11-regression、tooling-2-fix-cli-detection、tooling-6-fix-loop-guard-config、tooling-6-fix-loop-guard-array、tooling-7-fix-apply-patch-event、tooling-8-task-observer、tooling-12-docs。
- 验证：`bun test`、`bun run typecheck`、`bun run build`、git diff 审查、所有任务账本进入终态。

#### tooling-8-task-observer（Wave 3，task registry 生产链路修复）

- 目标：通过内部 `task_registry_observer` before/after Hook 观察宿主 `task`/`subagent` 调用，自动创建/更新 registry 记录；未知 host result 形状不猜测、不伪造完成，并让 task_result 只接受 verified host 完成或明确存储结果。
- Files：`src/config/schema.ts`、`src/hooks/index.ts`、新增 `src/runtime/task-observer.ts`、`src/runtime/task.ts`、`src/tools/task/types.ts`、`src/tools/task/registry.ts`、`src/tools/index.ts`、相关测试、必要 docs/spec。
- Depends on：tooling-8-task-registry、tooling-9-v2-wiring、tooling-6-fix-loop-guard-config。
- 验证：无手工注入 registry 的 task 生命周期测试；宿主 task/subagent before 创建记录、after 绑定 child/终态/结果；跨 session 拒绝；未知结果 fail-open；task_result verified 门禁；全量测试、类型检查和构建通过。

#### tooling-6-fix-loop-guard-array（Wave 3，评审修复）

- 目标：支持 v2 `Tool.Result.content` 文本数组追加循环告警，保持字符串 `content`/`output` 和阻断逻辑不变。
- Files：`src/hooks/tool-loop-guard.ts`、对应测试。
- Depends on：tooling-6-fix-loop-guard-config。
- 验证：数组文本项告警、marker 幂等、非文本项 fail-open、默认与自定义阈值回归。

#### tooling-7-fix-apply-patch-event（Wave 3，评审修复）

- 目标：将 apply-patch Hook 直接接收宿主 before event，确保整体替换 `event.input` 能传播给 v2 host，同时保留原地写回和 fail-open 语义。
- Files：`src/hooks/index.ts`、必要的 apply-patch/注册测试。
- Depends on：tooling-9-v2-wiring。
- 验证：宿主 event.input 被整体替换、只读输入 fail-open、校验失败仍 fail-closed、现有 apply-patch 回归。

#### tooling-6-fix-loop-guard-config（Wave 3，tooling-6 评审修复）

- 目标：让 `hooks.tool_loop_guard.warnAt`、`blockAt`、`maxSessions` 真正传入循环保护 Hook，并保持默认值与现有行为不变；告警文案使用实际 warn 阈值。
- Files：`src/hooks/tool-loop-guard.ts`、`src/hooks/index.ts`、对应测试和必要的集成断言。
- Depends on：tooling-6-loop-guard、tooling-11-regression。
- 验证：自定义阈值和 session 上限生效、默认值回归、task polling 豁免、warning 文案阈值一致；专项测试、全量测试、类型检查和构建通过。

#### tooling-2-fix-cli-detection（Wave 3，tooling-2 回归修复）

- 目标：让 AST CLI 路径解析在接受候选前验证 `--version` 输出确实包含 ast-grep，拒绝 GNU `sg/newgrp` 等同名程序；保持显式 `AST_GREP_BIN`、缓存、包和 PATH 的优先级。
- Files：`src/tools/ast-grep/constants.ts`、必要的 AST CLI 常量测试或回归测试。
- Depends on：tooling-2-ast、tooling-11-regression。
- 验证：伪造 `sg` 候选被拒绝、有效 ast-grep 候选被接受、旧 AST 集成测试在缺少 CLI 时明确跳过/不失败；`bun test`、类型检查和构建通过。

#### tooling-9-fix-session-cancel（Wave 2，tooling-9 修复）

- 目标：按 OpenCode v2 官方 `SessionContext.interrupt` 的 `Promise<void>` 语义修正 interrupt 适配和 task_cancel 成功判定；只有中断成功且宿主不再 active 时才更新 registry 为 cancelled。
- Files：`src/runtime/types.ts`、`src/runtime/workspace.ts`、`src/tools/index.ts`、`src/tooling-registration.test.ts`。
- Depends on：tooling-9-v2-wiring。
- 验证：void-return interrupt 被视为成功并传递 `continue:false`；显式失败/仍 active 不伪造 cancelled；task_cancel 回归、类型检查和构建通过。
