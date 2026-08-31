import { describe, expect, test } from 'bun:test';
import { decideFinish, SISYPHUS_FINISH_SKILL, type FinishInput } from './sisyphus-finish';

const { content, description } = SISYPHUS_FINISH_SKILL;

describe('Finish 自包含判定矩阵', () => {
  const complete: FinishInput = { review: 'accepted', completion: 'green', ledger: 'complete', momus: 'OKAY', human: 'APPROVED', evidence: 'fresh' };

  test('六类输入全部满足时才允许完成', () => {
    expect(decideFinish(complete)).toEqual({ complete: true, gaps: [] });
  });

  test('所有负向状态均默认拒绝', () => {
    const cases: Array<[keyof FinishInput, FinishInput[keyof FinishInput]]> = [
      ['review', 'pending'], ['review', 'rejected'], ['review', 'missing'],
      ['completion', 'red'], ['completion', 'incomplete'],
      ['ledger', 'failed'], ['ledger', 'blocked'], ['ledger', 'pending'],
      ['momus', 'REJECT'], ['momus', 'PENDING'], ['momus', 'missing'],
      ['human', 'REJECTED'], ['human', 'PENDING'], ['human', 'missing'],
      ['evidence', 'stale'], ['evidence', 'missing'],
    ];
    for (const [key, value] of cases) {
      const input = { ...complete, [key]: value } as FinishInput;
      expect(decideFinish(input).complete).toBe(false);
      expect(decideFinish(input).gaps.length).toBeGreaterThan(0);
    }
  });
  test('覆盖所有阻断状态与全绿完成条件', () => {
    for (const gap of ['Review 报告缺失', 'Completion Matrix 未全绿', 'ledger 存在 failed', 'ledger 存在 blocked', 'ledger 存在 pending', 'Gate Status 为 PENDING']) {
      expect(content).toContain(gap);
    }
    expect(content).toContain('Review 报告存在');
    expect(content).toContain('全绿');
    expect(content).toContain('完成');
  });

  test('缺口必须明确输出', () => {
    expect(content).toMatch(/明确输出.*缺口.*不确定性/);
  });

  test('frontmatter 与 TypeScript description 唯一且一致', () => {
    const match = content.match(/^description:\s*(.+)$/m);
    expect(match?.[1]).toBe(description);
    expect((content.match(/^description:/gm) ?? []).length).toBe(1);
  });
});
