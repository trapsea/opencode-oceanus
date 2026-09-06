import { describe, expect, test } from 'bun:test';
import { OCEANUS_BRAINSTORM_SKILL } from './oceanus-brainstorm';
import { OCEANUS_INTAKE_SKILL } from './oceanus-intake';
import { OCEANUS_PLAN_SKILL } from './oceanus-plan';

const content = OCEANUS_PLAN_SKILL.content;
const intakeContent = OCEANUS_INTAKE_SKILL.content;
const brainstormContent = OCEANUS_BRAINSTORM_SKILL.content;

describe('Plan 双门禁与 impact_estimate 契约', () => {
  test('执行配置批问归属 Intake，Brainstorm 只消费配置并执行方案批准', () => {
    expect(intakeContent).toContain('执行配置批问（一问四项）');
    expect(intakeContent).toContain('execution_config');
    expect(intakeContent).toContain('Oracle 门禁审核');
    expect(intakeContent).toContain('SDD');
    expect(intakeContent).toContain('TDD');
    expect(intakeContent).toContain('连续执行授权');
    expect(brainstormContent).toContain('调用方可以使用 `intake_report`，但它不是硬性前置条件');
    expect(brainstormContent).toContain('方案总批准');
    expect(brainstormContent).not.toContain('执行配置批问（一问四项）');
  });

  test('三个 Skill 文本不再引用 metis/momus', () => {
    for (const text of [intakeContent, brainstormContent, content]) {
      expect(text).not.toContain('Metis');
      expect(text).not.toContain('Momus');
      expect(text).not.toContain('@metis');
      expect(text).not.toContain('@momus');
    }
  });

  test('Plan 说明使用中文自然语言', () => {
    expect(content).not.toMatch(/Plan changes after approval|re-run the @oracle/);
  });
  test('覆盖四种人工状态与 question 闭环', () => {
    for (const status of ['APPROVED', 'NEEDS_CHANGES', 'CANCELLED', 'PENDING']) expect(content).toContain(status);
    expect(content).toContain('question');
    expect(content).toMatch(/silence remains.*PENDING|沉默.*PENDING/);
  });

  test('固定记录 Gate Status 字段', () => {
    expect(content).toContain('Gate Status');
    expect(content).toContain('gate: { verdict, round, verifiedAt }');
    expect(content).toContain('human: { status, reason, verifiedAt, via }');
    expect(content).toContain("via: 'consolidated'");
  });

  test('Sisyphus 先做 impact_estimate 且处理缺失覆盖不足', () => {
    expect(content).toMatch(/Sisyphus.*impact_estimate/);
    expect(content).toMatch(/缺失或覆盖不足/);
    expect(content).toMatch(/plan-gate 场景只检查.*覆盖/);
  });

  test('Plan 变化触发重审', () => {
    expect(content).toMatch(/计划变更后/);
    expect(content).toMatch(/需求或验收标准变化[^\n]{0,80}配置批问与方案总批准一并失效/);
    expect(content).toMatch(/再次运行.*oracle 门禁.*question/);
  });
});
