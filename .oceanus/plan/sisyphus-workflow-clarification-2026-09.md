# Sisyphus 工作流与 Skill 契约澄清实现计划

**目标**：把已确认的工作流决策落到 Skill、协议、文档和校验测试。
**Spec**：`.oceanus/spec/sisyphus-workflow-clarification-2026-09.md`

## 全局约束

- 保留当前工作区既有改动，不执行 git add/commit/reset，不创建 worktree。
- TDD 开启：先补契约测试并确认 RED，再修改实现。
- 只读 agent 不写代码；本任务不满足 fixer 逃生舱三条件，主 agent 串行实现。
- 不改变 OpenCode v2 宿主 API 和 Skill 注入方式。

## 任务

### Task 1：新增契约测试

**Files**：
- Create: `src/skills/workflow-clarification.test.ts`
- Modify: `src/skills/finish.test.ts`

**Validation**：`bun test src/skills/workflow-clarification.test.ts src/skills/finish.test.ts`

### Task 2：统一协议与阶段 Skill

**Files**：
- Modify: `src/skills/types.ts`
- Modify: `src/skills/index.ts`
- Modify: `src/skills/oceanus-workflow.ts`
- Modify: `src/skills/oceanus-intake.ts`
- Modify: `src/skills/oceanus-brainstorm.ts`
- Modify: `src/skills/oceanus-execute.ts`
- Modify: `src/skills/oceanus-review.ts`
- Modify: `src/skills/oceanus-finish.ts`
- Modify: `src/skills/oceanus-orchestration.ts`

**Validation**：对应契约测试、`bun run typecheck`。

### Task 3：文档与校验同步

**Files**：
- Modify: `README.md`
- Modify: `docs/codebase-memory-mcp.md`
- Modify: `scripts/verify-dist-skills.ts`

**Validation**：README/Skill 结构校验、`bun run build`、`bun run check:dist`。

## 影响面预估

- SkillDefinition 增加元数据字段会影响所有 Skill 注册对象；
- FinishInput 变化会影响 finish 测试与调用方；
- README/CBM 文档只影响文档契约；
- dist 校验需要同步新的阶段语义和支持型 Skill 分类。

## 进度

- Task 1: completed
- Task 2: completed
- Task 3: completed

## 状态

completed；三项任务均已完成并通过最终 Review。
