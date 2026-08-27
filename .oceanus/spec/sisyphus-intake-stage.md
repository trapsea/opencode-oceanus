# Spec：新增 Sisyphus Intake 阶段并刷新 Review 前 CBM 索引

## 状态

已获用户确认，当前进入实现计划；本文件仍是设计约束，不包含实现代码。

## 背景

当前 Sisyphus 流程为：

```text
brainstorm → plan → execute → review → finish
```

CBM 初始化位于 Plan 阶段，但项目背景、用户原始需求和任务类型应在任何方案设计前先完成识别。并且 Execute 期间可能发生代码变更，Review 阶段如果继续使用旧索引，CBM 查询结果可能不是当前工作区的最新结果。

## 目标

1. 在最前面新增独立的 `sisyphus-intake` 阶段。
2. 将原有流程顺延为：

   ```text
   intake → brainstorm → plan → execute → review → finish
   ```

3. 由 Sisyphus 直接负责 Intake 阶段的背景了解、需求 intake、任务分类和 CBM 初始化。
4. 代码任务在 Intake 阶段直接初始化或重建当前项目的 CBM 索引。
5. 在 Review 阶段开始时再次重建当前项目的 CBM 索引，保证后续影响面和符号查询基于最新工作区。
6. 将 Intake 结果作为后续 Brainstorm 的输入。

## Intake 阶段职责

`sisyphus-intake` 是新的 Phase 1，职责固定为：

1. 了解项目背景和当前工作区，包括项目结构、相关配置、已有实现和当前变更状态。
2. 读取用户原始需求，完成最小需求 intake；只补齐进入后续阶段所必需的目标、范围和验收信息，不提前做技术方案决策。
3. 判断任务类型：代码任务、非代码任务或混合任务。
4. 对代码任务直接调用 CBM 初始化/重建能力，确保当前项目索引可用于后续查询；非代码任务不触发 CBM 初始化。
5. 将背景、需求摘要、任务类型、CBM 状态和降级信息交给后续 Brainstorm。

### `@metis` 的职责边界

- `@sisyphus` 负责阶段编排、输入输出衔接和最终事实确认。
- `@sisyphus` 直接负责执行 Intake 的分析工作，并输出结构化报告。
- 报告至少包含：项目背景、需求摘要、任务类型、CBM 初始化结果、风险/未知项和交给 Brainstorm 的上下文。
- `@metis` 不参与 Intake；仅在 Intake 已完成、用户澄清后仍有未决方案选择且 Sisyphus 明确需要独立分析时，以 `SOLUTION_ANALYSIS` 模式提供只读意见。
- `@metis` 不负责设计批准、任务拆分、实现或 Review 结论。
- `@metis` 不得委派其他 Agent 或执行代码修改。
- CBM 索引写入属于索引状态更新，不属于源码写入；Intake 由 Sisyphus 直接尝试一次，失败、超时或 in-progress 时 fail-open 并记录证据。
- 默认权限矩阵不应被解释为要求 Metis 执行 Intake；用户显式配置的权限覆盖仍按现有配置优先级生效，不能被描述为绝对运行时禁止。

## CBM 生命周期规则

### Intake

- 代码任务：直接初始化或重建当前项目索引，不仅依赖被动查询触发。
- 混合任务：只要包含代码开发、修改、调试或调用链/影响面分析，也执行初始化或重建。
- 非代码、纯文本、Web、AST、glob 或字符串检索任务：跳过 CBM 初始化。
- 初始化失败、不可用、超时或返回进行中状态时 fail-open，继续工作流并记录降级证据。
- 必须避免同一工作流内的子 Agent重复执行 Intake 初始化。

### Review 开始时

- Review 阶段在进行 CBM 查询、影响面审查或符号验证之前，直接再次调用 `cbm_index`，重新初始化或重建当前项目索引。
- 这次刷新是 Review 的必要前置动作，不得沿用 Execute 前的索引作为最新事实。
- 刷新失败时不得伪造“索引已更新”；应记录失败/降级证据，并使用文件读取、文本搜索、测试和其他可用证据继续审查。
- Review 前刷新不改变 Intake 的“首次初始化”记录；两次动作分别标记为 Intake 初始化和 Review 刷新。

## 原阶段调整

### Brainstorm（Phase 2）

- 消费 Intake 输出的背景和需求摘要。
- 继续负责需求澄清、方案比较、推荐方案、设计确认和写入 `.oceanus/spec/`。
- 不负责 CBM 初始化或重建，只做必要的符号/架构查询。

### Plan（Phase 3）

- 消费 Intake 已完成的 CBM 状态。
- 不重复调用 CBM 初始化或重建。
- 继续负责文件映射、任务拆分、依赖、Wave、TDD、Worktree、ledger 和 `@momus` 门禁。

### Execute（Phase 4）

- 继续负责实现、并行调度、任务状态和验证。
- 高风险公共符号修改前仍可执行 `cbm_trace` / `cbm_query` 影响分析。

### Review（Phase 5）

- 阶段开始先刷新当前项目 CBM 索引，再进行 Review 查询。
- 继续负责证据化审查、必要时委派 `@oracle` 和 Completion Audit。

### Finish（Phase 6）

- 继续负责最终测试、构建、ledger 收口和不确定性报告。

## 产物

- Intake 阶段报告：作为当前会话上下文交给 Brainstorm；如需支持中断恢复，应持久化到对应 `.oceanus/spec/` 文档的 Intake 区段或独立 intake 文件。
- Brainstorm：`.oceanus/spec/<name>.md`
- Plan：`.oceanus/plan/<name>.md`
- 进度账本：`.oceanus/progress/<plan-name>.md`

## 边界与非目标

- 不在 Intake 阶段做技术方案选择或要求用户批准设计。
- 不让 Intake 替代 Brainstorm 的需求澄清和设计职责。
- 不在 Plan 阶段重复初始化 CBM。
- 使用现有 `cbm_index` 的直接 `index_repository` 能力；不修改 CBM 索引器、watcher、缓存存储或 daemon 的核心实现。
- 不新增运行时自动 supervisor；阶段门禁仍由 Sisyphus 的 Prompt、Skill 和实际验证执行。
- 不因 CBM 失败阻塞主工作流。

## 反例与边界条件

- 用户只要求修改 README：跳过 Intake 的 CBM 初始化。
- 用户同时要求修改代码和 README：按代码任务处理并初始化 CBM。
- 当前工作区为空、项目路径无法识别或 CBM 工具不可用：记录降级并继续。
- CBM 初始化返回异步进行中：不得无限等待；记录状态并按降级策略继续。
- Execute 期间代码发生变化：Review 开始前必须重新刷新索引。
- Intake 或 Review 重试：分别根据阶段记录处理，不得因为重试无条件制造重复的并发索引任务。

## 验收标准

1. `src/agents/sisyphus.ts` 明确声明六阶段顺序：`intake → brainstorm → plan → execute → review → finish`。
2. 新增并注册 `sisyphus-intake` Skill，且插件启动后可加载。
3. Intake Skill 明确包含五项职责、由 Sisyphus 执行及结构化输出要求。
4. Brainstorm 和 Plan Skill 不再包含 CBM 初始化/重建职责；Plan 明确消费已有结果。
5. Review Skill 明确要求在 Review 查询前重新建立当前项目 CBM 索引。
6. 主 Agent、`@metis` 和 CBM 工具的权限边界可表达：允许必要的索引状态更新，但不开放源码写入、任务委派或代码执行权限。
7. 测试覆盖：六阶段顺序、新 Skill 注册、非代码任务跳过、代码任务初始化、Plan 不重复初始化、Review 前刷新、失败/in-progress fail-open。
8. 同步 README、相关 CBM 规范、测试和构建产物；`bun test`、类型检查和构建通过。
9. 验收区分静态 Prompt/Skill 契约与实际 CBM 调用行为：阶段顺序和职责用契约测试，`cbm_index` 的直接 `index_repository` 映射用工具测试；Agent 实际是否遵循 prompt 的调用顺序记录为运行时审计项，不用字符串断言冒充调用次数保证。

## Metis 分析

### 需求缺口

- 需要把“了解背景和需求”与 Brainstorm 的方案设计、需求澄清边界明确分开。
- 需要明确 Intake 的结构化输出及其持久化方式，避免中断恢复时丢失上下文。
- 需要明确 `@metis` 执行 CBM 索引更新时的最小权限边界。

### 风险

- Intake 和 Brainstorm 可能重复询问用户或重复探索代码库。
- 只修改阶段 Skill 而不更新主 Agent 顺序、注册表、测试和 dist，会造成契约不一致。
- Review 前重建索引会增加耗时；失败时必须保持 fail-open。
- CBM 索引状态更新不是源码写入，但可能与现有只读权限模型冲突，需要单独表达最小权限。

### 边界与非目标

- Intake 只做背景、最小需求 intake、任务分类和索引预检。
- 技术方案、设计批准、任务拆分、实现和代码审查仍由原阶段负责。
- 不修改 CBM 底层实现，不增加运行时硬拦截。

### 反例与边界条件

- 非代码任务不触发 CBM。
- 代码+文档混合任务按代码任务处理。
- CBM 不可用、失败、超时或进行中时继续工作流并保留降级证据。
- Execute 产生变更后，Review 不得使用旧索引作为最新结果。

### 可验证验收标准

- 六阶段顺序和 Skill 注册有静态契约测试。
- Intake、Plan、Review 的 CBM 动作边界有互斥断言。
- 代码任务、非代码任务、CBM 失败和 Review 刷新场景均有测试或可审计验证。
- 构建产物和文档同步，完整测试通过。
