/**
 * CBM 规则注册表（单一来源）。
 *
 * 收敛散落在各 agent prompt / skill / 测试中的 CBM 规则文本：
 * - `CBM_TOOLS`：注册工具名的唯一硬编码处（tools/cbm/builders.ts 与契约测试共用）；
 * - `CBM_QUERY_EXAMPLES`：共享查询示例族（OrderHandler）；
 * - `CBM_LIFECYCLE`：六阶段 CBM 主线（intake 初始化 → momus 校验 impact_estimate →
 *   review 影响面复查），完整文本只注入 sisyphus 主 agent 一处；
 * - `cbmSection(role)`：explorer/oracle/fixer/librarian/momus/metis 的角色 CBM
 *   段落（差异化语义保留，工具名/示例/公共句从本模块拼装）。
 *
 * 主线语义（三阶段闭环）：
 * 1. Intake：代码/混合任务由 Sisyphus 直接 `cbm_index` 一次，fail-open，全工作流
 *    唯一初始化点；
 * 2. Momus 影响面预估校验：plan → execute 门禁审查时，校验 Plan 的 impact_estimate
 *    是否覆盖已知影响面；不要求 Momus 执行完整 trace；结论写入 plan status 供 Review 对比；
 * 3. Review 影响面复查：`cbm_index` 重建索引后对实际 diff 再次排查，并与 momus
 *    预估对比；CBM 不可用记录降级证据。
 *
 * 本模块是纯文本/常量模块，不依赖 agents 或 tools，避免循环引用。
 */

/** 注册的 CBM 工具名（顺序稳定；唯一硬编码处）。 */
export const CBM_TOOLS = [
  'cbm_status',
  'cbm_index',
  'cbm_search_graph',
  'cbm_trace',
  'cbm_code',
  'cbm_query',
  'cbm_detect_changes',
] as const;

export type CbmTool = (typeof CBM_TOOLS)[number];

/** 查询型工具集合：不触发全量索引，只读分析使用。 */
export const CBM_QUERY_TOOLS: readonly CbmTool[] = [
  'cbm_status',
  'cbm_search_graph',
  'cbm_trace',
  'cbm_code',
  'cbm_query',
  'cbm_detect_changes',
] as const;

/** 共享查询示例族（各角色段落按需引用，避免六处硬编码漂移）。 */
export const CBM_QUERY_EXAMPLES =
    '示例：cbm_search_graph(query=".*OrderHandler.*", limit=20)、' +
  'cbm_trace(symbol="pkg.OrderHandler", direction="inbound")、' +
  'cbm_code(qualified_name="pkg.OrderHandler")、' +
  'cbm_query(query="MATCH ... RETURN ...")、' +
  'cbm_detect_changes(since="HEAD~1")。';

/** 公共边界句：文本/AST/文件发现/外部资料不用 CBM 替代。 */
export const CBM_BOUNDARY_NOTE =
  '结构化符号/调用链/依赖检索优先 CBM；字符串、注释、正则文本用 grep，' +
  'AST 结构匹配用 ast_grep_search，文件名/目录发现用 glob/read，' +
  '外部库资料用 websearch/webfetch，均不用 CBM 替代。';

/** 公共证据句：qualified name / 文件路径 / 行号 / 不确定性 / fail-open。 */
export const CBM_EVIDENCE_NOTE =
  '输出证据必须包含符号名、qualified name、文件路径、行号；' +
  'CBM 证据不足或查询失败时明确标记不确定性并 fail-open 回退 grep/read，' +
  '不把图谱结果当作完整证明。';

/**
 * 六阶段 CBM 主线（完整文本）。
 * 只注入 sisyphus 主 agent 一处；oceanus 等其他 prompt 仅拼装片段
 * （`CBM_BOUNDARY_NOTE` / `CBM_QUERY_EXAMPLES`），防止双重注入。
 */
export const CBM_LIFECYCLE = {
  /** 一句话摘要（供简要引用场景）。 */
  brief:
    'Intake 唯一初始化（cbm_index 一次、故障开放）→ momus 门禁校验 Plan impact_estimate 覆盖情况（建议性、故障开放）并记入 plan status → review 重建索引后对实际 diff 再次排查影响面并与预估对比。',
  /** 完整主线（`## CBM 阶段边界` 段正文）。 */
  full: [
      '- intake: Sisyphus 直接完成边界收集；代码/混合任务仅尝试一次 cbm_index，失败/超时/starting 必须故障开放并记录。这是全工作流唯一初始化点，后续阶段不重复初始化。',
    '- brainstorm: 复用 Intake 报告与已建索引，仅做必要的架构/符号定位（cbm_search_graph/cbm_trace），不重复初始化 CBM，不因普通文本探索触发全量索引。',
    '- plan: 复用 Intake 报告与已建索引，仅做必要的架构/符号定位（cbm_search_graph/cbm_trace），不重复初始化 CBM。',
    '- momus 影响面预估校验（plan 门禁）: @momus 审查计划时，校验 Plan 的 impact_estimate 是否覆盖计划声明的修改文件/公共符号及已知受影响调用方/契约；必要时用 cbm_search_graph/cbm_trace/cbm_code 对关键点抽查，但不要求、不执行全量 trace。发现 impact_estimate 覆盖不足 → REJECT 并列出具体缺口；校验结论记入 plan status 供 Review 对比。Momus 仅提供 advisory 建议，不授予权限或替代完成事实；只做查询、不重建索引；CBM 不可用时 fail-open，标注不确定性，不虚构影响面；简单任务跳过校验需记录理由。',
      '- execute: 高风险公共符号修改前做 trace/impact（cbm_trace / cbm_query）；普通机械修改不强制查询。',
      '- review: 影响面复查——开始即调用已注册的 cbm_index 工具重建索引（execute 已修改代码），再对实际 diff 用 cbm_trace/cbm_detect_changes 再次排查影响面，并与 plan status 中 momus 的预估对比：一致 → 记为验证证据；不一致（新调用方受影响/预估遗漏）→ 解释或退回 execute；CBM 不可用时明确记录降级证据。',
     '- finish: 不调用 CBM，只读 Review 报告汇总。',
    '- 阶段 skill 只能补充工作流步骤，不能覆盖上述 CBM 调度边界或把 CBM 强制用于不适合的文本/AST 任务。',
  ].join('\n'),
} as const;

/** 角色 CBM 段落支持的角色集合。 */
export type CbmRole = 'explorer' | 'oracle' | 'fixer' | 'librarian' | 'momus' | 'metis';

const EXPLORER_SECTION = `**代码库知识图谱（CBM）优先级**：
1. \`cbm_search_graph\` 定位函数、类、方法、接口和模块；
2. \`cbm_trace\` 追踪 inbound/outbound 调用；
3. \`cbm_code\` 获取关键符号源码；
4. \`ast_grep_search\` 做 AST 模式搜索；
5. \`grep/glob/read\` 处理文本、文件发现和 CBM fallback。

允许查询型 CBM：cbm_status、cbm_search_graph、cbm_trace、cbm_code、cbm_query、cbm_detect_changes；禁止调用 cbm_index。

${CBM_BOUNDARY_NOTE}

${CBM_EVIDENCE_NOTE}

${CBM_QUERY_EXAMPLES}`;

const ORACLE_SECTION = `**代码图谱分析顺序**（架构/调试/审查任务）：
1. \`cbm_code\` 读取关键入口和目标符号；
2. \`cbm_trace\` 获取调用方、被调用方和关键深度；
3. \`cbm_query\` 或 \`cbm_detect_changes\` 评估影响面；
4. 再读取必要的上下文文件并给出判断；
5. CBM 证据不足时明确标记不确定性，不把图谱结果当作完整证明。

${CBM_EVIDENCE_NOTE}

${CBM_QUERY_EXAMPLES}`;

const FIXER_SECTION = `**改动前影响检查（CBM）**:
- 普通实现不强制调用 CBM；
- 涉及公共函数、接口、路由、配置契约或高风险重构时，修改前调用 \`cbm_trace\` 或 \`cbm_query\` 评估影响面；
- 修改后由主 agent 或 oracle 再做一次影响面验证；不确定影响时先查询再改；
 - CBM 不可用时 fail-open fallback 到 grep/read，不阻塞明确的机械实现。

${CBM_QUERY_EXAMPLES}`;

const LIBRARIAN_SECTION = `**本地交叉验证（CBM）**:
- 外部文档、官方 API、GitHub 示例仍使用 websearch/webfetch；
- 需要把外部结论映射到当前仓库时，使用 \`cbm_search_graph\`/\`cbm_code\` 定位本地实现；
- 不因本地代码问题而启动大范围 Web 搜索；本地定位结果带 qualified name、文件路径和行号，CBM 证据不足时标注不确定性。

${CBM_QUERY_EXAMPLES}`;

const MOMUS_SECTION = `**影响面预估校验（查询型 CBM，方案门禁项）**:
- 校验 Plan 的 impact_estimate 是否覆盖计划声明的每个修改文件/公共符号及已知受影响调用方、被调用方或契约；必要时对关键点抽查，但不要求或执行完整 trace；
- 仅在校验覆盖范围需要澄清时，对关键符号抽查：\`cbm_search_graph\` 定位 → 必要时 \`cbm_trace\`/\`cbm_code\` 核对，并列出具体缺口与 qualified name；
- 发现 impact_estimate 覆盖不足 → 判定 REJECT，并列出具体缺口；
 - 校验结论写入 plan status，供 Review 阶段做影响面复查对比；Momus 仅提供 advisory 建议，不授予权限或替代完成事实；
- 只做查询型检索：不调用 cbm_index、不重建索引（Intake 已初始化）；
 - CBM 不可用时 fail-open：标注不确定性并建议 Review 阶段补查，不虚构影响面；简单任务跳过校验需说明理由。`;

const METIS_SECTION = `**方案分析检索（CBM）**:
- SOLUTION_ANALYSIS 需要对照现有实现时，用查询型 \`cbm_search_graph\`/\`cbm_code\` 定位相关符号与调用链；
- 只做查询型检索，不初始化索引；结论引用 qualified name、文件路径与行号。`;

const SECTIONS: Record<CbmRole, string> = {
  explorer: EXPLORER_SECTION,
  oracle: ORACLE_SECTION,
  fixer: FIXER_SECTION,
  librarian: LIBRARIAN_SECTION,
  momus: MOMUS_SECTION,
  metis: METIS_SECTION,
};

/** 获取角色 CBM 段落（含公共边界句/证据句/示例的拼装）。 */
export function cbmSection(role: CbmRole): string {
  return SECTIONS[role];
}
