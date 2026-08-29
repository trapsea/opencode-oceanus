# Oceanus / Sisyphus 提示词与工作流审查报告及优化方案

- 日期：2026-08-29
- 审查范围：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/agents/orchestrator-context.ts`、`src/agents/momus.ts`、`src/agents/metis.ts`、六个 `sisyphus-*` skills、`src/skills/opencode-oceanus.ts`
- 对比基准：`oh-my-opencode-slim`（本地 `/apple/workspace/ocean/oh-my-opencode-slim`，oceanus 直接上游）与 `oh-my-openagent`（code-yeongyu/oh-my-openagent，omo 主系通用版，基于远端调研）
- 状态：问题清单已核对；优化方案已定；**尚未实施**

---

## 一、问题清单（16 项，按严重程度分组）

### A. 结构性问题（高优先级）

| # | 问题 | 上游核对结论 |
|---|------|------------|
| 1 | Sisyphus 提示词用 `replaceRole` + `replace('</Workflow>')` 字符串手术组装，脆弱且难以审计；上游结构变化会静默退化 | slim 的 `architect.ts` 同源同模式；属继承问题，仍值得改为 sections 化 |
| 2 | Oceanus Workflow 编号断裂（1/2/3/4/6，缺 5），Verify 一节过薄，与 Sisyphus Review 不对称 | slim 同样缺 5；复制残留 |
| 3 | 指令大规模重复：调度协议 ×3（Oceanus 正文 / `DELEGATION_BRIEF_PROMPT` / Sisyphus `TASK_CONTINUITY`）、ledger 协议 ×3、终态确认 ×6 | 重复为 oceanus 自行叠加的增量层；slim 无这两段 |
| 4 | 中英混杂无规则（英文正文嵌中文段落：Delegation Brief、CBM 段、Sisyphus 追加段） | slim 本身就是"英文 prompt + 中文 skill"双语结构；问题范围缩小为 orchestrator 内嵌中文段 |

### B. 逻辑矛盾与含糊指令（中高优先级）

| # | 问题 | 上游核对结论 |
|---|------|------------|
| 5 | 双门禁（Momus OKAY + 人工 APPROVED）无获取/记录机制；`sisyphus-execute` 只写了单门禁，与 plan skill/agent 正文矛盾 | slim 无门禁；openagent 有 metis/momus 门禁先例，思路保留但需完整协议 |
| 6 | Metis 触发条件在 oceanus 卡片、sisyphus.ts 门禁、brainstorm skill 三处定义不一致；sisyphus.ts:44 病句把"复杂任务"与"仅未决方案"混在一句 | oceanus 内部漂移；单一来源化 |
| 7 | Oceanus 引用 Sisyphus 专属产物（`progress.md` 落盘台账创建时机、`todowrite`）与未注入时的 Task Board 缺省行为 | 双身份导致职责边界模糊，上游无此问题 |
| 8 | 运行时守卫（LANE_CONFLICT、dispatch-guard、Active/Unreconciled 语义）解释散落，模型只能靠猜 | oceanus 增量；需统一小节 |

### C. 角色与门禁设计（中优先级）

| # | 问题 | 上游核对结论 |
|---|------|------------|
| 9 | Momus 承担 CBM 影响面预估（search_graph→trace→code），与 Metis SOLUTION_ANALYSIS 重叠，违背"轻量只读门禁"定位 | oceanus 增量；上移到 Plan 阶段 Sisyphus 自查 |
| 10 | `sisyphus-finish` 调用未定义的 `decideFinish`，幽灵引用 | oceanus 独有缺陷 |
| 11 | Failing-First 两份证据（RED+GREEN + 真实表面工件）对所有改动无条件强制，小改动过重 | slim 用计划期声明式开关（TDD strategy: enabled/disabled + 禁用理由）+ "证据缺失即视为未完成"；采纳 slim 方案为主 |
| 12 | Review 强制重建 CBM 索引无 fail-open/超时预算，大仓库会阻塞主线 | oceanus 增量；需与 Intake fail-open 原则统一 |

### D. 文本与格式质量（低优先级但有执行影响）

| # | 问题 | 上游核对结论 |
|---|------|------------|
| 13 | 占位符不统一（`…`、省略号可能被照抄）；"禁止全角标点"规则与自身中文正文表述自相矛盾 | 需区分"工具调用示例"与"说明性正文" |
| 14 | 步骤编号错乱：brainstorm 两个 "2."、plan 6/7/8 前导空格、intake 缩进混乱；markdown 列表断裂降低指令权重 | slim 用手写 SKILL.md 较规整；根源是 oceanus 内嵌 TS 模板串 |
| 15 | 禁用 agent 后正文仍残留硬编码引用（@metis/@momus/@oracle/@sisyphus）；`buildMetisMomusGate` 只处理了门禁段 | slim 同病（正文不过滤）；oceanus 已部分领先，应补全 |
| 16 | 杂项：metis 卡片仍宣传 INTAKE 模式（实现仅 SOLUTION_ANALYSIS，且 `Modes:` 行含不可见分隔符）；`resolvePrompt` 两 agent 参数语义对调；skills frontmatter 与 TS 层双 description | oceanus 内部问题 |

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
- `RUNTIME_GUARDS`（LANE_CONFLICT、dispatch-guard、Active/Unreconciled 语义集中一处）

Oceanus 正文、`DELEGATION_BRIEF_PROMPT`、Sisyphus `TASK_CONTINUITY`、门禁段全部改为引用。补 `protocol.test.ts`：断言关键串出现次数防复制粘贴回归。

### 4. 语言规则缩小落地
不追求全文统一英文。规则改为"每个文件内部统一"：agent system prompt 英文；skill 正文可中文；orchestrator 英文正文中嵌的三段中文（Delegation Brief、CBM 段、Sisyphus 追加段）外移或翻译。

### 5. 双门禁落地协议
- 获取：Momus OKAY 后用 `question` 展示 plan 摘要（任务数/文件范围/风险 Top3），选项 APPROVED / 需要修改 / 取消。
- 记录：plan 固定 `## Gate Status` 字段（momus verdict + round + 时间；human: APPROVED/PENDING/REJECTED+reason）。
- 放行：execute 开工前必须读到 `human: APPROVED`；`sisyphus-execute` "Only @momus OKAY lets execution continue" 补齐人工门禁；Plan-Change Gate 同步。
- 分流：仅复杂任务启用双门禁；简单任务沿用 slim 式单评审并在 plan status 记录跳过理由（与现有"简单任务可跳过"呼应）。
- 拒绝/沉默：用户不响应 → 停止并记 `human: PENDING`，不得自行放行（沿用 wait_for_user 边界）。

### 6. Metis 触发条件统一
全部替换为 `METIS_TRIGGER` 引用；修 sisyphus.ts:44 病句；可对照 openagent metis 措辞校准。

### 7. Oceanus/Sisyphus 概念拆分
Oceanus 的 Progress Ledger 改会话级（todo list），删 `progress.md` 引用，改为"升级多阶段工作时切换 @sisyphus（它维护落盘台账）"；`todowrite` 核对宿主实际工具名；补"本轮无 Task Board 注入则视为无托管任务"缺省行为。

### 8. 运行时守卫集中
`RUNTIME_GUARDS` 放 Task Lifecycle Tools 之后；其余处删重复解释保留行为规则。

### 9. 影响面预估上移 Plan
`sisyphus-plan` 步骤 6 前新增 Sisyphus 自查（cbm_search_graph → cbm_trace → cbm_code，产出 `impact_estimate` 记入 plan）；Momus 检查项第 5 条改为校验 `impact_estimate` 存在性与覆盖（可轻量 spot-check，不做全量 trace）；`sisyphus-review` 对比对象从"momus 预估"改为"plan 的 impact_estimate"；momus.ts 措辞同步。

### 10. decideFinish 处理
先 `grep -rn "decideFinish" src/` 确认归属：宿主工具则补定义与降级；否则删除，替换为自包含判定（Review v1 存在 + matrix 全绿 + ledger 无 failed/blocked + 无 PENDING 门禁 → 完成；否则如实列为剩余不确定性）。

### 11. 证据分级（采纳 slim 声明式开关）
Plan header 中每任务声明 `evidence: strict(TDD: RED+GREEN+表面工件) | light(test-after，须补测试) | exempt(白名单+理由)`；execute 按 tier 执行；review 按 tier 校验；执行中发现任务实际影响公共符号 → 升 strict 并回 plan 记录。保留三档表作为细则，决策点前移到 plan。

### 12. Review CBM fail-open 预算
cbm_index 一次 + 最多一次重试；in-progress/超时/失败 → 降级为 `cbm: stale(<时间>)` + grep/read + git diff 手工影响面 + 报告标注降级证据；execute 无代码变更（纯文档）则跳过重建。fail-open 定义也入 `protocol.ts`。

### 13. 占位符与标点
统一 `<task_id>` / `<stable-key>` / `<plan-name>` 风格；grep 清零 `…`/`某某`/`xxx`；规则改精确："工具调用示例与参数对象内禁止全角标点；说明性正文不受限"。

### 14. 编号修复 + lint 断言
逐文件修 brainstorm（两个 "2."、` 3.` 前导空格）、plan（6/7/8 前导空格）、intake（缩进）；`stages.test.ts` 加正则断言 `## Steps` 有序列号严格递增、无异常前导空格。根治见 D-4。

### 15. 禁用过滤参数化
Dispatch efficiency 的 sisyphus 行、CBM 段 oracle 行、Session Reuse 第 4 条改为按 `disabledAgents` 插值的模板；metis 卡片 Modes 行改 "Mode: SOLUTION_ANALYSIS only (post-Intake candidate comparison)"，不可见分隔符换 `/`。测试：全禁用组合下 prompt 不含对应 `@name`。

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
  D. 门禁协议修齐（问题 5/9/12）                     [sisyphus-plan/execute/review.ts, momus.ts]
Wave 3（依赖 C）：
  E. 编号重排 + Verify 增强（问题 2）                [oceanus.ts]
  F. 禁用过滤参数化（问题 15）+ 语言外移（问题 4 缩小版） [oceanus.ts]
  G. D-1 plan header 模板（含问题 11 声明式开关）+ D-2 finish 收尾协议（替换 decideFinish，问题 10） [sisyphus-plan/execute/review/finish.ts]
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

由此暴露的实现层问题（新增为优化项，编号 C-17/C-18）：

| # | 问题 | 方案 |
|---|------|------|
| 17 | CBM CLI 仍以 raw JSON 位置参数方式调用 `cli index_status`，上游已弃用，未来版本会移除 | 迁移到 flags / `--args-file` / piped stdin 调用方式；在 `src/cbm/` 调用层统一封装并加版本兼容测试 |
| 18 | daemon 30s 无法接受客户端即判定失败，但日志显示 daemon 正在正常初始化（预算 11GB / 总 32GB RAM），属于"冷启动慢"而非"不可用"；当前提示词把该场景一律降级，会丢失本可用的图谱能力 | (a) 区分 `starting` 与 `failed`：starting 时允许一次更长等待或后台重试，仍失败才降级；(b) 与优化项 12（Review 阶段 fail-open 预算）合并实现——降级状态写 `cbm: starting->stale(<时间>)` 而非笼统 failed；(c) 记录 daemon 冷启动耗时基线，作为超时阈值设定依据 |

该事件同时验证了审查结论：**fail-open 降级路径是必要且有效的**（审查未被打断），但当前降级判定粒度过粗（问题 18）。

---

## 六、复核与证据状态

- slim 侧结论基于本地源码一手核对（`/apple/workspace/ocean/oh-my-opencode-slim/src/agents/orchestrator.ts`、`architect.ts`、`src/skills/architect-*/SKILL.md`）。
- openagent 侧结论基于 @librarian 远端调研（工厂签名、配置 schema、team-mode 类型、README），**具体提示词正文未获取**；涉及 openagent 的校准动作（问题 6 措辞）在实施前建议再定向抓取 `packages/omo-opencode/src/agents/` 下 prompt 文件。
- 本文档为审查记录，所有方案**未实施**；实施时以本文档为基线，逐 Wave 更新 `.oceanus/progress/` 台账。
