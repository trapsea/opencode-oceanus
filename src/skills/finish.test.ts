import { describe, expect, test } from 'bun:test';
import { decideFinish, SISYPHUS_FINISH_SKILL, type FinishInput } from './sisyphus-finish';

const { content, description } = SISYPHUS_FINISH_SKILL;

describe('Finish 自包含判定矩阵', () => {
  const complete: FinishInput = { review: 'accepted', completion: 'green', ledger: 'complete', momus: 'OKAY', human: 'APPROVED', evidence: 'fresh' };

  test('Finish 说明使用中文自然语言', () => {
    expect(content).not.toMatch(/Review accepted|Completion Matrix green/);
  });

  test('六类输入全部满足时才允许完成', () => {
    expect(decideFinish(complete)).toEqual({ complete: true, gaps: [] });
  });

  test('Momus 用户豁免（waived）放行完成', () => {
    const waived = { ...complete, momus: 'waived' as const };
    expect(decideFinish(waived)).toEqual({ complete: true, gaps: [] });
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
  test('完成条件与当前目录收尾语义', () => {
    expect(content).toContain('Review（accepted）');
    expect(content).toContain('Completion Matrix（green）');
    expect(content).toContain('ledger（complete）');
    expect(content).toContain('当前目录');
    expect(content).toContain('只做正常只读交付汇总');
  });

  test('缺口必须明确输出', () => {
    expect(content).toMatch(/明确输出.*缺口.*不确定性/);
  });

  test('waived 豁免语义与防伪口径', () => {
    expect(content).toMatch(/有效豁免/);
  });

  test('frontmatter 与 TypeScript description 唯一且一致', () => {
    const match = content.match(/^description:\s*(.+)$/m);
    expect(match?.[1]).toBe(description);
    expect((content.match(/^description:/gm) ?? []).length).toBe(1);
  });
});
