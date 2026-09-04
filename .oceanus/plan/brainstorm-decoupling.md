# Brainstorm Skill 通用化与阶段解耦计划

## 状态

基础职责迁移已完成：Intake 负责五项执行配置批问，Brainstorm 已支持以用户描述与背景调研作为输入，并保留可选的 `intake_report` 兼容路径。B1 已完成，B2 的完整通用化、Oceanus 路由和最终审计仍待后续执行。

## 目标

将 `oceanus-brainstorm` 从 Sisyphus 六阶段流程中的专属阶段 Skill，解耦为可由 `oceanus` agent 或其它调用方直接使用的通用方案探索 Skill；同时保持 Sisyphus 的 Intake、Brainstorm、Plan 顺序和门禁语义不变。

## 已确认决策

- 五项执行配置（Metis/Momus/SDD/TDD/连续执行授权）由 `oceanus-intake` 完整询问、默认值回落并写入 `intake_report.execution_config`。
- `oceanus-brainstorm` 始终保留方案总批准 question，但不再询问执行配置。
- Brainstorm 支持独立调用，不强制依赖 `intake_report` 或 `oceanus-plan`。
- Sisyphus 仍可把 Intake 报告作为 Brainstorm 的一种输入；Plan 继续消费已批准的 Brainstorm 输出。

## 范围

- `src/skills/oceanus-intake.ts`：成为执行配置批问的唯一 Skill 归属。
- `src/skills/oceanus-brainstorm.ts`：抽象为通用上下文输入、研究/澄清、方案输出和方案总批准。
- `src/skills/oceanus-plan.ts`：仅消费已批准方案与配置结果，不触发配置重复询问。
- `src/agents/sisyphus.ts`：仅保留六阶段编排、配置交接和门禁依赖，不复制 Brainstorm 内部流程。
- `src/agents/oceanus.ts`：补充按用户请求调用通用 Brainstorm 的路由说明。
- 相关 Skill 契约测试、README 与工作流文档。

## 非目标

- 不改变五项配置的推荐规则、question 工具交互或状态值。
- 不移除方案总批准，不将批准职责移入 Plan。
- 不改变 Metis、Momus、SDD、TDD 的实际执行语义。
- 不新增运行时工具、命令或宿主 API。

## 目标接口

### `oceanus-intake`

输入用户请求和项目上下文，输出包含以下字段的 `intake_report`：

- 需求、范围、非目标、验收信号和风险；
- 任务类型与复杂度；
- `execution_config`：五项配置的选择、推荐值、依据、回落记录；
- 可选的项目/CBM 上下文；
- 面向下游的交接信息。

### `oceanus-brainstorm`

输入改为通用 `brainstorm_context`，可包含用户请求、项目上下文、已有研究、约束、可选 `intake_report` 和可选 `execution_config`。输出 `brainstorm_report`：

- 已澄清需求与剩余问题；
- 研究证据和不确定性；
- 一个或多个候选方案及权衡；
- 推荐方案；
- 方案总批准结果；
- 是否需要 spec、由调用方决定的落盘建议。

独立调用缺少执行配置时，Brainstorm 不擅自推测配置；仅在调用方明确要求且提供配置时消费，缺失则把“配置未提供”作为输出限制，而不是重新接管 Intake 职责。

## 实施任务

### B1：收紧 Intake 配置契约

- 补充 `execution_config` 的结构化字段、五项推荐规则和回落语义。
- 增加测试断言：五项配置只出现在 Intake 契约中，报告必须包含配置结果。
- 验证：`bun test src/skills`、`bun run typecheck`。

### B2：抽象 Brainstorm 输入输出

- 移除对 `intake_report` 的硬性依赖，改为通用上下文输入。
- 保留研究优先、方案分层和始终执行的方案总批准。
- 移除 spec 强制落盘和 Sisyphus 专属阶段表述，改由调用方决定。
- 验证独立上下文、带 Intake 上下文、缺少配置三种测试场景。

### B3：清理 Sisyphus 编排重复协议

- `sisyphus.ts` 只声明 Intake → Brainstorm → Plan 的依赖和配置交接。
- 删除 Brainstorm 批问的旧重复描述，Plan 只引用 Intake 配置结果。
- 验证不得重复执行五项配置 question，门禁状态和 Plan-Change 规则保持有效。

### B4：接入 Oceanus 通用路由

- 在 `oceanus.ts` 增加何时调用 `oceanus-brainstorm` 的通用路由规则。
- 明确调用者提供上下文、是否需要方案总批准以及是否保存 spec；当前默认策略仍要求方案总批准。
- 增加 prompt 组合和路由测试。

### B5：文档与兼容性审计

- 更新 README、工作流审查文档及相关协议注释。
- 扫描旧的“Brainstorm 执行配置批问”“强制 intake_report/plan 输入”等表述。
- 保持 Skill 注册名称 `oceanus-brainstorm` 不变。
- 验证：`bun run check`、`bun run typecheck`、`bun test`、`bun run build`、`bun run check:dist`。

## 依赖与顺序

B1 → B2 → B3/B4 → B5。B3 与 B4 文件范围可分离时可并行，否则串行集成。

## 风险与回滚

- 配置状态丢失：以 `execution_config` 必填字段和 Intake/Plan 回归测试防护。
- 独立 Brainstorm 越权推测配置：缺少配置时必须显式报告限制，不自行 question。
- Sisyphus 门禁回归：保留方案总批准和 Plan 的 Momus 双门禁测试。
- 文档与实现不一致：完成全仓旧职责词扫描和构建产物检查；可按 B1-B5 单任务回滚。

## 验收标准

1. 五项执行配置只由 Intake 询问并进入 `intake_report.execution_config`。
2. Brainstorm 不再重复询问执行配置，始终执行方案总批准。
3. Brainstorm 可在无 Intake/Plan 的独立上下文中运行，不推测缺失配置。
4. Sisyphus 流程仍保持 Intake → Brainstorm → Plan 顺序，Plan 正确消费配置和批准结果。
5. Oceanus agent 可按通用请求调用 Brainstorm。
6. 全量测试、类型检查、构建、Skill 与文案检查通过。
