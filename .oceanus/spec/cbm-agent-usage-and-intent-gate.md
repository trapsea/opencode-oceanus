# CBM Agent 使用规则与 Sisyphus 意图前置索引规格

> **状态：superseded**。阶段职责和索引时机以 `.oceanus/spec/sisyphus-intake-stage.md` 为权威。

## 目标

修正 Oceanus 的 CBM 使用说明与实际注册工具不一致的问题，并在 Sisyphus 处理代码开发、修改或查询任务时，进入 brainstorm 前执行一次轻量索引健康检查：

1. Intake 阶段由 Sisyphus 直接调用一次 `cbm_index`（代码/混合任务）；
2. Review 开始时再次调用 `cbm_index`；
3. 已索引、CBM 不可用或 `autoIndex=false` 时继续工作流并明确记录降级，不阻塞任务。

## 范围

- 修正 Sisyphus 阶段边界中的裸 `search_graph`/`trace_path` 名称。
- Explorer 只读约束显式允许查询型 `cbm_*` 工具；`cbm_index` 由主编排 agent 控制。
- 为 oceanus/sisyphus/explorer/oracle/librarian/fixer 增加参数级 CBM 示例。
- 为只读 agent 放行查询型 CBM 工具权限，并对 `cbm_index` 显式 deny；用户显式 permission 仍可覆盖默认值。
- 增加 prompt、permission、skill 文档测试，并同步用户文档。

## 非目标

- 不修改 CBM CLI、watcher、索引器缓存或 MCP daemon。
- 不对纯文本、注释、AST-only、文件发现或外部 Web 任务强制索引。
- 不在运行时 Hook 中硬拦截任务；意图识别与前置索引是 Sisyphus/oceanus 的工作流规则。
- 不每次任务无条件全量重建索引。

## 意图与索引规则

代码相关任务包括开发、修改、重构、调试、影响面分析、代码结构/调用链查询。

进入 brainstorm 前（这是静态 prompt/skill 工作流契约，不是运行时 Hook）：

```text
代码/混合任务 → Intake 由 Sisyphus 直接执行一次 `cbm_index`
       ├─ indexed → 继续 brainstorm
       ├─ Brainstorm/Plan → 不重复初始化
       ├─ autoIndex=false → 记录降级，继续
       └─ CBM 失败/未知 → 记录降级，继续 grep/read fallback
```

多个并行子任务不重复触发前置 `cbm_index`；prompt 契约要求主编排 agent 在派发 lane 前完成一次任务级初始化，子 agent 查询时继续使用已有 indexer/fallback。

## Metis 分析

### 需求缺口

- 原规则没有定义“重建”的触发条件。
- 只读 permission 未明确放行 `cbm_*`。
- Sisyphus 阶段与 Oceanus 注册工具名称不一致。
- 未定义非代码任务、意图不确定和 `autoIndex=false` 的行为。

### 风险

- 每次无条件 `cbm_index` 会增加延迟、token 成本和索引锁竞争。
- Explorer prompt 宣称可用但权限未放行时，工具调用可能被宿主拦截。
- 意图识别与旧的“plan 阶段索引”规则并存会造成重复索引。
- `cbm_index` 可能返回进行中状态，不能要求工作流无限等待。

### 边界与非目标

- 依赖 CBM watcher 维护已索引项目的新鲜度。
- 分支切换或大规模外部变更不默认重建；必要时由 agent 显式调用 `cbm_detect_changes`/`cbm_index`。
- CBM 不可用时必须继续使用 grep/read/AST-Grep/glob。

### 反例与边界条件

- README/文档/Web 任务跳过前置索引。
- 空仓库、无法解析 workspace、二进制缺失、索引失败均 fail-open。
- 并行 lane 不重复初始化。
- 只读子 agent 可以查询；默认 permission 对 `cbm_index` 显式 deny，不自行触发索引生命周期。

### 可验证验收标准

1. Sisyphus/oceanus prompt 包含代码任务意图识别和 `cbm_status → cbm_index` 规则。
2. prompt 中不再出现未注册的裸 CBM 工具名。
3. Explorer 约束包含查询型 `cbm_*`，且只读 permission 明确 allow 查询型工具。
4. 主要 agent prompt 包含合法参数级调用示例和 fallback 说明。
5. 纯文本/AST/glob/Web 任务继续使用原工具。
6. 新增 prompt/permission 测试通过，全量测试、类型检查和构建通过。

## 方案决策

采用任务级 prompt 规则 + 权限显式放行 + 测试/文档同步；不增加运行时强制索引逻辑。
