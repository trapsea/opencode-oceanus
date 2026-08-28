import { describe, expect, test } from 'bun:test';
import { SISYPHUS_SKILLS } from './index';
import type { SkillDefinition } from './types';

type Skill = SkillDefinition;

/** 阶段 skill 名称，来自 SISYPHUS_SKILLS 聚合导出 */
const STAGE_NAMES = [
  'sisyphus-intake',
  'sisyphus-brainstorm',
  'sisyphus-plan',
  'sisyphus-execute',
  'sisyphus-review',
  'sisyphus-finish',
] as const;

const CONTRACT_FIELDS = [
  'input',
  'owner',
  'output',
  'entry',
  'exit',
  'failure',
  'verification',
  'humanReview',
] as const;

const HUMAN_REVIEW_BY_STAGE: Record<(typeof STAGE_NAMES)[number], 'required' | 'conditional' | 'none'> = {
  'sisyphus-intake': 'required',
  'sisyphus-brainstorm': 'required',
  'sisyphus-plan': 'required',
  'sisyphus-execute': 'conditional',
  'sisyphus-review': 'conditional',
  'sisyphus-finish': 'none',
};

function frontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  expect(match, '阶段 Skill 必须包含 frontmatter').toBeTruthy();
  return Object.fromEntries(
    (match?.[1] ?? '')
      .split('\n')
      .map((line) => line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/))
      .filter((entry): entry is RegExpMatchArray => entry !== null)
      .map(([, key, value]) => [key, value.trim()]),
  );
}

function byName(name: string): Skill {
  const skill = SISYPHUS_SKILLS.find((s) => s.name === name);
  expect(skill, `SISYPHUS_SKILLS 中缺少阶段 skill: ${name}`).toBeDefined();
  return skill as Skill;
}

describe('SISYPHUS_SKILLS 聚合契约', () => {
  test('六个阶段 skill 均存在且内容非空', () => {
    for (const name of STAGE_NAMES) {
      const skill = byName(name);
      expect(skill.content.trim(), `${name} 的 content 不能为空`).not.toBe('');
    }
  });

  test('六个阶段 skill 名称互不重复且顺序正确', () => {
    const names = SISYPHUS_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.indexOf('sisyphus-intake')).toBeLessThan(names.indexOf('sisyphus-brainstorm'));
  });
});

describe('六阶段 Skill 结构化契约', () => {
  test('六个阶段按固定顺序注册', () => {
    const names = SISYPHUS_SKILLS.map((skill) => skill.name);
    expect(names.slice(names.indexOf('sisyphus-intake'), names.indexOf('sisyphus-finish') + 1)).toEqual([
      ...STAGE_NAMES,
    ]);
  });

  for (const name of STAGE_NAMES) {
    test(`${name} 声明完整的 8 个契约字段`, () => {
      const fields = frontmatter(byName(name).content);
      for (const field of CONTRACT_FIELDS) {
        expect(fields[field], `${name} 缺少契约字段 ${field}`).toBeTruthy();
      }
    });

    test(`${name} 的 humanReview 值符合阶段约定`, () => {
      const fields = frontmatter(byName(name).content);
      expect(['required', 'conditional', 'none']).toContain(fields.humanReview);
      expect(fields.humanReview).toBe(HUMAN_REVIEW_BY_STAGE[name]);
    });
  }
});

describe('Phase 1 — intake 契约', () => {
  const content = byName('sisyphus-intake').content;
  test('包含五项职责', () => {
    for (const duty of ['澄清', '范围', '验收', '风险', '交接']) expect(content).toContain(duty);
  });
  test('代码/混合任务直接初始化，非代码任务跳过并 fail-open', () => {
    expect(content).toContain('cbm_index');
    expect(content).toMatch(/代码|code/i);
    expect(content).toMatch(/非代码|non-?code|跳过|skip/i);
    expect(content).toMatch(/fail-?open|回退|fallback/i);
  });
});

describe('Phase 2 — brainstorm 契约', () => {
  const content = byName('sisyphus-brainstorm').content;

  test('上下文优先，方案分析仅按条件委派', () => {
    expect(content).toMatch(/上下文|context/i);
    expect(content).toMatch(/SOLUTION_ANALYSIS|独立分析/i);
  });

  test('用户澄清与批准由主 Agent 负责', () => {
    expect(content).toMatch(/主 Agent|Sisyphus/i);
    expect(content).toMatch(/澄清|approval|批准/i);
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

describe('Phase 3 — plan 契约', () => {
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

  test('Plan 具有 Momus 与人工批准双门禁', () => {
    expect(content).toMatch(/@momus[\s\S]*OKAY/);
    expect(content).toMatch(/人工批准|human approval|approval/i);
    expect(content).toMatch(/双|both|two gates|两个门禁/i);
  });
});

describe('Phase 4 — execute 契约', () => {
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

describe('Phase 5 — review 契约', () => {
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

  test('Review 明确 evidence、tests 与 matrix 输入', () => {
    expect(content).toMatch(/evidence.*tests.*matrix|证据.*测试.*矩阵/i);
  });
});

describe('Phase 6 — finish 契约', () => {
  const content = byName('sisyphus-finish').content;

  test('Finish 声明输入与禁止动作', () => {
    expect(content).toMatch(/input|输入/i);
    expect(content).toMatch(/不测试|不构建|不调用 CBM|不委派|不修改文件|must not|do not/i);
  });

  test('humanReview 支持 conditional 且执行阶段采用 conditional', () => {
    expect(frontmatter(byName('sisyphus-execute').content).humanReview).toBe('conditional');
    expect(content).toMatch(/humanReview\s*:\s*(none|conditional|required)/i);
  });
});

// ─────────────────────────── CBM 阶段边界契约（CBM-04）───────────────────────────
// 阶段 skill 的 CBM 动作必须与主 agent 的 CBM 阶段边界一致：
// intake 负责代码/混合任务初始化；brainstorm/plan 不触发索引；
// execute 高风险公共符号修改前 trace/impact；review 独立验证、CBM 不可用记录降级。
describe('CBM 阶段边界契约', () => {
  const brainstorm = byName('sisyphus-brainstorm').content;
  const plan = byName('sisyphus-plan').content;
  const execute = byName('sisyphus-execute').content;
  const review = byName('sisyphus-review').content;

  describe('brainstorm — 不触发全量索引，仅符号定位', () => {
    test('不得包含 cbm_index（全量索引指令）', () => {
      expect(brainstorm).not.toContain('cbm_index');
    });

    test('不得包含 autoIndex→cbm_status 初始化链', () => {
      expect(brainstorm).not.toMatch(/autoIndex[\s\S]{0,80}cbm_status/);
    });

    test('保留符号定位（cbm_search_graph / cbm_trace）', () => {
      expect(brainstorm).toMatch(/cbm_search_graph|cbm_trace/);
    });

    test('明确不因普通文本探索触发全量索引', () => {
      expect(brainstorm).toMatch(/全量索引|不.*(索引|触发)/);
    });
  });

  describe('brainstorm/plan — 不初始化 CBM', () => {
    test('brainstorm 与 plan 均不得初始化索引', () => {
      expect(brainstorm).not.toContain('cbm_index');
      expect(plan).not.toContain('cbm_index');
    });
  });

  describe('review — 前置索引初始化', () => {
    test('Review 查询前直接执行 cbm_index', () => {
      expect(review).toMatch(/cbm_index[\s\S]{0,200}(查询|query|search|trace|code)/i);
    });
    test('明确 Review 前执行 cbm_index', () => expect(review).toMatch(/before review|Review 前|review 前/i));
  });

  describe('execute — 高风险公共符号修改前 trace/impact', () => {
    test('高风险公共符号修改前先 cbm_trace/cbm_query 做影响分析', () => {
      expect(execute).toMatch(/高风险[\s\S]{0,100}(cbm_trace|cbm_query)[\s\S]{0,100}(影响|impact)/);
    });

    test('普通机械修改不强制查询', () => {
      expect(execute).toMatch(/普通机械修改[\s\S]{0,60}(不强制|无需|可选)/);
    });
  });

  describe('review — 独立验证与降级证据', () => {
    test('对变更入口与影响面独立验证', () => {
      expect(review).toMatch(/变更入口[\s\S]{0,80}独立验证/);
    });

    test('CBM 不可用时记录降级证据', () => {
      expect(review).toMatch(/CBM 不可用[\s\S]{0,80}(降级|degrade)/);
    });
  });

  describe('plan — momus 影响面预估（门禁必查项）', () => {
    test('Momus must check 清单包含影响面预估项', () => {
      expect(plan).toMatch(/影响面预估|Impact surface/i);
      expect(plan).toContain('cbm_trace');
      expect(plan).toContain('REJECT');
      expect(plan).toMatch(/plan status|plan 状态/);
    });

    test('预估结论记入 plan status 供 Review 对比', () => {
      expect(plan).toMatch(/预估结论[\s\S]{0,160}plan status|plan status[\s\S]{0,160}预估结论/);
    });
  });

  describe('review — 影响面复查三步（重建索引 → 再查 diff → 对比预估）', () => {
    test('Step 1：开始即 cbm_index 重建索引', () => {
      expect(review).toMatch(/cbm_index[\s\S]{0,120}(rebuild|重建)/i);
    });

    test('Step 2：对实际 diff 再次排查影响面', () => {
      expect(review).toMatch(/cbm_detect_changes|再次排查/);
      expect(review).toMatch(/实际 diff|actual diff/i);
    });

    test('Step 3：与 plan status 中 momus 的预估对比', () => {
      expect(review).toMatch(/momus[\s\S]{0,80}预估|预估[\s\S]{0,80}momus/i);
      expect(review).toMatch(/预估[\s\S]{0,60}对比|对比[\s\S]{0,60}预估/);
    });
  });
});
