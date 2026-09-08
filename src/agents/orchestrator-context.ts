/** 委派给子 agent 的显式上下文；不得依赖父会话中未传递的隐含信息。 */
export interface DelegationBrief {
  goal: string | string[]; background: string | string[]; decisions: string | string[]; files: string | string[];
  forbidden: string | string[]; dependencies: string | string[]; acceptance: string | string[]; tests: string | string[]; risks: string | string[];
}
function render(value: string | string[]): string { return Array.isArray(value) ? value.join('\n') : value; }

export type OracleScene = 'consult' | 'analysis' | 'review' | 'diff-review' | 'completion-audit';

/** Oracle 的完整调度上下文；摘要负责定向，路径负责让 Oracle 自行读取原始证据。 */
export interface OracleBrief {
  scene: OracleScene;
  objective: string;
  decisionNeeded: string;
  recommendationStatus: string;
  currentPhase: string;
  goal: string | string[];
  userIntent: string | string[];
  acceptanceCriteria: string | string[];
  nonGoals: string | string[];
  constraints: string | string[];
  currentState: string | string[];
  changedFiles: string | string[];
  changedSymbols: string | string[];
  impact: string | string[];
  callChain: string | string[];
  behavior: string | string[];
  alternatives: string | string[];
  selectedApproach: string | string[];
  tradeoffs: string | string[];
  rejectedOptions: string | string[];
  lockedDecisions: string | string[];
  assumptions: string | string[];
  edgeCoverage: string | string[];
  truths: string | string[];
  prohibitions: string | string[];
  evidence: string | string[];
  priorFindings: string | string[];
  unresolvedBlockers: string | string[];
  contextPaths: string | string[];
  expectedOutput: string | string[];
  stateHead: string;
  diffScope: string;
  evidenceFreshness: string;
}

const ORACLE_BRIEF_FIELDS = [
  'scene', 'objective', 'decisionNeeded', 'recommendationStatus', 'currentPhase', 'goal', 'acceptanceCriteria', 'constraints',
  'currentState', 'changedFiles', 'impact', 'evidence', 'contextPaths', 'expectedOutput',
  'stateHead', 'diffScope', 'evidenceFreshness',
] as const satisfies readonly (keyof OracleBrief)[];

const ORACLE_SCENE_FIELDS: Record<OracleScene, readonly (keyof OracleBrief)[]> = {
  consult: ['currentState', 'changedSymbols', 'impact', 'callChain', 'behavior', 'alternatives', 'evidence'],
  analysis: ['alternatives', 'selectedApproach', 'tradeoffs', 'rejectedOptions', 'lockedDecisions', 'assumptions', 'edgeCoverage', 'truths', 'prohibitions'],
  review: ['userIntent', 'nonGoals', 'changedFiles', 'changedSymbols', 'impact', 'callChain', 'behavior', 'acceptanceCriteria', 'lockedDecisions', 'edgeCoverage', 'truths', 'prohibitions', 'evidence', 'stateHead', 'diffScope', 'evidenceFreshness'],
  'diff-review': ['changedFiles', 'changedSymbols', 'impact', 'evidence', 'stateHead', 'diffScope', 'evidenceFreshness'],
  'completion-audit': ['acceptanceCriteria', 'evidence', 'priorFindings', 'unresolvedBlockers', 'evidenceFreshness'],
};

function isOracleScene(value: unknown): value is OracleScene {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ORACLE_SCENE_FIELDS, value);
}

export function getMissingOracleBriefFields(brief: Partial<OracleBrief>): string[] {
  return ORACLE_BRIEF_FIELDS.filter((field) => {
    const value = brief[field];
    return value === undefined || (typeof value === 'string' && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);
  });
}

export function getMissingOracleSceneFields(brief: Partial<OracleBrief>): string[] {
  const sceneFields = isOracleScene(brief.scene)
    ? ORACLE_SCENE_FIELDS[brief.scene]
    : [];
  const fields = [...ORACLE_BRIEF_FIELDS, ...sceneFields];
  const missing = [...new Set(fields)].filter((field) => {
    const value = brief[field];
    return value === undefined || (typeof value === 'string' && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);
  });
  if (!isOracleScene(brief.scene) && !missing.includes('scene')) missing.unshift('scene');
  return missing;
}

export function formatOracleBrief(brief: OracleBrief): string {
  const missing = getMissingOracleSceneFields(brief);
  const formalReview = brief.scene === 'review';
  const lines = [
    '## Oracle Brief',
    `- 场景: ${brief.scene}`,
    `- 目标: ${brief.objective}`,
    `- 待辅助决策: ${brief.decisionNeeded}`,
    `- 主 Agent 当前判断: ${brief.recommendationStatus}`,
    `- 当前阶段: ${brief.currentPhase}`,
    '',
    '### 需求与范围',
    `- goal: ${render(brief.goal)}`,
    `- user_intent: ${render(brief.userIntent)}`,
    `- acceptance_criteria: ${render(brief.acceptanceCriteria)}`,
    `- non_goals: ${render(brief.nonGoals)}`,
    `- constraints: ${render(brief.constraints)}`,
    '',
    '### 当前状态与影响面',
    `- current_state: ${render(brief.currentState)}`,
    `- changed_files: ${render(brief.changedFiles)}`,
    `- changed_symbols: ${render(brief.changedSymbols)}`,
    `- impact: ${render(brief.impact)}`,
    `- call_chain: ${render(brief.callChain)}`,
    `- behavior: ${render(brief.behavior)}`,
    '',
    '### 方案与边界',
    `- alternatives: ${render(brief.alternatives)}`,
    `- selected_approach: ${render(brief.selectedApproach)}`,
    `- tradeoffs: ${render(brief.tradeoffs)}`,
    `- rejected_options: ${render(brief.rejectedOptions)}`,
    `- locked_decisions: ${render(brief.lockedDecisions)}`,
    `- assumptions: ${render(brief.assumptions)}`,
    `- edge_coverage: ${render(brief.edgeCoverage)}`,
    `- truths: ${render(brief.truths)}`,
    `- prohibitions: ${render(brief.prohibitions)}`,
    '',
    '### 证据与审核边界',
    `- evidence: ${render(brief.evidence)}`,
    `- prior_findings: ${render(brief.priorFindings)}`,
    `- unresolved_blockers: ${render(brief.unresolvedBlockers)}`,
    `- context_paths: ${render(brief.contextPaths)}`,
    `- state_head: ${brief.stateHead}`,
    `- diff_scope: ${brief.diffScope}`,
    `- evidence_freshness: ${brief.evidenceFreshness}`,
    `- expected_output: ${render(brief.expectedOutput)}`,
    '- read_only: true',
    ...(formalReview ? ['- verdict: PASS/WARN/FAIL（正式 Review）'] : ['- no_verdict: true']),
  ];
  if (missing.length > 0) lines.push('', `信息缺口: ${missing.join('、')}`, formalReview ? '缺失字段不得被假设为已确认；正式 Review 必须先报告缺口。' : '缺失字段不得被假设为已确认；Oracle 只能基于可确认材料给出 advisory。');
  return lines.join('\n');
}

export function formatDelegationBrief(brief: DelegationBrief): string {
  const field = (title: string, value: string | string[]) => [`### ${title}`, render(value), ''];
  return [
    '## 委派简报', '',
    ...field('目标', brief.goal),
    ...field('背景', brief.background),
    ...field('已确认决策', brief.decisions),
    ...field('文件归属与所有权', brief.files),
    ...field('禁止事项', brief.forbidden),
    ...field('依赖与结果', brief.dependencies),
    ...field('验收标准', brief.acceptance),
    ...field('验证命令', brief.tests),
    ...field('风险与回退', brief.risks),
    '若缺少任一项，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父级 agent。',
  ].join('\n');
}

/** 子 agent 缺少父级委派上下文时的统一终止协议；调度三协议（调度/任务看板/终止状态）
 *  由 oceanus 工作流 §3 在委派简报之后原位注入，本常量不再内嵌，避免 sisyphus 双注入。 */
export const DELEGATION_BRIEF_PROMPT = `## 委派简报
  每次委派必须显式包含目标、背景、已确认决策、文件归属、禁止事项/禁区、依赖/结果、验收、测试命令和风险。子 agent 不得依赖隐含上下文。`;

/** 只读调研委派（explorer/librarian/oracle 等）的轻量上下文；文件归属/验收/测试对只读 agent 无意义，
 *  执行委派（逃生舱场景）仍使用 DelegationBrief。 */
export interface ResearchBrief {
  goal: string | string[];
  scope: string | string[];
  background?: string | string[];
  return: string | string[];
  deadline?: string | string[];
  researchQuestion?: string | string[];
  evidenceRequirements?: string | string[];
  outputFields?: string | string[];
  negativeSearch?: string | string[];
  sourceVersion?: string | string[];
  openQuestions?: string | string[];
  blockingFormat?: string | string[];
}

export function formatResearchBrief(brief: ResearchBrief): string {
  const lines = ['## 调研简报', `- 目标: ${render(brief.goal)}`, `- 检索范围: ${render(brief.scope)}`];
  if (brief.background !== undefined) lines.push(`- 背景: ${render(brief.background)}`);
  lines.push(`- 返回: ${render(brief.return)}`);
  if (brief.deadline !== undefined) lines.push(`- 软期限: ${render(brief.deadline)}`);
  if (brief.researchQuestion !== undefined) lines.push(`- 研究问题: ${render(brief.researchQuestion)}`);
  if (brief.evidenceRequirements !== undefined) lines.push(`- 证据要求: ${render(brief.evidenceRequirements)}`);
  if (brief.outputFields !== undefined) lines.push(`- 输出字段: ${render(brief.outputFields)}`);
  if (brief.negativeSearch !== undefined) lines.push(`- 负向检索: ${render(brief.negativeSearch)}`);
  if (brief.sourceVersion !== undefined) lines.push(`- 版本锚定: ${render(brief.sourceVersion)}`);
  if (brief.openQuestions !== undefined) lines.push(`- 未知项: ${render(brief.openQuestions)}`);
  if (brief.blockingFormat !== undefined) lines.push(`- 阻塞格式: ${render(brief.blockingFormat)}`);
  lines.push('', '每条结论必须包含 claim、evidence、status、source_version、impact、open_questions、negative_findings；缺少可定位证据或无法完成检索时，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父级 agent。', '调研结果缺少文件路径/行号或 qualified name 证据时，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父级 agent。');
  return lines.join('\n');
}

/** 只读调研委派的默认协议；与 DELEGATION_BRIEF_PROMPT 同样由工作流在委派之后原位注入，避免双注入。 */
export const RESEARCH_BRIEF_PROMPT = `## 调研简报
  只读调研委派默认使用调研简报（研究问题/检索范围/证据要求/输出字段/负向检索/版本锚定/未知项/阻塞格式）；执行委派（逃生舱）才使用完整委派简报。每条结论统一输出 claim、evidence、status、source_version、impact、open_questions、negative_findings。子 agent 不得依赖隐含上下文。`;
