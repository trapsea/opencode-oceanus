# Spec：CBM 索引初始化职责迁移（brainstorm → plan）

> **状态：superseded**。六阶段流程与 Intake/Review CBM 规则以 `.oceanus/spec/sisyphus-intake-stage.md` 为权威。

## 问题

运行 sisyphus 实现需求时，未调用 codebase-memory 进行索引初始化。

## 根因

CBM 阶段边界（主 agent system prompt，`src/agents/sisyphus.ts:83-93`）明确约定：
- `brainstorm`：仅做符号定位（cbm_search_graph/cbm_trace），**不因普通文本探索触发全量索引**。
- `intake`：代码/混合任务由 `@metis` 直接 `cbm_index`；非代码跳过；Review 开始再次刷新，Brainstorm/Plan 不重复初始化。

但实际阶段 skill 与边界冲突：
- `src/skills/sisyphus-brainstorm.ts:19` 在步骤 1 内写了完整的索引初始化逻辑（读 autoIndex → cbm_status → 按需 cbm_index）——**违背边界**（brainstorm 不应触发全量索引），agent 按纪律会跳过。
- `src/skills/sisyphus-plan.ts` 不负责 CBM 初始化，消费 Intake/Brainstorm 结果即可。
- `src/skills/sisyphus-execute.ts` / `src/skills/sisyphus-review.ts` 无 CBM 边界步骤（仅靠主 agent prompt 兜底）。

被动兜底（查询型 CBM 工具 autoIndex 自动索引，`src/tools/cbm/cli.ts:357`）只在 agent 实际调用查询型工具时触发；用 grep/read 探索时不触发。

## 目标

- 索引初始化的主动触发点与 CBM 阶段边界一致：从 brainstorm 移除，放入 plan。
- 四阶段 skill 与主 agent prompt 的阶段边界一致，不再越界或缺位。
- 防回归：stages.test.ts 增加 CBM 契约断言。
- 同步重新 build `dist/index.js`。

## 验收标准

1. `sisyphus-brainstorm.ts` 不再包含 `cbm_index`/全量索引指令；步骤 1 只保留"符号定位 + 文本探索"。
2. `sisyphus-plan.ts` 明确包含：代码任务意图识别 → 读 autoIndex（无法读取默认 true）→ cbm_status → indexed 不索引、unindexed 且 autoIndex=true 才 cbm_index 一次；autoIndex=false/unknown/error 或非代码任务 fail-open/跳过；主 agent 派发并行 lane 前只初始化一次，子 agent 不重复。
3. `sisyphus-execute.ts` 明确包含 execute 阶段 CBM 边界（高风险公共符号修改前 trace/impact；普通机械修改不强制）。
4. `sisyphus-review.ts` 明确包含 review 阶段 CBM 边界（独立验证；不可用时记录降级证据）。
5. `src/skills/stages.test.ts` 新增 CBM 契约断言且通过：brainstorm 不含 `cbm_index`；plan 含 `cbm_status`+`cbm_index`+autoIndex 初始化语义；execute/review 含各自边界语义。
6. 重新 build 后 `dist/index.js` 中四个 skill 内容同步；`bun test`（至少 skills 相关套件）全绿。

## 边界与非目标

- 不修改主 agent system prompt 的 CBM 阶段边界文本（已是权威与正确）。
- 不改被动 autoIndex 自动索引机制（`src/tools/cbm`），避免双重/冲突索引。
- 不改 `.oceanus/` 目录与 gitignore 约定。
- 仅改四个 skill 的文案与对应测试断言 + rebuild；不引入新依赖。

## 反例与边界条件

- 非代码/纯文本/Web/AST/glob 任务：plan 不触发 cbm_status/cbm_index（fail-open/跳过），与现状一致。
- autoIndex=false/unknown/error：plan 阶段回退 grep/read，不调用 cbm_index。
- 子 agent：不重复初始化；初始化由主 agent 在派发并行 lane 前完成一次。

## Metis 分析

**Metis 已跳过**：本任务为小范围文案修复，诊断已完成、方案由既有 CBM 阶段边界直接确定，无未定型架构决策；改动面明确（4 个 skill + 1 个测试文件 + rebuild）。残余风险在验收标准中通过断言与测试覆盖。
