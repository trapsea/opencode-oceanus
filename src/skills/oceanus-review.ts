import type { SkillDefinition } from './types';

const OCEANUS_REVIEW_SKILL: SkillDefinition = {
  name: 'oceanus-review',
  category: 'phase',
  description:
    '第 5 阶段——审查：Execute 完成后由 @oracle 执行独立分级审查（docs-only 轻量 / trivial 维度映射 / 其余全量），Sisyphus 负责上下文、证据和 BLOCKER 处置。',
  slash: true,
  content: `---
name: oceanus-review
category: phase
input: 实现、plan、evidence、tests 与 completionMatrix
owner: Sisyphus 主 Agent 编排，@oracle 正式审查（双方只读；Execute 负责修复）
output: review 报告
entry: execute 完成
exit: 验收证据齐全
failure: 缺口退回 execute
verification: 主流程测试与 evidence 审查
humanReview: conditional
description: 第 5 阶段——审查：Execute 完成后由 @oracle 执行独立分级审查（docs-only 轻量 / trivial 维度映射 / 其余全量），Sisyphus 负责上下文、证据和 BLOCKER 处置。
---

# Sisyphus 第 5 阶段——审查

## 目标
Sisyphus 主 Agent 收集并验证 spec/plan/diff/evidence，必须将正式 Review 以完整 Oracle Brief 委派给 @oracle，并按双信号分级路由审查强度（docs-only diff→diff-review 轻量；trivial→review 维度映射；standard/architecture→review 全量）。Oracle 只读执行独立分级审查并返回 PASS/WARN/FAIL；Sisyphus 负责消费结论、核验证据、组织 Execute 回退和最终阶段推进。

Review 是 Execute 完成后的正式审查阶段；Intake、discuss、Plan 和 Execute 内部只做阶段内自查，不重复创建 Review/Completion Audit 门禁。

在最终状态上使用证据而非直觉发现缺陷和设计偏移。

## 完成声明铁律

**没有新鲜、完整的验证证据，不得声称完成。** 对每个完成声明执行：

1. **IDENTIFY**：明确什么命令、diff、构建制品或真实表面能证明该声明。
2. **RUN**：在当前最终状态完整运行验证，不复用变更前输出。
3. **READ**：读取完整输出、退出码和失败计数，不只看最后一行。
4. **VERIFY**：确认输出确实覆盖声明；不覆盖就记录 gap 并退回 execute。
5. **CLAIM**：只有前四步成立才写 accepted/completed。

测试通过不等于构建通过，类型检查通过不等于运行时表面通过，worker 自报完成不等于范围和 diff 已核实。

## 对抗性立场

**假设目标未达成，直到代码证据证明相反。** 起始假设是"任务完成了但目标没达成"；逐条证伪执行摘要与自报叙述。执行者说的不是证据，代码库实际存在的才是。

审查者变软的失效模式（自查对照，出现任一即纠正）：

- 信任执行摘要的要点而不读它描述的实际代码。
- 把"文件存在"当作"行为已验证"——占位实现满足存在性但不满足行为。
- 该判 FAILED 时选 UNCERTAIN 回避冲突；该请求人工决策时替用户放行。
- 被高任务完成率锚定：7 项过 6 项就放松第 7 项的审查力度。
- 早期通过的条目降低了对后续条目的怀疑。

**发现分级（每条必须显式标注）**：
- **BLOCKER**：准则未达成或证据缺失，不修复不得进入下一阶段。
- **WARNING**：质量或一致性受损，建议修复但可继续。
- **INFO**：仅供参考，永不单独触发退回。

无法用证据确认又无法证伪的准则 → UNCERTAIN：标注缺失的具体证据并请求用户决策，不得默认通过。矩阵状态为 VERIFIED / FAILED（BLOCKER）/ UNCERTAIN；BLOCKER 按执行配置 review_loop 处置（见下节），WARNING 记录后可继续，UNCERTAIN 阻塞并请求用户决策，INFO 不阻塞。

## BLOCKER 处置（执行配置 review_loop 控制）

发现 BLOCKER 后，Review 必须在报告中输出可执行的完整 BLOCKER 清单（每项包含准则、证据缺口、目标文件/任务、验证命令和验收标准），并立即把该清单交给 Execute。不得等待用户再次提示，也不得只报告“review failed”后停顿。

- **开启「Review 循环执行」——自动回退闭环**：Execute 完成**全部 blocker 任务**并取得当前状态的验证证据后，主流程自动重新进入 Review；只有新的 Review 全部通过，才自动进入 Finish。该闭环最多自动运行三轮，三轮内应合并处理本轮发现的全部 BLOCKER，不能修完一项就请求用户继续。发现属于 UNCERTAIN 的未决决策时立即使用 \`question\` 请求用户决策；第三轮仍有 BLOCKER 时才使用 \`question\` 建立用户阻塞边界；WARNING 和 INFO 不得打断自动闭环。
- **关闭（默认）——修复后直接 Finish**：Execute 一次性修复全部 BLOCKER 并取得当前状态验证证据后，主流程直接自动进入 Finish，不重新 Review。完成矩阵中对应 BLOCKER 行更新为已修复并附验证证据，标注 \`review_loop: off（BLOCKER 已修复并验证，未做二次独立复审）\`，矩阵全绿后 Review 结论记为 accepted（附 review_loop: off 标注）；WARNING 和 INFO 仅记录不修复。修复持续失败或无法取得验证证据时，按 3 轮中断上报模板用 \`question\` 上报；UNCERTAIN 仍立即用 \`question\` 请求用户决策。

## 步骤
0. **当前目录范围**——审查始终针对当前目录中的实际 diff 执行；不创建或合并隔离工作区。
1. **审查查询前规划 CBM 预算**——先根据实际 diff 分类：纯文档 diff（仅 Markdown、注释或文案，且不影响代码契约）跳过刷新，记录 \`cbm: skipped (docs-only)\`。其余 diff 在 Review 开始允许调用 \`cbm_index\` 刷新索引，成功后再执行查询：首次尝试最多 30 秒；若状态为 starting/in-progress 或超时，最多再重试一次、最多 60 秒；总预算严格为 90 秒。预算耗尽、失败或工具不可用时记录 \`cbm: stale\`，改用 grep/read 与手工 diff 复查，记录降级证据、覆盖范围和残余风险，但不得仅因 CBM 故障阻断 Review。
2. **在实际 diff 上重新检查影响面**——用 \`cbm_trace\`/\`cbm_detect_changes\` 对实际 diff 再次排查影响面，以实际代码为准，并与 plan 的 \`impact_estimate\` 普通对比；差异解释或退回 execute。
3. **与计划预估普通对比**——将实际 diff 的影响面与 plan 的 \`impact_estimate\` 对比；一致则记为证据，不一致则解释差异或退回 execute。同时对比每任务实际与预估 diff 行数，显著偏差记为 plan 质量信号。
4. **执行最终审查门禁**——在进入 Finish 前，根据 spec 和 plan 审查最终实际输出。
   - **代码格式审查**——对实际代码 diff（不含无关文件）识别并执行项目已有的 formatter 或 \`format:check\` 命令；读取完整输出与退出码，并确认修改区域的换行、import、声明、方法和控制流符合仓库风格。若仓库没有格式化命令，必须明确记录“无可用 formatter”，并以 \`git diff --check\` 和人工结构检查作为降级证据；已有格式检查失败或代码仍明显难以审查时，作为 **BLOCKER** 列入回退清单，不得仅以测试通过替代格式证据。
5. **接受前验证**——对于任何发现，在采取行动前用证据（阅读代码、运行检查）确认它。
6. **分级路由正式委派给 @oracle**——按双信号路由审查强度，并把路由判据与 \`review_intensity\` 标注写入 review 报告：
   - **docs-only diff**（沿用步骤 1 判定：仅 Markdown、注释或文案且不影响代码契约）→ 委派 \`diff-review\` 场景（\`review_intensity: light\`）：范围核对、证据映射与文档底线（相对链接有效、与源码事实不矛盾、无计划外越界文件）；发现影响代码契约的内容时升级回 \`review\` 全量并说明依据。
   - **intake complexity=trivial** → 委派 \`review\` 场景（\`review_intensity: scoped\`）：按场景注册表 scoped 维度映射执行——需求与计划、正确性与回归、验证与证据必查，其余维度按 diff 实际触及面映射，未触及维度在 Negative Findings 中单行说明依据。
   - **standard/architecture，或任一判据缺失/不可判定** → 委派 \`review\` 场景（\`review_intensity: full\`）：9 维全量执行，不得因某维度未在需求中明确提及而跳过性能、安全、边界、可靠性或兼容性审查。
   - 任何分级都保留 graded 契约（PASS/WARN/FAIL）、fresh-session 独立性与 BLOCKER/UNCERTAIN 处置语义；不存在零审查放行路径。
7. **完成审计**——Review/Completion Audit 只在正式 Review 中执行；已知声明未经验证时，不得进入 Finish。

## 反馈与发现处理

接受任何 @oracle、worker 或代码审查反馈前，按以下顺序处理：完整阅读 → 用当前代码/调用方/测试复述 → 验证技术事实 → 判断是否适用于本仓库 → 逐项接受或技术性反驳 → 逐项实现并验证。反馈是 advisory，不是未经核实的事实；不得只因来源权威而直接修改。

常见错误对照：

- 测试通过 ≠ 验收完成：还要核对 spec、最终 diff 和真实表面。
- typecheck 通过 ≠ build 通过：分别执行并读取结果。
- build 通过 ≠ 运行时正确：需要 CLI、live endpoint、手工 QA 或构建制品证据。
- worker 报告成功 ≠ 文件范围正确：主 Agent 必须独立检查 diff、Files 和验证输出。
- 旧命令曾通过 ≠ 当前状态仍通过：任意代码变化都会使相关 evidence stale。

## 审查职责

Review 的正式审查由 Oracle 只读执行，不修改代码、不运行 task；测试和基础验证由 Review 主流程执行后作为证据交给 Oracle。Oracle 必须消费完整 Oracle Brief（以路径引用与不超过 3 行的短摘要为主，内联不承载长文本）与落盘审核对象；Sisyphus 不得以 Oracle 自报结论替代对证据、范围和回退清单的核验。SDD 开启时报告写入 \`.oceanus/review/<YYYY-MM-DD>-<需求名>-review-v1.md\`（时间、需求名和 Review 版本均沿用本轮任务标识）；SDD 关闭时 review 结论在会话内呈现，不落盘。

- **Sisyphus** 负责准备 Brief、运行基础验证、核对 Oracle 证据、组织 BLOCKER 回退和阶段交接。
- **@oracle** 负责每次 Review 的独立正式审查，必须覆盖正确性、边界、性能、安全、可靠性、兼容性、可维护性和证据质量。
- **调研复用边界**：正式 Review 每次使用新的 Oracle 会话，不复用旧审查会话或旧 verdict（含前轮 PASS/WARN/FAIL）；会话内已回收的调研事实可注入 Brief 作为未验证线索，但每条结论依据必须来自当前 state_head 与 diff_scope 的新鲜证据，由 Oracle 重新核验。
- **Oracle 不是实现 agent**——只读输出 graded 审查结论；不得修改代码、运行 task 或替代用户批准。
- **咨询性发现不会转移职责**——如果某项发现仅检查实现是否偏离 plan，将其记录为咨询性发现，并保持上述主要审查职责不变。

## 完成矩阵（固定格式）
审查报告必须逐行使用 \`criterion -> evidence -> status -> gap/next action\`：
\`\`\`markdown
| criterion | evidence（命令/输出或当前 diff 状态） | status | gap / next action |
|---|---|---|---|
\`\`\`
逐条覆盖 requirements acceptance criteria、edge_coverage（每个 specified/backstop 边界有证据，dismissed/deferred 有理由）、Plan 每个 Task acceptance criteria、可观察行为（truths 逐条核验：每个可观察行为有当前证据）、禁止行为（prohibitions 逐条核验：没有违规证据）、锁定决策（D-ID 覆盖核验：每个锁定决策有证据证明其完整交付，排除项未混入）、代码格式审查、以及测试、构建、real-surface 证据；每条 evidence 至少记录 command、exit_code、executed_at、state_head、diff_scope、covers 和 freshness；缺口必须具体指出缺哪个准则和证据，并回退 Execute，不得只写 \`review failed\`。
## 完成审计（覆盖矩阵）

在接受任何任务或场景确实完成之前，执行完成审计：将每项成功标准作为一行，将收集到的证据作为这些行的覆盖情况。完成度审计可用 oracle completion-audit 场景（条件触发）执行独立门禁判定；本矩阵由 Review 主流程先行构建与核查。

1. **构建矩阵**——对于每个计划中的任务/场景，列出其成功标准（行）和收集到的证据（测试、人工 QA、CLI/实时输出、代码审查、构建产物）；从 discuss 复用 requirements、edge_coverage、truths、prohibitions 和 D-ID，不重新发明验收口径。
2. **要求覆盖**——每项准则至少必须由一条可验证证据覆盖。没有证据的准则就是缺口。
3. **将不确定性视为未达成**——如果无法用证据确认某项准则，即使工作看似完成，也不能视为完成。绝不接受口头的“已完成”。
4. **报告缺口**——BLOCKER 缺口不得将任务标记为完成，列出缺失准则并退回 Execute；WARNING 记录影响和建议动作后可继续；UNCERTAIN 暂停并用 \`question\` 请求用户决策。按 evidence tier 审计：Tier 1（可复现测试/构建输出）优先，Tier 2（绑定当前 diff 的人工代码审查/CLI 输出）可覆盖其余准则，Tier 3（口头或未绑定状态的声明）不计入证据。BLOCKER 退回最多 3 轮；第 3 轮仍有未覆盖准则时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（模板须含推荐项及理由）。review_loop 开启时适用上述 3 轮复审上限；review_loop 关闭时 BLOCKER 一次性修复并取得当前状态验证证据后按快速路径直接 Finish，修复持续失败时同样按 3 轮中断上报模板上报。
5. **证据必须可审计**——优先将每条证据绑定到其时间点/git 状态；如果代码发生变化，旧证据即已过时，必须针对当前状态重新记录，绝不将其重新粘贴或生成后当作新证据。
6. **矩阵全绿才算完成**——每项准则都有证据时，任务才真正完成；否则仍未完成。

## 检查清单
- [ ] 已根据 spec 和 plan 审查输出
- [ ] 已对实际代码 diff 执行并记录项目约定的格式化/格式检查，且格式证据包含完整输出、退出码和当前 diff 范围
- [ ] 已用证据验证发现
- [ ] 在必要时已将高强度审查升级给 @oracle
- [ ] 仅在门禁通过后推进阶段
- [ ] 已执行完成审计：每项准则均有证据覆盖（矩阵全绿）

## 规则
- Review 是阶段之间的必经步骤，且正式审查默认由 Oracle 执行；Completion Audit 可作为其完成矩阵核查的一部分。
- 除非最终状态发生变化，否则不要重复已有证据。
- 如果某项发现无法验证，应明确说明不确定性，而不是自行假定。
- **CBM 边界**：对变更入口与影响面做独立验证，以实际 diff 为准，并与 plan 的 impact_estimate 普通对比；CBM 不可用时明确记录降级证据。
- **CBM 预算与 fail-open**：纯文档 diff 不初始化；非文档 diff 遵守 30s + 最多一次 60s 重试、总预算 90s。失败只标记 \`cbm: stale\` 并用 grep/read+手工 diff 继续，不能把 CBM 故障当作 Review 失败。
- 在将任何任务标记为真正完成前执行完成审计；缺口（未覆盖准则）应退回 execute，不得接受。
`,
};

export { OCEANUS_REVIEW_SKILL };
