import { describe, expect, test } from 'bun:test';
import { defineScene } from './protocol';

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

describe('defineScene', () => {
  test('maxRounds 默认 3、onReject 默认 return-execute', () => {
    expect(planGateScene.maxRounds).toBe(3);
    expect(planGateScene.onReject).toBe('return-execute');
    expect(diffGradedScene.maxRounds).toBe(3);
    expect(diffGradedScene.onReject).toBe('return-execute');
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
