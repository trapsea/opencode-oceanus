import { describe, expect, test } from 'bun:test';
import { buildReviewPrompt, validateSubjectPath } from './protocol';
import { getReviewScene, REVIEW_SCENES } from './scenes';
import { createSisyphusAgent } from '../agents/sisyphus';

describe('REVIEW_SCENES 注册表', () => {
    test('注册正式 Review 与辅助审核场景', () => {
    expect(Object.keys(REVIEW_SCENES).sort()).toEqual([
      'completion-audit',
      'diff-review',
      'plan-gate',
      'review',
      'solution-analysis',
      'visual-acceptance',
    ]);
  });

  test('plan-gate：保留历史协议兼容注册', () => {
    const scene = REVIEW_SCENES['plan-gate']!;
    expect(scene.name).toBe('plan-gate');
    expect(scene.reviewer).toBe('oracle');
    expect(scene.subjectType).toBe('plan');
    expect(scene.subjectGlobs).toEqual(['.oceanus/plan/*.md', '.omo/plans/*.md']);
    expect(scene.contract).toBe('advisory');
  });

  test('solution-analysis：oracle 方案分析（advisory/reusable/escalate/maxRounds=3）', () => {
    const scene = REVIEW_SCENES['solution-analysis']!;
    expect(scene.name).toBe('solution-analysis');
    expect(scene.reviewer).toBe('oracle');
    expect(scene.subjectType).toBe('plan');
    expect(scene.subjectGlobs).toEqual(['.oceanus/spec/*.md', '.oceanus/plan/*.md', '.omo/plans/*.md']);
    expect(scene.contract).toBe('advisory');
    expect(scene.independence).toBe('reusable');
    expect(scene.onReject).toBe('escalate');
    expect(scene.maxRounds).toBe(3);
  });

  test('diff-review：oracle diff 审核（graded/fresh-session/return-execute）', () => {
    const scene = REVIEW_SCENES['diff-review']!;
    expect(scene.name).toBe('diff-review');
    expect(scene.reviewer).toBe('oracle');
    expect(scene.subjectType).toBe('diff');
    expect(scene.subjectGlobs).toEqual(['.oceanus/**/*.md', '.omo/**/*.md', '*.diff', '*.patch', '.oceanus/**/*.diff', '.oceanus/**/*.patch']);
    expect(scene.contract).toBe('graded');
    expect(scene.independence).toBe('fresh-session');
    expect(scene.onReject).toBe('return-execute');
    expect(scene.maxRounds).toBe(3);
  });

  test('completion-audit：Review 主流程完成矩阵（advisory/fresh-session）', () => {
    const scene = REVIEW_SCENES['completion-audit']!;
    expect(scene.name).toBe('completion-audit');
    expect(scene.reviewer).toBe('oracle');
    expect(scene.subjectType).toBe('completion');
    expect(scene.subjectGlobs).toEqual(['.oceanus/progress/*.md', '.oceanus/review/*.md', '.omo/**/*.md']);
    expect(scene.contract).toBe('advisory');
    expect(scene.independence).toBe('fresh-session');
    expect(scene.onReject).toBe('return-execute');
    expect(scene.maxRounds).toBe(3);
    expect(scene.maxRounds).toBe(3);
  });

  test('visual-acceptance：observer 视觉验收（graded/fresh-session/return-execute）', () => {
    const scene = REVIEW_SCENES['visual-acceptance']!;
    expect(scene.name).toBe('visual-acceptance');
    expect(scene.reviewer).toBe('observer');
    expect(scene.subjectType).toBe('image');
    expect(scene.subjectGlobs).toEqual(['.oceanus/media/*', '*.png', '*.jpg', '*.jpeg', '*.webp']);
    expect(scene.contract).toBe('graded');
    expect(scene.independence).toBe('fresh-session');
    expect(scene.onReject).toBe('return-execute');
    expect(scene.maxRounds).toBe(3);
  });
});

describe('getReviewScene', () => {
  test('按名返回已注册场景', () => {
    expect(getReviewScene('plan-gate')?.name).toBe('plan-gate');
    expect(getReviewScene('solution-analysis')?.contract).toBe('advisory');
    expect(getReviewScene('visual-acceptance')?.reviewer).toBe('observer');
  });

  test('未知名返回 undefined', () => {
    expect(getReviewScene('nonexistent')).toBeUndefined();
    expect(getReviewScene('')).toBeUndefined();
    expect(getReviewScene('plan_gate')).toBeUndefined();
  });
});

describe('plan-gate · momus 契约迁移', () => {
  const scene = getReviewScene('plan-gate');
  test('场景已注册，checks 非空', () => {
    expect(scene).toBeDefined();
    expect(scene!.checks.length).toBeGreaterThan(0);
  });
  const checks = scene!.checks;

  test('保留历史检查清单与影响面上下文（不作为工作流门禁）', () => {
    for (const anchor of [
      'BLOCKER',
      'SUGGESTION',
      '最多 3 条',
      '最小修订集',
      'impact_estimate',
      '不伪造',
    ]) {
      expect(checks).toContain(anchor);
    }
  });

  test('保留依赖/范围/测试策略/可执行性四维检查与可用起点要求', () => {
    expect(checks).toContain('依赖是否齐全');
    expect(checks).toContain('范围');
    expect(checks).toContain('测试策略');
    expect(checks).toContain('可执行');
    expect(checks).toContain('可用的起点');
  });

  test('继承 MOMUS_SECTION 的 impact_estimate 覆盖校验语义', () => {
    expect(checks).toContain('impact_estimate 覆盖');
    expect(checks).toContain('不要求、不执行完整 trace');
    expect(checks).toContain('plan status');
    expect(checks).toContain('fail-open');
    expect(checks).toContain('不虚构影响面');
  });

  test('验收标准绑定可执行验证命令（PLAN_ACCEPTANCE_RUBRIC 语义）', () => {
    expect(checks).toContain('验证命令');
    expect(checks).toContain('预期输出');
    expect(checks).toContain('抽查集');
  });

  test('历史场景明确可由协议兼容保留', () => {
    expect(scene!.name).toBe('plan-gate');
  });

  test('review：Oracle 正式全量审查（graded/fresh-session/return-execute）', () => {
    const scene = REVIEW_SCENES['review']!;
    expect(scene.reviewer).toBe('oracle');
    expect(scene.subjectType).toBe('diff');
    expect(scene.contract).toBe('graded');
    expect(scene.independence).toBe('fresh-session');
    expect(scene.onReject).toBe('return-execute');
    for (const dimension of ['性能', '安全', '边界', '可靠性', '兼容']) {
      expect(scene.checks).toContain(dimension);
    }
  });
});

describe('solution-analysis · metis 契约迁移', () => {
  const checks = REVIEW_SCENES['solution-analysis']!.checks;

  test('保留双模式与不授权语义', () => {
    expect(checks).toContain('SOLUTION_ANALYSIS');
    expect(checks).toContain('BACKGROUND_RESEARCH');
    expect(checks).toContain('不授权');
  });

  test('不含 [OKAY] 字面量（advisory 不产出 verdict）', () => {
    expect(checks).not.toContain('[OKAY]');
    expect(checks).not.toContain('[REJECT]');
  });

  test('结论引用可定位证据（qualified name/文件路径/行号）', () => {
    expect(checks).toContain('qualified name');
    expect(checks).toContain('文件路径');
    expect(checks).toContain('行号');
  });
});

describe('buildReviewPrompt 集成冒烟（plan-gate）', () => {
  test('必附上下文仍注入审核提示', () => {
    const scene = getReviewScene('plan-gate');
    expect(scene).toBeDefined();
    const prompt = buildReviewPrompt(scene!, {
      scene: 'plan-gate',
      subjectPath: '.oceanus/plan/x.md',
      round: 1,
    });
    expect(prompt).toContain('plan-gate');
    expect(prompt).toContain('.oceanus/plan/x.md');
    // 检查清单随场景注入
    expect(prompt).toContain('impact_estimate');
    expect(prompt).toContain('最小修订集');
  });
});

describe('validateSubjectPath · plan-gate', () => {
  const scene = getReviewScene('plan-gate')!;

  test('接受白名单内的相对路径', () => {
    expect(validateSubjectPath(scene, '.oceanus/plan/foo.md')).toBe(true);
    expect(validateSubjectPath(scene, '.omo/plans/main.md')).toBe(true);
  });

  test('拒绝含 .. 的越界路径', () => {
    expect(validateSubjectPath(scene, '.oceanus/plan/../../etc/passwd')).toBe(false);
  });
});

describe('validateSubjectPath · diff-review（含 .oceanus 内 .diff/.patch 落盘路径）', () => {
  const scene = getReviewScene('diff-review')!;

  test('接受 .oceanus 深层的 diff/patch 产物与本仓规范路径', () => {
    expect(validateSubjectPath(scene, '.oceanus/review/oracle-review-protocol.diff')).toBe(true);
    expect(validateSubjectPath(scene, '.oceanus/review/legacy.patch')).toBe(true);
    expect(validateSubjectPath(scene, 'changes.diff')).toBe(true);
    expect(validateSubjectPath(scene, '.oceanus/review/report.md')).toBe(true);
  });

  test('拒绝范围外路径', () => {
    expect(validateSubjectPath(scene, 'src/foo.ts')).toBe(false);
    expect(validateSubjectPath(scene, '.oceanus/review/../../etc/passwd')).toBe(false);
  });
});

describe('requiredContext · 委派必附上下文（单一来源）', () => {
  test('全部场景声明 requiredContext 且非空', () => {
    for (const [name, scene] of Object.entries(REVIEW_SCENES)) {
      expect(scene.requiredContext.length, `${name} requiredContext 非空`).toBeGreaterThan(0);
      for (const item of scene.requiredContext) {
        expect(item.length, `${name} 条目非空串`).toBeGreaterThan(4);
      }
    }
  });

  test('plan-gate 必附上下文覆盖 spec/会话内调研结论/前轮 BLOCKER', () => {
    const ctx = REVIEW_SCENES['plan-gate']!.requiredContext.join('\n');
    expect(ctx).toContain('spec / intake');
    expect(ctx).toContain('会话内已回收的 research_brief');
    expect(ctx).not.toContain('.oceanus/findings');
    expect(ctx).toContain('round=N、前轮 BLOCKER');
  });

  test('sisyphus 负责 Oracle 正式 Review 编排边界', () => {
    const system = createSisyphusAgent().system!;
    expect(system).toContain('Oracle 顾问');
    expect(system).toContain('Review 阶段执行正式只读审查');
    expect(system).toContain('BLOCKER 回退');
  });
});
