# Agent 监督、方案分析与检查设计

## 背景

当前 Oceanus/Sisyphus 的任务调度主要依靠主 Agent prompt 纪律和宿主 task 工具。复杂任务虽然有 brainstorm/plan/execute/review 阶段，但缺少专门的方案前置分析与独立质量检查角色，可能出现方案遗漏、依赖错误、边界不清或执行前未发现风险。

## 已确认决策

- preset reload 不在本轮改造；保留现有“写配置 + agent.reload”语义，prompt/permission 定义本身不因本需求改变。
- 新增两个默认启用的只读 subagent：
  - `metis`：方案前置分析，负责需求缺口、风险、边界、反例和验收标准。
  - `momus`：方案质量 check，负责可执行性、依赖、测试覆盖、范围漂移和矛盾检查。
- `oracle` 保留为高风险架构、复杂调试和独立代码评审顾问，不与 metis/momus 合并。
- 复杂任务采用阶段门禁：`metis` 分析 → 方案形成 → `momus` 检查；`momus` 输出 `REJECT` 时必须回到 plan 修订，`OKAY` 后才进入 execute。简单任务允许主 Agent 说明理由后跳过。
- 不实现插件自动监控并主动启动 supervisor；监督由 Sisyphus/Oceanus 按阶段委派宿主 task 完成。

## 默认只读权限矩阵

以下 Agent 默认只读：`explorer`、`librarian`、`oracle`、`observer`、`metis`、`momus`。只读权限由 v2 `agent.permissions` 硬约束表达，prompt 中的权限说明只作行为指导；`designer`/`fixer` 保持可写角色，`oceanus`/`sisyphus` 保持编排所需权限。用户显式配置可覆盖默认矩阵。

## Prompt 与路由

- Oceanus 的 Agent 路由表新增 metis/momus，明确触发条件、输入输出和禁止事项。
- Sisyphus 五阶段提示新增复杂任务检查协议：brainstorm/plan 调 metis，plan 完成后调 momus，REJECT 不得直接执行。
- `metis`/`momus` 不允许自行委派或修改文件；输出结构化的分析/检查结论，便于主 Agent 整合。
- `disabled_agents` 过滤注册和路由描述；禁用 metis 或 momus 时提示检查能力不可用，不伪造已完成检查。

## 非目标

- 不复制 OpenAgent 的 v1 harness、task system、team mode、model fallback 或长 prompt。
- 不改变 preset reload 逻辑。
- 不实现 Hook 自动监督、自动重试或自动修复执行结果。
- 不新增第三个 supervisor Agent。

## 验收标准

- `metis`/`momus` 默认注册，可通过 `disabled_agents` 禁用。
- 六个只读 Agent 默认拥有 v2 deny 写入相关 action 的权限矩阵，配置覆盖行为有测试。
- Oceanus/Sisyphus prompt 明确复杂任务的 metis → momus → execute 门禁及跳过条件。
- Agent 路由描述、注册列表、权限矩阵和测试无漂移。
- 运行 Agent/config 测试、全量测试、类型检查和构建通过。
