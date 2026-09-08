import { describe, expect, test } from 'bun:test';
import {
  buildReviewPrompt,
  defineScene,
  parseVerdict,
  REVIEW_LOOP_RULES,
  validateSubjectPath,
} from './protocol';

/** gate 契约 + fresh-session 独立性的方案审批场景样例。 */
const planGateScene = defineScene({
  name: '方案审批',
  reviewer: 'oracle',
  subjectType: 'plan',
  subjectGlobs: ['.oceanus/plan/*.md', '.omo/plans/*.md'],
  contract: 'gate',
  checks: '- 目标与验收标准是否可测\n- 文件归属是否清晰且不越界',
  independence: 'fresh-session',
});

/** graded 契约 + reusable 会话的实现抽查场景样例。 */
const diffGradedScene = defineScene({
  name: '实现抽查',
  reviewer: 'oracle',
  subjectType: 'diff',
  subjectGlobs: ['.oceanus/review/*.md'],
  contract: 'graded',
  checks: '- 是否符合计划',
  independence: 'reusable',
});

describe('parseVerdict · gate', () => {
  test('裸 [OKAY] 解析为 OKAY', () => {
    const verdict = parseVerdict('前置检查完成\n[OKAY]', 'gate');
    expect(verdict?.kind).toBe('OKAY');
    expect(verdict?.blockers).toEqual([]);
  });

  test('加粗 **[OKAY]** 同样解析为 OKAY', () => {
    expect(parseVerdict('结论：**[OKAY]**', 'gate')?.kind).toBe('OKAY');
  });

  test('REJECT 提取 Blocking Issues 数字编号条目', () => {
    const text = [
      '**[REJECT]**',
      '',
      '## Blocking Issues',
      '1. 计划缺少验收标准：需要补充 tests 字段',
      '2. 文件归属越界：需要收窄到 src/review/',
    ].join('\n');
    const verdict = parseVerdict(text, 'gate');
    expect(verdict?.kind).toBe('REJECT');
    expect(verdict?.blockers).toHaveLength(2);
    expect(verdict?.blockers[0]).toEqual({
      severity: 'BLOCKER',
      evidence: '',
      fix: '计划缺少验收标准：需要补充 tests 字段',
    });
    expect(verdict?.blockers[1]?.fix).toBe('文件归属越界：需要收窄到 src/review/');
  });

  test('REJECT 无 Blocking Issues 段时 blockers 为空', () => {
    const verdict = parseVerdict('**[REJECT]**\n问题过多，整体退回。', 'gate');
    expect(verdict?.kind).toBe('REJECT');
    expect(verdict?.blockers).toEqual([]);
  });

  test('[OKAY] 与 [REJECT] 同时出现时取 REJECT（fail-closed）', () => {
    expect(parseVerdict('整体尚可 [OKAY]，但关键项缺失 [REJECT]', 'gate')?.kind).toBe('REJECT');
  });

  test('无 verdict 字面量返回 null', () => {
    expect(parseVerdict('这个计划整体可行，细节见正文。', 'gate')).toBeNull();
  });
});

describe('parseVerdict · graded', () => {
  test('首行 PASS 解析为 PASS', () => {
    expect(parseVerdict('PASS\n细节略', 'graded')?.kind).toBe('PASS');
  });

  test('行首 WARN: 前缀解析为 WARN', () => {
    expect(parseVerdict('WARN: 有一处建议', 'graded')?.kind).toBe('WARN');
  });

  test('行首 FAIL 解析为 FAIL', () => {
    expect(parseVerdict('FAIL\n原因见下', 'graded')?.kind).toBe('FAIL');
  });

  test('PASS 作为普通词缀不误判（词边界）', () => {
    expect(parseVerdict('PASSING 状态良好', 'graded')).toBeNull();
  });

  test('句子中包含 PASS 但不在行首时不误判', () => {
    expect(parseVerdict('整体来看该计划能够 PASS 评审，但缺少行首结论。', 'graded')).toBeNull();
  });

  test('无行首结论词返回 null', () => {
    expect(parseVerdict('- 检查项 1 通过\n- 检查项 2 通过', 'graded')).toBeNull();
  });
});

describe('parseVerdict · advisory', () => {
  test('任意文本均返回 ADVISORY 且不要求字面量', () => {
    const verdict = parseVerdict('建议补充回滚说明。', 'advisory');
    expect(verdict?.kind).toBe('ADVISORY');
    expect(verdict?.blockers).toEqual([]);
    expect(verdict?.suggestions).toEqual([]);
  });
});

describe('validateSubjectPath', () => {
  test('匹配场景白名单 glob 的相对路径通过', () => {
    expect(validateSubjectPath(planGateScene, '.oceanus/plan/oracle-review-protocol.md')).toBe(true);
    expect(validateSubjectPath(planGateScene, '.omo/plans/main.md')).toBe(true);
  });

  test('包含 .. 的路径被拒绝', () => {
    expect(validateSubjectPath(planGateScene, '../etc/secrets.md')).toBe(false);
    expect(validateSubjectPath(planGateScene, '.oceanus/plan/../../x.md')).toBe(false);
  });

  test('绝对路径与 file:// 前缀被拒绝', () => {
    expect(validateSubjectPath(planGateScene, '/etc/passwd')).toBe(false);
    expect(validateSubjectPath(planGateScene, 'file:///tmp/x.md')).toBe(false);
  });

  test('不在白名单 glob 内的路径被拒绝', () => {
    expect(validateSubjectPath(planGateScene, '.oceanus/plan/readme.txt')).toBe(false);
    expect(validateSubjectPath(planGateScene, 'docs/plan.md')).toBe(false);
  });

  test('* 不跨越路径分隔符 /', () => {
    expect(validateSubjectPath(planGateScene, '.oceanus/plan/sub/deep.md')).toBe(false);
  });
});

describe('buildReviewPrompt', () => {
  test('包含场景名、对象路径、参考上下文与检查清单', () => {
    const prompt = buildReviewPrompt(planGateScene, {
      scene: planGateScene.name,
      subjectPath: '.oceanus/plan/oracle-review-protocol.md',
      contextPaths: ['docs/tooling-and-runtime.md'],
      round: 1,
    });
    expect(prompt).toContain('方案审批');
    expect(prompt).toContain('.oceanus/plan/oracle-review-protocol.md');
    expect(prompt).toContain('docs/tooling-and-runtime.md');
    expect(prompt).toContain('文件归属是否清晰且不越界');
  });

  test('Brief 路径化三要素：路径引用、内联上限、读取优先级', () => {
    const prompt = buildReviewPrompt(planGateScene, {
      scene: planGateScene.name,
      subjectPath: '.oceanus/plan/x.md',
      round: 1,
    });
    expect(prompt).toContain('Brief 路径化');
    expect(prompt).toContain('路径引用与不超过 3 行的短摘要');
    expect(prompt).toContain('读取优先级');
    expect(prompt).toContain('审核对象/diff > 验收标准 > plan > 其他上下文');
  });

  test('历史 gate 场景兼容为 advisory，不生成放行 verdict', () => {
    const prompt = buildReviewPrompt(planGateScene, {
      scene: planGateScene.name,
      subjectPath: '.oceanus/plan/x.md',
      round: 1,
    });
    expect(prompt).toContain('历史兼容');
    expect(prompt).not.toContain('**[OKAY]**');
    expect(prompt).not.toContain('**[REJECT]**');
  });

  test('graded 契约包含 PASS/WARN/FAIL 指令且不含 gate 指令', () => {
    const prompt = buildReviewPrompt(diffGradedScene, {
      scene: diffGradedScene.name,
      subjectPath: '.oceanus/review/x.md',
      round: 1,
    });
    expect(prompt).toContain('PASS');
    expect(prompt).toContain('WARN');
    expect(prompt).toContain('FAIL');
    expect(prompt).not.toContain('**[OKAY]**');
  });

  test('round=1 不注入复审约束', () => {
    const prompt = buildReviewPrompt(planGateScene, {
      scene: planGateScene.name,
      subjectPath: '.oceanus/plan/x.md',
      round: 1,
    });
    expect(prompt).not.toContain('复审约束');
  });

  test('round>1 注入复审约束与前轮 BLOCKER 清单', () => {
    const prompt = buildReviewPrompt(planGateScene, {
      scene: planGateScene.name,
      subjectPath: '.oceanus/plan/x.md',
      round: 2,
      priorBlockers: [{ severity: 'BLOCKER', evidence: '缺少验收', fix: '补充 tests 字段' }],
    });
    expect(prompt).toContain('复审约束');
    expect(prompt).toContain('第 2 轮');
    expect(prompt).toContain('缺少验收');
    expect(prompt).toContain('补充 tests 字段');
  });

  test('fresh-session 场景声明新会话独立性，reusable 不声明', () => {
    const fresh = buildReviewPrompt(planGateScene, {
      scene: planGateScene.name,
      subjectPath: '.oceanus/plan/x.md',
      round: 1,
    });
    expect(fresh).toContain('本次为新会话');
    const reusable = buildReviewPrompt(diffGradedScene, {
      scene: diffGradedScene.name,
      subjectPath: '.oceanus/review/x.md',
      round: 1,
    });
    expect(reusable).not.toContain('本次为新会话');
  });

  test('包含只读审核约束与重审循环规则', () => {
    const prompt = buildReviewPrompt(planGateScene, {
      scene: planGateScene.name,
      subjectPath: '.oceanus/plan/x.md',
      round: 1,
    });
    expect(prompt).toContain('不得创建、修改、删除任何文件');
    expect(prompt).toContain(REVIEW_LOOP_RULES);
  });
});

describe('defineScene', () => {
  test('maxRounds 默认 3、onReject 默认 return-execute', () => {
    expect(planGateScene.maxRounds).toBe(3);
    expect(planGateScene.onReject).toBe('return-execute');
  });

  test('显式传入的 maxRounds/onReject 保留', () => {
    const scene = defineScene({
      name: '完成复核',
      reviewer: 'observer',
      subjectType: 'image',
      subjectGlobs: ['.oceanus/media/*.png'],
      contract: 'advisory',
      checks: '- 视觉一致性',
      independence: 'fresh-session',
      maxRounds: 2,
      onReject: 'escalate',
    });
    expect(scene.maxRounds).toBe(2);
    expect(scene.onReject).toBe('escalate');
  });
});

describe('REVIEW_LOOP_RULES', () => {
  test('包含 3 轮上限、受限验证范围与计数清零规则', () => {
    expect(REVIEW_LOOP_RULES).toContain('3 轮');
    expect(REVIEW_LOOP_RULES).toContain('不追加旧问题');
    expect(REVIEW_LOOP_RULES).toContain('清零');
  });
});
