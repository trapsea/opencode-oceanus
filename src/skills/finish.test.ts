import { describe, expect, test } from 'bun:test';
import { decideFinish, OCEANUS_FINISH_SKILL, type FinishInput } from './oceanus-finish';

const { content, description } = OCEANUS_FINISH_SKILL;

describe('Finish 自包含判定矩阵', () => {
  const complete: FinishInput = { review: 'accepted', completion: 'green', ledger: 'complete', evidence: 'fresh' };

  test('Finish 说明使用中文自然语言', () => {
    expect(content).not.toMatch(/Review accepted|Completion Matrix green/);
  });

  test('四类输入全部满足时才允许完成', () => {
    expect(decideFinish(complete)).toEqual({ complete: true, gaps: [] });
  });

  test('所有负向状态均默认拒绝', () => {
    const cases: Array<[keyof FinishInput, FinishInput[keyof FinishInput]]> = [
      ['review', 'pending'], ['review', 'rejected'], ['review', 'missing'],
      ['completion', 'red'], ['completion', 'incomplete'],
      ['ledger', 'failed'], ['ledger', 'blocked'], ['ledger', 'pending'],
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

  test('不依赖 Oracle 门禁或人工批准', () => {
    expect(content).not.toMatch(/Oracle 门禁/);
    expect(content).toContain('Oracle advisory 不是完成条件');
    expect(content).not.toContain('human（APPROVED）');
    expect(content).not.toContain('learnings/');
  });

  test('frontmatter 与 TypeScript description 唯一且一致', () => {
    const match = content.match(/^description:\s*(.+)$/m);
    expect(match?.[1]).toBe(description);
    expect((content.match(/^description:/gm) ?? []).length).toBe(1);
  });
});
