/** 统一审核协议：纯逻辑核心，无 IO、无 agent 依赖。
 *  六不变量：①审核对象为落盘 artifact（路径可寻址+白名单）②verdict 三档契约
 *  ③findings 统一分级+evidence+fix ④REJECT 受限循环 ⑤fresh-session 独立性 ⑥审核者只读。 */

/** verdict 契约：gate 为历史兼容类型（当前按 advisory 处理）/ graded 三级 / advisory 不阻断。 */
export type ReviewContract = 'gate' | 'graded' | 'advisory';
/** 审核者角色（协议不感知具体 agent 实现，仅作标注与提示组装）。 */
export type Reviewer = 'oracle' | 'observer';
/** 问题分级：BLOCKER 必须修复才能通过；SUGGESTION 建议修复。 */
export type Severity = 'BLOCKER' | 'WARNING' | 'INFO' | 'SUGGESTION';
/** verdict 种类：gate 产出 OKAY/REJECT，graded 产出 PASS/WARN/FAIL，advisory 产出 ADVISORY。 */
export type VerdictKind = 'OKAY' | 'REJECT' | 'PASS' | 'WARN' | 'FAIL' | 'ADVISORY';

export interface Finding {
  severity: Severity;
  evidence: string;
  fix: string;
  dimension?: string;
  description?: string;
  impact?: string;
  fixHint?: string;
  confidence?: string;
}

/** 审核场景定义；具体场景由 scenes.ts 提供，本模块只承载协议逻辑。 */
export interface ReviewScene {
  name: string;
  reviewer: Reviewer;
  subjectType: 'plan' | 'diff' | 'artifact' | 'image' | 'completion';
  subjectGlobs: readonly string[];   // 审核对象路径白名单，如 ['.omo/plans/*.md', '.oceanus/plan/*.md']
  contract: ReviewContract;
  checks: string;                    // 检查清单文本
  /** 委派该场景时委派方必须附带的对象/信息（单一来源：主 agent 委派协议与 oracle 场景指令均从此拼装）。 */
  requiredContext: readonly string[];
  independence: 'fresh-session' | 'reusable';
  maxRounds: number;                 // 默认 3
  onReject: 'revise-plan' | 'return-execute' | 'escalate';
}

/** 一次审核请求：场景名 + 对象路径 + 上下文 + 轮次 + 前轮 BLOCKER。 */
export interface ReviewRequest {
  scene: string;
  subjectPath: string;
  contextPaths?: string[];
  round: number;                     // 从 1 起
  priorBlockers?: readonly Finding[];
}

/** 审核结论：kind + 分级 findings；解析失败时 parseVerdict 返回 null 而非伪造结论。 */
export interface ReviewVerdict { kind: VerdictKind; blockers: Finding[]; suggestions: Finding[]; }

/** 重审循环规则文本：历史兼容场景仅作 advisory，不构成当前工作流门禁。 */
export const REVIEW_LOOP_RULES = [
  '## 重审循环规则',
  '- REJECT/FAIL 触发受限重审：每轮只验证前轮 BLOCKER 是否修复 + 修订新引入的问题，不追加旧问题。',
  '- 重审轮数上限为 3 轮；第 3 轮仍 REJECT/FAIL 时停止重审，按统一 3 轮中断上报模板上报。',
  '- 审核通过后，重审计数清零。',
].join('\n');

/** 场景工厂：maxRounds 默认 3，onReject 默认 return-execute。 */
export function defineScene(
  input: Omit<ReviewScene, 'maxRounds' | 'onReject'> & Partial<Pick<ReviewScene, 'maxRounds' | 'onReject'>>,
): ReviewScene {
  return { ...input, maxRounds: input.maxRounds ?? 3, onReject: input.onReject ?? 'return-execute' };
}

/** 极简 glob → 正则：`*` 匹配除 `/` 外任意字符，其余字符按字面量处理。 */
function globToRegExp(glob: string): RegExp {
  const source = glob.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${source}$`);
}

/** 校验审核对象路径：必须相对仓库根（拒绝绝对路径、`..`、`file://` 前缀）且命中场景白名单 glob。 */
export function validateSubjectPath(scene: ReviewScene, subjectPath: string): boolean {
  if (!subjectPath) return false;
  if (subjectPath.startsWith('/')) return false;
  if (subjectPath.startsWith('file://')) return false;
  if (subjectPath.split('/').includes('..')) return false;
  return scene.subjectGlobs.some((glob) => globToRegExp(glob).test(subjectPath));
}

/** 组装审核提示词：任务头 + 只读/独立性约束 + 检查清单 + 契约指令 + findings 格式 +（round>1 时）复审约束 + 循环规则。 */
export function buildReviewPrompt(scene: ReviewScene, request: ReviewRequest): string {
  const contractRules: Record<ReviewContract, string> = {
    gate: '历史兼容场景按 advisory 处理：输出分析与建议，不生成二元放行要求，也不阻断工作流。',
    graded: '必须在行首单独输出 PASS、WARN 或 FAIL 作为结论词，随后给出依据。',
    advisory: '输出建议即可，不输出任何 verdict 字面量（不出现 [OKAY]/[REJECT]，也不以行首 PASS/WARN/FAIL 作结论）。',
  };

  const sections: string[] = [
    '## 审核任务',
    `- 场景: ${scene.name}（审核者: ${scene.reviewer}，契约: ${scene.contract}）`,
    `- 审核对象: ${request.subjectPath}`,
    ...(request.contextPaths?.length ? [`- 参考上下文: ${request.contextPaths.join('、')}`] : []),
    `- 轮次: ${request.round}/${scene.maxRounds}`,
    '## Oracle Brief 要求',
    '- 委派方必须先提供结构化 Oracle Brief：目标、待辅助决策、需求范围、当前状态、影响面、方案权衡、证据索引、state_head、diff_scope、证据新鲜度和预期输出。',
    '- 不得用聊天历史或未列出的隐含背景补齐缺失字段；缺失信息必须列为信息缺口，不得假设已确认。',
    '## 审核者约束',
    '- 只读审核：不得创建、修改、删除任何文件，不得执行任何写入类操作。',
    ...(scene.independence === 'fresh-session'
      ? ['- 独立性: 本次为新会话，禁止携带前次咨询/分析结论，仅基于本提示列出的材料独立判断。']
      : []),
    '## 检查清单',
    scene.checks,
    `## 输出契约（${scene.contract}）`,
    contractRules[scene.contract],
    '## Findings 格式',
    scene.contract === 'graded'
      ? '- 每条问题分级为 BLOCKER（必须修复才能通过）、WARNING（质量风险）或 INFO（参考信息），并附 evidence（证据/出处）与 fix（建议的修改）。'
      : '- 每条问题分级为 BLOCKER（必须修复才能通过）或 SUGGESTION（建议修复），并附 evidence（证据/出处）与 fix（建议的修改）。',
  ];

  if (request.round > 1) {
    sections.push(
      `## 复审约束（第 ${request.round} 轮）`,
      '- 只验证前轮 BLOCKER 是否已修复 + 修订新引入的问题，不追加旧问题。',
      '- 前轮 BLOCKER 清单:',
      ...(request.priorBlockers?.length
        ? request.priorBlockers.map((f, i) => `  ${i + 1}. [${f.severity}] ${f.evidence} → ${f.fix}`)
        : ['  （无，按首轮标准执行）']),
    );
  }

  sections.push(REVIEW_LOOP_RULES);
  return sections.join('\n');
}

/** 从 REJECT 输出的 Blocking Issues 段提取数字编号条目；宽松解析：整行作为 fix，severity 默认 BLOCKER。 */
function parseBlockingIssues(text: string): Finding[] {
  const headingRe = /^[ \t]*(?:#{1,6}[ \t]+|\*\*)?Blocking Issues\b/i;
  const itemRe = /^[ \t]*\d+[.)、][ \t]*(.+)$/;
  const findings: Finding[] = [];
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (!inSection) {
      if (headingRe.test(line)) inSection = true;
      continue;
    }
    const item = itemRe.exec(line);
    if (item) {
      findings.push({ severity: 'BLOCKER', evidence: '', fix: item[1]!.trim() });
      continue;
    }
    // 空行允许出现在条目之间；遇到非条目正文即结束本段
    if (line.trim() === '') continue;
    break;
  }
  return findings;
}

/** 解析审核输出为 verdict；只认字面量，解析不到返回 null（invalid input，不猜测）。 */
export function parseVerdict(text: string, contract: ReviewContract): ReviewVerdict | null {
  if (contract === 'advisory') return { kind: 'ADVISORY', blockers: [], suggestions: [] };
  if (contract === 'gate') {
    // 保留历史文本解析兼容；该结果不应被当前工作流用作门禁。
    if (/\[REJECT\]/.test(text)) return { kind: 'REJECT', blockers: parseBlockingIssues(text), suggestions: [] };
    if (/\[OKAY\]/.test(text)) return { kind: 'OKAY', blockers: [], suggestions: [] };
    return null;
  }
  // graded：行首 + 词边界，避免句子中误匹配（如 "能够 PASS 评审"）
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const normalized = firstLine.trim();
  const kind = normalized === 'PASS' || normalized === 'FAIL'
    ? normalized
    : normalized.match(/^WARN\s*:/)
      ? 'WARN'
      : null;
  return kind ? { kind, blockers: [], suggestions: [] } : null;
}
