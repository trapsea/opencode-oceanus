# CBM Agent 使用规则与 Sisyphus 意图前置索引计划

## 已确认策略

- TDD：先写失败测试，再修改 prompt/permission/文档。
- 工作区：沿用当前共享工作区，不创建 worktree；并行任务文件范围完全不重叠。
- 索引时机：代码开发/修改/查询任务进入 brainstorm 前执行 `cbm_status`；仅当未索引且 `autoIndex=true` 时调用 `cbm_index`。失败、未知或关闭自动索引时 fail-open。
- `cbm_index` 由主编排 agent 执行；只读子 agent 仅使用查询型 CBM 工具。

## 任务

### CBM-GATE-01 Prompt 与 Sisyphus 意图前置规则

- **Wave**：1
- **Depends on**：—
- **Files**：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/agents/explorer.ts`、`src/agents/oracle.ts`、`src/agents/librarian.ts`、`src/agents/fixer.ts`、`src/skills/sisyphus-brainstorm.ts`、新增 `src/agents/cbm-usage.test.ts`
- **目标**：统一注册工具名；增加参数级调用示例；明确代码任务意图识别和 `cbm_status → cbm_index` 前置流程；Explorer 约束允许查询型 CBM；删除冲突的旧索引时机文案。
- **验证**：新增静态 prompt/skill 契约测试覆盖：代码任务规则中 `cbm_status` 位于条件性 `cbm_index` 之前；已索引/`autoIndex=false`/失败/未知均明确跳过或 fallback；非代码任务跳过；主 agent 在派发并行 lane 前初始化一次、子 agent 不重复；prompt 明确无法读取配置时使用默认 `autoIndex=true`；相关 agent/skill 测试通过。测试不声称执行真实工具调用。

### CBM-GATE-02 查询型 CBM 权限

- **Wave**：1
- **Depends on**：—
- **Files**：`src/config/constants.ts`、`src/agents/index.test.ts`
- **目标**：在只读默认 permission 中显式 allow `cbm_status`、`cbm_search_graph`、`cbm_trace`、`cbm_code`、`cbm_query`、`cbm_detect_changes`；对 `cbm_index` 显式 deny，避免只读子 agent 修改索引生命周期。
- **验证**：权限矩阵测试对 explorer/librarian/oracle/observer/metis/momus 逐一断言 6 个查询型工具为 `allow`、`cbm_index` 为 `deny`；显式 `agents.<name>.permission` 仍覆盖默认矩阵；现有只读/写入权限不回归。

### CBM-GATE-03 文档同步

- **Wave**：2
- **Depends on**：CBM-GATE-01、CBM-GATE-02
- **Files**：`README.md`、`docs/codebase-memory-mcp.md`、`.oceanus/spec/codebase-memory-mcp-integration.md`
- **目标**：补充意图识别前置索引规则、参数级示例、主 agent/子 agent 权限边界和 fail-open 行为；说明不对每个任务无条件重建，并修正旧集成规格中的索引时机、agent 工具名和裸 `detect_changes` 冲突文案。
- **验证**：关键词/default/tool 名称一致性检查；`git diff --check`。

### CBM-GATE-04 最终验证与完成审计

- **Wave**：3
- **Depends on**：CBM-GATE-01、CBM-GATE-02、CBM-GATE-03
- **Files**：只读审查全部变更文件
- **目标**：运行完整测试、类型检查、构建和 diff 检查；逐项核对规格验收标准。所有“调用顺序/去重”证据仅认定为静态 prompt 契约，不冒充真实运行时调用测试。
- **验证**：`bun test`、`bunx tsc --noEmit`、`bun run build`、`git diff --check` 全部通过，并完成以下 coverage matrix：
  - A1 工具名：Sisyphus/oceanus prompt 测试；
  - A2 查询权限：只读 agent permission 测试；
  - A3 参数示例：prompt 测试与文档关键词检查；
  - A4 意图前置：代码/非代码、status→index 顺序、已索引、autoIndex=false、失败 fallback、任务级去重测试；
  - A5 工具分工：现有 CBM-12 分工断言与全量 agent 测试；
  - A6 文档一致性：README/CBM docs 与实现常量、工具名、默认值检查。

## 调度批次

- Wave 1：CBM-GATE-01、CBM-GATE-02 并行，文件不重叠。
- Wave 2：CBM-GATE-03 串行执行，读取前两项最终规则。
- Wave 3：CBM-GATE-04 串行完成最终审计。

## Momus gate

- 状态：待 @momus 审核。
- 版本：round 1。
- Verdict：round 1/2 REJECT；round 3 OKAY。已补充旧规格同步、静态契约定义和显式 deny。审核时间：2026-08-26。
