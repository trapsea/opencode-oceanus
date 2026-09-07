# Oceanus / Sisyphus 提示词与工作流审查报告及优化方案

- 日期：2026-08-29
- 审查范围：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/agents/orchestrator-context.ts`、`src/agents/momus.ts`、`src/agents/metis.ts`、六个 `sisyphus-*` skills、`src/skills/opencode-oceanus.ts`
- 对比基准：`oh-my-opencode-slim`（本地 `/apple/workspace/ocean/oh-my-opencode-slim`，oceanus 直接上游）与 `oh-my-openagent`（code-yeongyu/oh-my-openagent，omo 主系通用版，基于远端调研）
- 状态（P15，2026-08-29）：P1-P14 已落地并通过对应测试（全量 1021 pass/8 skip/0 fail）；下表区分代码/测试行为与真实 OpenCode Host、CBM daemon、ast-grep 环境验证，不把 mock、fake 或静态证据记为真实成功。

---

## 一、问题清单（18 项，按严重程度分组）

状态说明：**已修复**表示已有实现与测试证据；**部分修复**表示协议已落地但仍受运行环境或 Host 能力限制；**未修复/待办**表示当前实现未覆盖。

### A. 结构性问题（高优先级）

| # | 问题 | 当前状态与实现证据 | 上游核对结论 |
|---|------|----------------------|------------|
| 1 | Sisyphus 提示词用字符串手术组装 | 已修复：`oceanus.ts` 提供 sections/render，`sisyphus.ts` 显式组装；`prompt-sections.test.ts` 覆盖顺序与闭合标签 | slim 的 `architect.ts` 同源同模式；属继承问题 |
| 2 | Workflow 编号断裂、Verify 过薄 | 已修复：阶段/步骤契约已统一；`src/skills/stages.test.ts` 验证编号与阶段结构 | slim 同样缺 5；复制残留 |
| 3 | 指令大规模重复 | 已修复：协议常量集中于 `protocol.ts`，`protocol.test.ts` 固定关键契约 | 重复为 oceanus 增量层 |
| 4 | 中英混杂无规则 | 已修复：按 agent prompt/skill 文件边界统一语言，相关断言见 prompt 测试 | slim 本身为英文 prompt + 中文 skill |

### B. 逻辑矛盾与含糊指令（中高优先级）

| # | 问题 | 当前状态与实现证据 | 上游核对结论 |
|---|------|----------------------|------------|
| 5 | 双门禁无获取/记录机制 | 已修复：Plan 明确 Momus + human APPROVED、Gate Status 与变更失效规则；`gate.test.ts` 覆盖 | slim 无门禁；openagent 有门禁先例 |
| 6 | Metis 触发条件漂移 | 已修复：统一触发协议并由 `protocol.test.ts`/prompt 测试覆盖 | oceanus 内部漂移 |
| 7 | Oceanus/Sisyphus 产物与 Task Board 边界模糊 | 已修复：明确会话级 todo、Sisyphus 台账及无注入时缺省行为；`stages.test.ts` 覆盖 | 双身份导致职责边界模糊 |
| 8 | 运行时守卫语义散落 | 已修复：`RUNTIME_GUARDS` 集中，相关 protocol/dispatch 测试覆盖 | oceanus 增量 |

### C. 角色与门禁设计（中优先级）

| # | 问题 | 当前状态与实现证据 | 上游核对结论 |
|---|------|----------------------|------------|
| 9 | Momus 承担 CBM 影响面预估 | 已修复：Plan 生成 `impact_estimate`，Momus 只校验覆盖；`gate.test.ts`、`cbm/registry.test.ts` 覆盖 | oceanus 增量 |
| 10 | finish 调用幽灵 `decideFinish` | 已验证代码行为：Finish 使用自包含判定矩阵；`finish.test.ts` 覆盖。尚未在真实 OpenCode Host 执行 Finish 全链路 | oceanus 独有缺陷 |
| 11 | Failing-First 对所有改动无条件强制 | 已修复：strict/light/exempt 分级与 evidence 契约；`evidence.test.ts` 覆盖 | 采纳 slim 声明式方案 |
| 12 | Review CBM 无 fail-open/超时预算 | 已修复：一次重建、有限重试、stale/fail-open 与 grep/read 降级；`review-budget.test.ts` 覆盖 | oceanus 增量 |

### D. 文本与格式质量（低优先级但有执行影响）

| # | 问题 | 当前状态与实现证据 | 上游核对结论 |
|---|------|----------------------|------------|
| 13 | 占位符与标点规则不统一 | 已修复：占位符与工具参数规则已明确；由 skills/prompt 断言守护 | 区分工具示例与说明正文 |
| 14 | 步骤编号错乱、Markdown 列表断裂 | 已修复：阶段步骤格式统一；`stages.test.ts` 有序编号断言 | 根源是内嵌 TS 模板串 |
| 15 | 禁用 agent 后残留硬编码引用 | 已修复：按 `disabledAgents` 参数化过滤；prompt 测试覆盖禁用组合 | slim 同病；oceanus 已部分领先 |
| 16 | metis 模式、resolvePrompt 与 frontmatter 杂项 | 已修复：模式/解析函数/字段契约已对齐；agent/index 测试覆盖 | oceanus 内部问题 |

---

## 二、上游对比要点

### 与 oh-my-opencode-slim（直接上游，本地源码核对）

1. **slim 无 momus/metis 门禁**：质量保障靠 `architect-review`（证据评审）+ wave_review 后统一提交 + finish 交付选项。
2. **slim 的 plan 有强模板**：`Goal / Architecture / Tech Stack / Execution mode / TDD strategy / Worktree strategy / Global Constraints`，字段逐字取自设计文档、禁止占位符 → 值得移植。
3. **slim 的 TDD 有禁用出口**：`TDD: disabled`（+理由）走 test-after，不强制 RED 证据但必须补测试；"证据缺失即视为未完成 TDD"。
4. **slim 的 finish 更完整**：环境检测（分支/脏区/worktree/提交落盘 git log 核对）→ 交付选项 `question` 三选一 → cleanup → 最终验证。
5. **slim 有 @council** 多模型共识 agent（oceanus 未移植，记 backlog）。
6. **slim 新版有 Wake Scheduler**："派发后台任务后立即结束 turn，Job Board 自动唤醒，禁止轮询" —— 与 oceanus 的 pull-based 轮询纪律是路线分歧，需先确认 oceanus 是否有唤醒机制再统一（见 D-7）。
7. slim skills 为独立 SKILL.md 文件（可 lint、frontmatter 单份）→ oceanus 内嵌 TS 串是问题 14/16 的根源。

### 与 oh-my-openagent（omo 主系，远端调研）

1. **门禁先例**：openagent 同样有 metis（计划咨询）/momus（审查），另有 prometheus（interview 式规划）；门禁作为独立 agent 嵌在 workflow 阶段中，而非多处文本自我定义。
2. **模型族提示词**：按 kimi/gpt/claude/glm/fallback 家族定制 Sisyphus 提示词，与 runtime reconciler 共享单一来源 → 先做 `promptVariant` 配置项预留（backlog）。
3. **Boulder State / Team Mode**（`~/.omo/teams/` config.json+state.json+mailbox+tasklist.jsonl+per-member worktree）：完整 agent OS，复杂度不适配 oceanus 轻量定位，**不采纳**；仅借鉴"spec 与 runtime state 分离"：ledger 中计划声明区与运行状态区用固定小节分开。
4. **三层 MCP + codegraph**：CBM 同型机制做成内置 MCP 供所有 agent 调用 → 借鉴方向：CBM 细则下沉到各 subagent system prompt（metis/momus 已走 `cbmSection()`），orchestrator 只留一句路由规则。
5. **调研缺口（诚实声明）**：openagent 的 Sisyphus 具体提示词正文、metis/momus 详细 prompt、各阶段 skill 全文未获取（webfetch 截断 + monorepo 39+ 包）；相关结论基于工厂签名、配置 schema、team-mode 类型与 README 级证据。

---

## 三、优化方案（按问题编号）

> 核心思路：**单一来源化 + sections 化组装 + 门禁协议落地 + 上游最佳实践吸收**。

### 1. Sisyphus 组装 sections 化
`oceanus.ts` 导出 `OceanusPromptSections { role, agents, workflowCore, workflowTail }`；`sisyphus.ts` 显式拼装，删除 `replaceRole`/`replace('</Workflow>')`。保留与 slim 的结构对应注释便于回同步。配套测试：Sisyphus prompt 必含 SISYPHUS_ROLE、六阶段关键串、`<Communication>` 完整闭合。

### 2. Workflow 编号重排 + Verify 增强
重排 1-5；Verify 扩为：writer lanes 全终态后才最终验证；验收标准落到具体证据；证据过期规则（代码再变更后旧证据作废）。

### 3. 单一来源常量模块 `src/agents/protocol.ts`
- `DISPATCH_PROTOCOL`（结构化对象派发、Task Board 摘要、lane 标记、终态只信宿主事实）
- `LEDGER_PROTOCOL`（pending/in_progress/terminal 语义、台账非锁）
- `TERMINAL_STATE_RULE`（拉取式确认、running 不当结果、沉默≠完成）
- `METIS_TRIGGER`（唯一触发条件：Intake 完成 + 澄清完成 + ≥2 可行方案未决且需要独立分析；复杂度/文件数/风险本身不触发）

Oceanus 正文、`DELEGATION_BRIEF_PROMPT`、Sisyphus `TASK_CONTINUITY`、门禁段全部改为引用。补 `protocol.test.ts`：断言关键串出现次数防复制粘贴回归。

### 4. 语言规则缩小落地
不追求全文统一英文。规则改为"每个文件内部统一"：agent system prompt 英文；skill 正文可中文；orchestrator 英文正文中嵌的三段中文（Delegation Brief、CBM 段、Sisyphus 追加段）外移或翻译。

### 5. 双门禁落地协议
- 获取：Momus OKAY 后用 `question` 展示 plan 摘要（任务数/文件范围/风险 Top3），选项 APPROVED / 需要修改 / 取消。
- 记录：plan 固定 `## Gate Status` 字段（momus verdict + round + 时间；human: APPROVED/PENDING/REJECTED+reason）。
- 放行：execute 开工前必须读到 `human: APPROVED`；`oceanus-execute` 补齐“只有 @momus 的 OKAY 才能继续执行”的人工门禁；Plan-Change Gate 同步。
- 分流：仅复杂任务启用双门禁；简单任务沿用 slim 式单评审并在 plan status 记录跳过理由（与现有"简单任务可跳过"呼应）。
- 拒绝/沉默：用户不响应 → 停止并记 `PENDING`，不得自行放行（沿用 `wait_for_user` 边界）。

### 6. Metis 触发条件统一
全部替换为 `METIS_TRIGGER` 引用；修 sisyphus.ts:44 病句；可对照 openagent metis 措辞校准。

### 7. Oceanus/Sisyphus 概念拆分
Oceanus 的 Progress Ledger 改会话级（todo list），删 `progress.md` 引用，改为"升级多阶段工作时切换 @sisyphus（它维护落盘台账）"；`todowrite` 核对宿主实际工具名；补"本轮无 Task Board 注入则视为无托管任务"缺省行为。

### 8. 运行时守卫集中
`RUNTIME_GUARDS` 放 Task Lifecycle Tools 之后；其余处删重复解释保留行为规则。

### 9. 影响面预估上移 Plan
`oceanus-plan` 步骤 6 前新增 Sisyphus 自查（cbm_search_graph → cbm_trace → cbm_code，产出 `impact_estimate` 记入 plan）；Momus 检查项第 5 条改为校验 `impact_estimate` 存在性与覆盖（可轻量 spot-check，不做全量 trace）；`oceanus-review` 对比对象从"momus 预估"改为"plan 的 impact_estimate"；momus.ts 措辞同步。

### 10. decideFinish 处理
先 `grep -rn "decideFinish" src/` 确认归属：宿主工具则补定义与降级；否则删除，替换为自包含判定（Review v1 存在 + matrix 全绿 + ledger 无 failed/blocked + 无 PENDING 门禁 → 完成；否则如实列为剩余不确定性）。

### 11. 证据分级（采纳 slim 声明式开关）
Plan header 中每任务声明 `evidence: strict(TDD: RED+GREEN+表面工件) | light(test-after，须补测试) | exempt(白名单+理由)`；execute 按 tier 执行；review 按 tier 校验；执行中发现任务实际影响公共符号 → 升 strict 并回 plan 记录。保留三档表作为细则，决策点前移到 plan。

### 12. Review CBM fail-open 预算
cbm_index 一次 + 最多一次重试；in-progress/超时/失败 → 降级为 `cbm: stale(<时间>)` + grep/read + git diff 手工影响面 + 报告标注降级证据；execute 无代码变更（纯文档）则跳过重建。fail-open 定义也入 `protocol.ts`。

### 13. 占位符与标点
统一 `<task_id>` / `<stable-key>` / `<plan-name>` 风格；grep 清零 `…`/`某某`/`xxx`；规则改精确："工具调用示例与参数对象内禁止全角标点；说明性正文不受限"。

### 14. 编号修复 + lint 断言
逐文件修 discuss（两个 "2."、` 3.` 前导空格）、plan（6/7/8 前导空格）、intake（缩进）；`stages.test.ts` 加正则断言 `## Steps` 有序列号严格递增、无异常前导空格。根治见 D-4。

### 15. 禁用过滤参数化
Dispatch 效率的 sisyphus 行、CBM 段 oracle 行、Session Reuse 第 4 条改为按 `disabledAgents` 插值的模板；metis 卡片 Modes 行改为“仅限 SOLUTION_ANALYSIS 模式（Intake 后候选方案比较）”，不可见分隔符换 `/`。测试：全禁用组合下 prompt 不含对应 `@name`。

### 16. 杂项
`resolvePrompt` 拆为 `resolvePromptFromFile()` / `resolvePromptInline()` 消除语义对调歧义；frontmatter 删重复 `description` 并在测试校验字段集；`DelegationBrief` 的 files/forbidden/dependencies 改 `string[]` 列表渲染。

### D 组：对比新增优化点

| # | 内容 | 来源 | 批次 |
|---|------|------|------|
| D-1 | plan header 强模板（Goal/Architecture/Tech Stack/Execution mode/TDD strategy/Worktree strategy/Global Constraints + Gate Status + evidence 声明），合并问题 5/11 落地；台账内"计划声明区/运行状态区"固定小节分离 | slim plan + openagent spec/state 分离 | W3 |
| D-2 | finish 收尾协议：环境检测（git status/log、脏区、worktree、提交落盘核对）→ 交付选项 question 三选一 → cleanup → 最终验证；只读汇总原则保留 | slim finish | W3 |
| D-4 | skill 从 TS 内嵌串迁移为独立 SKILL.md 文件加载（根治 14/16） | slim | W4 |
| D-5 | CBM 细则下沉 subagent system prompt，orchestrator 只留一句"何时 CBM vs grep"路由规则 | openagent codegraph | W4 |
| D-6 | wave_review 后统一提交：Wave 全终态+复查通过后统一 commit 一次并记入 ledger（为 review "证据绑定 git 状态"提供锚点） | slim | W4 |
| D-7 | 轮询 vs 唤醒路线确认：先查 oceanus 是否有 wake/notify 钩子——无则保留拉取式并写明轮询节奏上限（防 sleep/poll 空转），有则改"派发后结束 turn 等唤醒"，统一 6 处终态措辞 | slim wake scheduler | W4 |
| D-3 | @council 多模型共识 agent | slim | Backlog |
| — | 模型族提示词变体（先做 `promptVariant` 配置项预留） | openagent | Backlog |

---

## 四、实施顺序（依赖图）

```
Wave 1（互不冲突，可并行）：
  A. protocol.ts 单一来源 + 引用替换（问题 3/6/8）   [src/agents/protocol.ts, orchestrator-context.ts, oceanus.ts, sisyphus.ts]
  B. 文本/格式修复（问题 13/14/16）                  [src/skills/*.ts, src/agents/metis.ts]
Wave 2（依赖 Wave1 常量）：
  C. Sisyphus sections 化组装（问题 1）              [oceanus.ts, sisyphus.ts]
  D. 门禁协议修齐（问题 5/9/12）                     [oceanus-plan/execute/review.ts, momus.ts]
Wave 3（依赖 C）：
  E. 编号重排 + Verify 增强（问题 2）                [oceanus.ts]
  F. 禁用过滤参数化（问题 15）+ 语言外移（问题 4 缩小版） [oceanus.ts]
  G. D-1 plan header 模板（含问题 11 声明式开关）+ D-2 finish 收尾协议（替换 decideFinish，问题 10） [oceanus-plan/execute/review/finish.ts]
Wave 4：
  H. D-4 skill 迁移 SKILL.md + D-6 wave 统一提交 + D-7 轮询/唤醒确认 + D-5 CBM 下沉
Backlog：D-3 council、promptVariant
验证：bun test（重点 stages.test.ts、index.test.ts、新增 protocol.test.ts）
      + 三档 disabledAgents 组合 prompt 快照断言
```

---

## 五、CBM 运行时降级记录（2026-08-29）

本次审查期间实测触发一次 CBM 不可用降级，作为 fail-open 路径的实证：

```
index_status_failed:
  - mem.allocator budget_mb=11192 total_ram_mb=31978 (ram_fraction)   # daemon 启动日志正常
  - warning: passing raw JSON to 'cli index_status' is deprecated;
    use flags / --args-file / piped stdin                             # 调用方式已弃用
  - error: CBM daemon is active or starting but could not accept
    this client within 30000 ms                                        # 30s 客户端接入超时
处置：允许回退原生工具（grep/glob/read），未阻塞审查主线。
```

由此暴露的实现层问题（P11-P14 已覆盖代码与测试层，真实环境仍是验证缺口，编号 C-17/C-18）：

| # | 问题 | 方案 |
|---|------|------|
| 17 | CBM CLI 仍以 raw JSON 位置参数方式调用 `cli index_status`，上游已弃用，未来版本会移除 | **已验证代码行为**：CLI 优先使用 `--args-file`，并有 raw JSON/旧命令兼容回退；`src/tools/cbm/cli.test.ts` 覆盖。未在真实 CBM CLI 版本矩阵中验证兼容性 |
| 18 | daemon 30s 无法接受客户端时区分不出冷启动与失败 | **已验证代码行为、真实环境未验证**：已有 starting/stale 状态、一次重建/有限重试、超时预算与 fail-open；测试覆盖 starting→重试决策，但尚未在真实 CBM daemon/Host 冷启动链路验证 |

该事件提供了 fail-open 降级路径在本次审查中的运行记录（审查未被打断），但不构成真实 daemon 功能成功证据；starting/stale 判定仍需真实环境验证（问题 18）。

---

## 六、复核与证据状态

- slim 侧结论基于本地源码一手核对（`/apple/workspace/ocean/oh-my-opencode-slim/src/agents/orchestrator.ts`、`architect.ts`、`src/skills/architect-*/SKILL.md`）。
- openagent 侧结论基于 @librarian 远端调研（工厂签名、配置 schema、team-mode 类型、README），**具体提示词正文未获取**；涉及 openagent 的校准动作（问题 6 措辞）在实施前建议再定向抓取 `packages/omo-opencode/src/agents/` 下 prompt 文件。
- 本文档已按 P1-P14 更新；问题 1-16 均有代码/测试证据，问题 17 已完成 CLI 兼容实现但真实版本矩阵未验证，问题 18 已完成 starting/stale 降级实现但真实 daemon/Host 冷启动路径仍需验证；问题 10 同样未宣称真实 Host 全链路成功。
