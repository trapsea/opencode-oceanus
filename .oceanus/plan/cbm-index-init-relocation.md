# Plan — cbm-index-init-relocation

目标：把 CBM 索引初始化职责从 brainstorm 迁移到 plan，使四个阶段 skill 与主 agent 的 CBM 阶段边界一致；补测试断言防回归；重新 build dist。

## 任务

### T1 [RED] — 新增 CBM 契约断言（先写测试）
- **Goal**: 在 `src/skills/stages.test.ts` 增加**按 skill 归属、可精确执行**的 CBM 契约断言，锚点如下（均为可直接落地的字符串/正则，非泛词误报）：
  - **brainstorm**（T2 修改后目标）：`content` **不含** `cbm_index`；**含** 符号定位 `/cbm_search_graph|cbm_trace/`；**含** 不触发全量索引语义 `/全量索引|不.*(索引|触发)/`；**不含** `autoIndex[\s\S]{0,80}cbm_status` 初始化链。
  - **plan**（T3 修改后目标）：
    - 完整顺序链：`/autoIndex[\s\S]{0,200}cbm_status[\s\S]{0,200}cbm_index/`
    - 正向条件分支：`/unindexed[\s\S]{0,80}autoIndex[\s\S]{0,80}cbm_index/`
    - 排除分支：`/(autoIndex=false|false[\s\S]{0,60}autoIndex)[\s\S]{0,120}(fail-open|回退|跳过)/`
    - 只初始化一次：`/只初始化一次|初始化一次/` 且 `/子 agent 不重复|子agent不重复/`
  - **execute**（T4 修改后目标）：`/高风险[\s\S]{0,100}(cbm_trace|cbm_query)[\s\S]{0,100}(影响|impact)/` 且 `/普通机械修改[\s\S]{0,60}(不强制|无需|可选)/`
  - **review**（T4 修改后目标）：`/变更入口[\s\S]{0,80}独立验证/` 且 `/CBM 不可用[\s\S]{0,80}(降级|degrade)/`
- **Files**: `src/skills/stages.test.ts`
- **Depends**: —
- **Wave**: 1
- **Validation**: 运行 `bun test src/skills/stages.test.ts`，新增断言因 src 未改而失败（RED 证据，覆盖上述全部锚点）。

### T2 [GREEN] — brainstorm.ts 移除索引初始化
- **Goal**: `src/skills/sisyphus-brainstorm.ts` 步骤 1 改为仅"符号定位（cbm_search_graph/cbm_trace）+ 文本探索"，**同时移除**读 autoIndex / cbm_status / 按需 cbm_index 的初始化指令；明确 brainstorm 不触发全量索引（含"不因普通文本探索触发全量索引"语义）。
- **Files**: `src/skills/sisyphus-brainstorm.ts`
- **Depends**: T1
- **Wave**: 2
- **Validation**: stages.test.ts 的 brainstorm 锚点全部转绿（不含 cbm_index、不含初始化链、含符号定位、含不触发索引）。

### T3 [GREEN] — plan.ts 增加 CBM 初始化步骤
- **Goal**: `src/skills/sisyphus-plan.ts` 在 Steps 中新增：代码任务意图识别 → 读 autoIndex（无法读取默认 true）→ cbm_status → indexed 不索引、unindexed 且 autoIndex=true 才 cbm_index 一次；autoIndex=false/unknown/error 或非代码任务 fail-open/跳过；主 agent 派发并行 lane 前只初始化一次，子 agent 不重复。文案需满足 T1 的 plan 锚点（顺序链、正向/排除分支、只初始化一次）。
- **Files**: `src/skills/sisyphus-plan.ts`
- **Depends**: T1
- **Wave**: 2
- **Validation**: stages.test.ts 的 plan 锚点全部转绿。

### T4 [GREEN] — execute.ts + review.ts 补充 CBM 边界
- **Goal**:
  - `sisyphus-execute.ts` 增加 execute 阶段 CBM 边界：高风险公共符号修改前先 cbm_trace/cbm_query 做影响分析；普通机械修改不强制查询。
  - `sisyphus-review.ts` 增加 review 阶段 CBM 边界：对变更入口与影响面独立验证；CBM 不可用时明确记录降级证据。
  - 两文件文案需分别满足 T1 的 execute / review 锚点。
- **Files**: `src/skills/sisyphus-execute.ts`, `src/skills/sisyphus-review.ts`
- **Depends**: T1
- **Wave**: 2
- **Validation**: stages.test.ts 的 execute / review 锚点分别转绿。

### T5 [GREEN 集成] — 全量测试 + rebuild + dist 按 skill 归属验证
- **Goal**: 运行全量 `bun test` 确认全绿（src 级四阶段 skill 契约已由 stages.test.ts 按 skill 归属覆盖）；重新 build；新增 `scripts/verify-dist-skills.ts` 对构建产物做**按 skill 归属（运行时注册对象）**的同步验证。
- **verify-dist-skills.ts 实现方式**（主路径 = 运行时注册对象，规避 bundle 正则脆弱性）：
  1. `import { runSetup } from '../dist/index.js'`（dist 是 build 产物）。
  2. 构造最小 fake `ctx`（参考 `src/smoke/cbm-wiring.test.ts` 的 `createFakeSetupCtx` 模式）：`agent.transform`/`skill.transform`/`command.transform` 分别捕获 `draft.add(...)` 的 agent/skill/command 对象；`session.prompt` 为 no-op。
  3. 通过 `RunSetupOptions` 注入：`loadConfig` 返回 `codebaseMemory.enabled=false` 的配置（**短路后台安装 / MCP / 网络，异步面最小，无残留后台任务需清理**）；`cbm` 注入 fail-open stub。
  4. `await runSetup(ctx, options)`，从 `ctx.skill.transform` 捕获的 skill 对象中按 `name` 精确取出 `sisyphus-brainstorm/plan/execute/review` 四个对象。
  5. **数量断言**：每个 `name` 在捕获集合中**恰好出现一次**（避免跨对象误取）。
  6. 对每个 skill 对象断言其 `SKILL_ANCHORS: Record<string, RegExp[]>`（与 T1 断言一致的锚点）全部匹配；断言 brainstorm 的 content **不含 `cbm_index`**。
  7. **Hard fail**：任何 skill 未捕获、数量不符、或锚点未匹配 → `process.exit(1)` 并打印失败项；全部通过 → 打印各 skill 通过列表，`exit(0)`。
- **Files**: `dist/**`（构建产物，受 .gitignore 约束）、`scripts/verify-dist-skills.ts`
- **Depends**: T2, T3, T4
- **Wave**: 3
- **Validation**（接入验收命令，防旧 dist 误报）:
  1. `bun run build`（build 脚本先 `clean` 删旧 dist，确保产物最新）。
  2. `bun test` 全绿。
  3. `bun scripts/verify-dist-skills.ts` 通过（运行时按 skill 名称读取注册对象并逐一断言四阶段 CBM 语义）。
  4. 记录构建产物验证证据。

## 调度与策略
- **Worktree 策略**: 无 worktree，共享目录。全部由 sisyphus 主 agent 串行自执行（无并行 writer，避免任何写冲突）。
- **TDD 策略**: Failing-first。T1 先写断言（RED）→ T2/T3/T4 实现（GREEN）→ T5 集成验证。
- **依赖图**: T2/T3/T4 ← T1；T5 ← T2/T3/T4。串行执行。

## Momus 门禁记录
- round 1: REJECT（2026-08-26）——①T1 断言过泛、缺顺序/条件分支锚点；②T2 未验证移除 autoIndex/cbm_status、未验证保留符号定位；③T4 契约模糊、未分别规定字符串锚点；④T5 Files 范围不准确（build 写 dist/** 非仅 index.js）；⑤T5 未逐一验证四个 skill 同步。
- round 2: REJECT（2026-08-26）——①顺序锚点缺 autoIndex 在 cbm_status 前；②条件分支仍可能关键词误报、需同一条件链正则；③execute/review 语义字符串未具体化；④T5 dist 为 bundle，grep 无法按 skill 归属区分。
- round 3: 已修订——T1 提供可直接落地的顺序链/正向/排除分支正则锚点；T4 提供顺序邻近锚点；T5 改为新增 `scripts/verify-dist-skills.ts` 按 skill 归属验证。
- round 4: REJECT——①T5 仍需按 skill 归属而非整体 includes 验证，需定义提取区块/运行时注册对象的具体实现；②需明确验证脚本接入验收命令防旧 dist 误报。
- round 5: 已修订——T5 明确 verify-dist-skills.ts 实现（按 `name:<skill>`+content 反引号边界提取区块，利用 esbuild 转义后闭合反引号+逗号唯一；回退方案为 fake ctx 调 runSetup 读运行时注册 skill 对象）；验收命令 `bun run build`(含 clean) → `bun test` → `bun scripts/verify-dist-skills.ts`。
- round 6: REJECT——①正则依赖 esbuild 引号序列化过强；②回退 fake-ctx 未给完整接口/异步清理/hard fail；③缺匹配数量断言。
- round 7: OKAY（2026-08-26）——T5 运行时注册对象路径已解决三轮阻塞点。提示：执行时先 build；fake ctx 覆盖 mcp/tool/hooks；CBM stub 含 createIndexer，避免默认 autoIndex=true 触发真实实现（执行时用 enabled=false 的 loadConfig 短路）。
