import { describe, expect, test } from 'bun:test';
import { SISYPHUS_PLAN_SKILL } from './sisyphus-plan';

const content = SISYPHUS_PLAN_SKILL.content;

describe('Plan 双门禁与 impact_estimate 契约', () => {
  test('覆盖四种人工状态与 question 闭环', () => {
    for (const status of ['APPROVED', 'NEEDS_CHANGES', 'CANCELLED', 'PENDING']) expect(content).toContain(status);
    expect(content).toContain('question');
    expect(content).toMatch(/silence remains.*PENDING|沉默.*PENDING/);
  });

  test('固定记录 Gate Status 字段', () => {
    expect(content).toContain('Gate Status');
    expect(content).toContain('momus: { verdict, round, verifiedAt }');
    expect(content).toContain('human: { status, reason, verifiedAt, via }');
    expect(content).toContain("via: 'consolidated'");
  });

  test('Sisyphus 先做 impact_estimate 且处理缺失覆盖不足', () => {
    expect(content).toMatch(/Sisyphus.*impact_estimate/);
    expect(content).toMatch(/缺失或覆盖不足/);
    expect(content).toMatch(/Momus 只检查.*覆盖/);
  });

  test('Plan 变化触发重审', () => {
    expect(content).toMatch(/Plan changes after approval/);
    expect(content).toMatch(/需求或验收标准变化[^\n]{0,80}配置批问与方案总批准一并失效/);
    expect(content).toMatch(/re-run.*@momus.*question/);
  });
});
