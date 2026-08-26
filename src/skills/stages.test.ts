import { describe, expect, test } from 'bun:test';
import { SISYPHUS_SKILLS } from './index';
import type { SkillDefinition } from './types';

type Skill = SkillDefinition;

/** 阶段 skill 名称，来自 SISYPHUS_SKILLS 聚合导出 */
const STAGE_NAMES = [
  'sisyphus-brainstorm',
  'sisyphus-plan',
  'sisyphus-execute',
  'sisyphus-review',
] as const;

function byName(name: string): Skill {
  const skill = SISYPHUS_SKILLS.find((s) => s.name === name);
  expect(skill, `SISYPHUS_SKILLS 中缺少阶段 skill: ${name}`).toBeDefined();
  return skill as Skill;
}

describe('SISYPHUS_SKILLS 聚合契约', () => {
  test('四个阶段 skill 均存在且内容非空', () => {
    for (const name of STAGE_NAMES) {
      const skill = byName(name);
      expect(skill.content.trim(), `${name} 的 content 不能为空`).not.toBe('');
    }
  });

  test('四个阶段 skill 名称互不重复', () => {
    const names = SISYPHUS_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Phase 1 — brainstorm 契约', () => {
  const content = byName('sisyphus-brainstorm').content;

  test('复杂任务先调用 @metis 深化需求与设计', () => {
    expect(content).toContain('@metis');
  });

  test('Metis 位于方案定型和批准之前', () => {
    expect(content).toMatch(
      /Run @metis[\s\S]*before finalizing[\s\S]*before presenting the design for approval/i,
    );
  });

  test('要求把需求缺口/风险/边界/反例纳入 spec', () => {
    expect(content).toMatch(/需求缺口|需求.*缺口|缺口/);
    expect(content).toMatch(/风险|risk/i);
    expect(content).toMatch(/边界|boundary|boundaries/i);
    expect(content).toMatch(/反例|counter-?example/i);
  });

  test('要求把验收标准纳入 spec', () => {
    expect(content).toMatch(/验收标准|acceptance criter/i);
  });

  test('要求 spec 纳入 .oceanus/spec/', () => {
    expect(content).toContain('.oceanus/spec/');
  });

  test('对禁用/跳过的需求条目诚实记录', () => {
    expect(content).toMatch(/禁用|disabled/i);
    expect(content).toMatch(/跳过|skip/i);
    expect(content).toMatch(/诚实|如实|honest/i);
  });
});

describe('Phase 2 — plan 契约', () => {
  const content = byName('sisyphus-plan').content;

  test('明确调用 @momus 对计划做审查', () => {
    expect(content).toContain('@momus');
  });

  test('记录 OKAY / REJECT 审查结论', () => {
    expect(content).toContain('OKAY');
    expect(content).toContain('REJECT');
  });

  test('把审查问题与修订轮次记录到 plan 状态', () => {
    expect(content).toMatch(/问题|issue|concern/i);
    expect(content).toMatch(/修订轮次|修订|轮次|revision/i);
    expect(content).toMatch(/状态|status/i);
  });

  test('REJECT 时不得进入 execute', () => {
    expect(content).toMatch(
      /REJECT[\s\S]{0,80}(不得|不能|禁止|不.*执行|no|not|never)[\s\S]{0,40}(execute|执行)/i,
    );
  });
});

describe('Phase 3 — execute 契约', () => {
  const content = byName('sisyphus-execute').content;

  test('计划实质变化或失败重规划时回到 plan 并重新经过 Momus', () => {
    expect(content).toMatch(/momus/i);
    expect(content).toMatch(/回到 *plan|回到 *计划|重新计划|re-?plan/i);
    expect(content).toMatch(/重新|再次|又一次/i);
  });

  test('普通执行不重复调用 Momus', () => {
    expect(content).toMatch(/不重复|无需.*momus|不再.*momus|仅当|只有.*才/i);
  });

  test('普通执行不要求重复调用 @metis', () => {
    expect(content).toMatch(/普通执行[\s\S]{0,120}不重复调用 @metis/);
  });
});

describe('Phase 4 — review 契约', () => {
  const content = byName('sisyphus-review').content;

  test('Sisyphus 负责 Completion Audit', () => {
    expect(content).toMatch(/Completion Audit|完成审计|完成度审计/i);
  });

  test('Oracle 负责高风险独立审查', () => {
    expect(content).toContain('@oracle');
    expect(content).toMatch(/高风险|high-?risk/i);
    expect(content).toMatch(/独立|independen/i);
  });

  test('Momus 不默认替代代码 review', () => {
    expect(content).toMatch(/momus|@momus/i);
    expect(content).toMatch(/不默认|does not.*default|not.*default|不替代|不.*取代/i);
    expect(content).toMatch(/code review|代码审查|代码.*review/i);
  });
});
