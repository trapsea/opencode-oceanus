import { describe, expect, test } from 'bun:test';
import { SISYPHUS_SKILLS } from './index';
import { CLIPBOARD_IMAGE_OBSERVER_SKILL } from './clipboard-image-observer';
import type { SkillDefinition } from './types';
import { createSisyphusAgent } from '../agents/sisyphus';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/** 全仓禁词（Wave 1 起该外部方法论术语全仓移除）；拆分构造，避免本测试文件自身命中扫描 */
const BANNED_TERM = new RegExp(['super', 'powers'].join(''), 'i');

/** 全仓禁词扫描的根目录与过滤规则 */
const REPO_ROOT = join(import.meta.dir, '..', '..');
const SCAN_SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const MAX_SCAN_BYTES = 1024 * 1024; // 超过 1MB 的文件跳过扫描（当前仓库无此量级文件）

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SCAN_SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
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

  test('分层呈现：Trivial 单方案 / Standard 推荐+备选 / Architecture 2-3 方案', () => {
    expect(content).toMatch(/Trivial[^\n]{0,60}单一方案/);
    expect(content).toMatch(/Standard[^\n]{0,60}推荐方案[^\n]{0,60}备选/);
    expect(content).toMatch(/Architecture[^\n]{0,60}2-3 个方案/);
  });

  test('分层背景调研：Architecture 默认委派 / Standard 两波自查后条件委派 / Trivial 不委派', () => {
    // Architecture 默认委派 BACKGROUND_RESEARCH，且必须记录返回的 task_id
    expect(content).toMatch(/Architecture[^\n]{0,200}BACKGROUND_RESEARCH/);
    expect(content).toMatch(/记录返回的 task_id/);
    // Standard 由主 Agent 两波自查，仍存未知依赖/约束才委派
    expect(content).toMatch(/Standard[^\n]{0,120}自查/);
    expect(content).toMatch(/两波后仍存在未知[^\n]{0,60}才委派/);
    // Trivial 仅最小自查、不委派；任何跳过委派必记理由
    expect(content).toMatch(/Trivial[^\n]{0,80}最小自查/);
    expect(content).toMatch(/Trivial[^\n]{0,120}不委派/);
    expect(content).toMatch(/任何跳过委派都记录理由/);
  });

  test('单次总批准为默认值制单问（frontmatter exit 同步默认值制口径）', () => {
    expect(content).toMatch(/单次总批准（consolidated approval/);
    expect(content).toMatch(/默认值制单问/);
    expect(content).toMatch(/主问方案方向/);
    // 四项执行配置默认值随选项说明带出
    expect(content).toMatch(/SDD.{0,10}（预估 >5 天默认开启、≤5 天默认关闭/);
    expect(content).toMatch(/TDD.{0,10}（[^）]{0,80}默认/);
    expect(content).toMatch(/Worktree.{0,10}（[^）]{0,80}默认/);
    expect(content).toMatch(/连续执行授权.{0,10}（默认授予/);
    // 三固定选项：按推荐执行 / 换用备选 / 自定义
    expect(content).toMatch(/①\*\*按推荐执行\*\*/);
    expect(content).toMatch(/②\*\*换用备选方案/);
    expect(content).toMatch(/③\*\*自定义\*\*/);
    expect(content).toMatch(/回落默认值/);
    expect(content).toMatch(/不补问/);
    expect(content).not.toMatch(/一次补问/);
    expect(frontmatter(byName('sisyphus-brainstorm').content).exit).toMatch(/单次总批准（默认值制单问）/);
  });

  test('上下文优先，方案分析仅按条件委派', () => {
    expect(content).toMatch(/上下文|context/i);
    expect(content).toMatch(/SOLUTION_ANALYSIS|独立分析/i);
  });

  test('用户澄清与批准由主 Agent 负责', () => {
    expect(content).toMatch(/主 Agent|Sisyphus/i);
    expect(content).toMatch(/澄清|approval|批准/i);
  });

  test('消费 metis 分析时连同建议处理方式并入方案', () => {
    expect(content).toMatch(/建议处理方式/);
    expect(content).toMatch(/并入方案呈现与 spec/);
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

  test('Brainstorm 与 Intake 的 Steps 编号连续且无异常缩进', () => {
    for (const name of ['sisyphus-brainstorm', 'sisyphus-intake']) {
      const lines = byName(name).content.split('\n');
      const steps = lines
        .filter((line) => /^\d+\.\s+/.test(line))
        .map((line) => Number(line.match(/^(\d+)\./)?.[1]));
      expect(steps, `${name} 必须存在 Steps`).not.toEqual([]);
      expect(steps).toEqual(steps.map((_, index) => index + 1));
      expect(lines.some((line) => /^\s+\d+\.\s+/.test(line))).toBe(false);
    }
  });

  test('Brainstorm 不含未定义的 spec 路径占位符', () => {
    expect(content).not.toContain('<name>');
  });

  test('Brainstorm 与 Intake 的工具调用示例使用 ASCII 标点', () => {
    for (const name of ['sisyphus-brainstorm', 'sisyphus-intake']) {
      // Wave 1 起 Intake 交接叙述句中含裸 question 一词，跨反引号正则会把叙述句误吞进 snippet；
      // 改为按反引号配对切分（split 的奇数段即反引号内文本），只检查其中含工具关键词的片段，
      // 仍覆盖全部真实工具调用示例，不缩小检查面。
      const inlineCodes = byName(name).content.split('`').filter((_, index) => index % 2 === 1);
      const snippets = inlineCodes.filter((segment) => /subagent|question|cbm_[a-z_]+/.test(segment));
      expect(snippets.length, `${name} 应存在工具调用示例`).toBeGreaterThan(0);
      for (const snippet of snippets) {
        expect(snippet, `${name} 工具示例含全角标点: ${snippet}`).not.toMatch(/[，。；：、（）“”‘’]/);
      }
    }
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

  test('REJECT 按最小修订集修订并再次调用 momus 复审', () => {
    expect(content).toContain('最小修订集');
    expect(content).toMatch(/再次调用 \`@momus\` 复审|call \`@momus\` again/);
    expect(content).toMatch(/BLOCKER\/SUGGESTION|门禁输出分级/);
  });

  test('任务粒度按实现 diff 行数与文件数双约束（非时间制）', () => {
    expect(content).not.toMatch(/2-8 小时/);
    expect(content).toMatch(/预估实现代码 diff 行数/);
    expect(content).toMatch(/普通任务 ≤2000 行且触及 ≤8 个文件/);
    expect(content).toMatch(/高风险任务 ≤500 行/);
    expect(content).toMatch(/测试代码不计入上限/);
  });

  test('行数校验闭环：execute 记录实际行数、review 对比偏差', () => {
    const execute = byName('sisyphus-execute').content;
    const review = byName('sisyphus-review').content;
    expect(execute).toMatch(/实际实现代码 diff 行数/);
    expect(execute).toMatch(/与 plan 预估行数一并写入备注/);
    expect(review).toMatch(/实际实现 diff 行数与 plan 预估行数对比/);
    expect(review).toMatch(/plan 质量信号/);
    expect(review).toMatch(/不阻断门禁/);
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

  test('串行 Wave 条件会话复用：默认全新派发，条件满足才 task_revive', () => {
    expect(content).toMatch(/默认全新派发/);
    expect(content).toMatch(/task_revive/);
    expect(content).toMatch(/同专家且相邻串行 wave/);
    expect(content).toMatch(/连续复用 ≤3 轮/);
    expect(content).toMatch(/部分完成的写改动|副作用重跑风险/);
    expect(content).toMatch(/蒸馏/);
    expect(content).toMatch(/保证随时可回退到全新派发/);
  });
});

/** 总批准失效边界：plan 与 execute 必须使用一致的变更类型 → 处理动作映射 */
const REQ_CHANGE_RE = /需求或验收标准变化[^\n]{0,200}(重新总批准|总批准失效|invalidate)/;
const NONREQ_CHANGE_RE = /(Files\/依赖\/任务结构变化或失败重规划|失败重规划)[^\n]{0,200}(不重新提问|仅重走 @momus)/;

describe('单次总批准契约（consolidated approval）', () => {
  test('brainstorm 总批准为默认值制单问：主问方案方向 + 默认值随选项带出 + 三固定选项', () => {
    const content = byName('sisyphus-brainstorm').content;
    expect(content).toContain('单次总批准');
    expect(content).toMatch(/单次总批准（consolidated approval，默认值制单问）/);
    expect(content).toMatch(/主问方案方向/);
    // 四项执行配置默认值随选项说明带出，不逐项确认
    expect(content).toMatch(/SDD.{0,10}（预估 >5 天默认开启、≤5 天默认关闭/);
    expect(content).toMatch(/TDD.{0,10}（[^）]{0,80}默认/);
    expect(content).toMatch(/Worktree.{0,10}（[^）]{0,80}默认/);
    expect(content).toMatch(/连续执行授权.{0,10}（默认授予/);
    // 三固定选项：按推荐执行 / 换用备选 / 自定义
    expect(content).toMatch(/①\*\*按推荐执行\*\*/);
    expect(content).toMatch(/②\*\*换用备选方案/);
    expect(content).toMatch(/③\*\*自定义\*\*/);
    expect(content).not.toMatch(/固定用 `question` 询问用户是否开启 SDD/);
  });

  test('brainstorm 补问例外已删除：自定义遗漏回落默认值、不补问', () => {
    const content = byName('sisyphus-brainstorm').content;
    expect(content).not.toMatch(/一次补问/);
    expect(content).toMatch(/回落默认值/);
    expect(content).toMatch(/不补问/);
    expect(content).toMatch(/不得追加批准类提问/);
  });

  test('plan 消费总批准，不再单独确认策略', () => {
    const content = byName('sisyphus-plan').content;
    expect(content).not.toMatch(/用 `question` 与用户确认 TDD 策略与 Worktree 策略/);
    expect(content).toMatch(/沿用 Brainstorm 总批准|consolidated approval|via: 'consolidated'/);
  });

  test('plan 与 execute 的总批准失效边界一致', () => {
    const plan = byName('sisyphus-plan').content;
    const execute = byName('sisyphus-execute').content;
    for (const [name, content] of [
      ['sisyphus-plan', plan],
      ['sisyphus-execute', execute],
    ] as const) {
      expect(content, `${name} 须声明需求变化触发重新总批准`).toMatch(REQ_CHANGE_RE);
      expect(content, `${name} 须声明非需求变化仅重走 momus`).toMatch(NONREQ_CHANGE_RE);
      expect(content, `${name} 非需求变化不得触发总批准失效`).not.toMatch(
        /(Files|依赖|任务结构|失败重规划)[^\n]{0,120}总批准失效/,
      );
    }
  });

  test('全部 3 轮中断点引用统一上报模板并关联 question', () => {
    const files: Array<[string, string]> = [
      ['sisyphus-brainstorm', byName('sisyphus-brainstorm').content],
      ['sisyphus-plan', byName('sisyphus-plan').content],
      ['sisyphus-execute', byName('sisyphus-execute').content],
      ['sisyphus-review', byName('sisyphus-review').content],
      ['clipboard-image-observer', CLIPBOARD_IMAGE_OBSERVER_SKILL.content],
    ];
    for (const [name, content] of files) {
      expect(content, `${name} 须引用 3 轮中断上报模板`).toMatch(/3 轮中断上报模板/);
      expect(content, `${name} 上报须用 question`).toMatch(/3 轮中断上报模板用 `question`/);
      expect(content, `${name} 上报引用模板要素`).toMatch(/模板须含推荐项及理由|2-3 个/);
      expect(content, `${name} 上报须含推荐项`).toMatch(/推荐项/);
    }
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

// ─────────────────────────── Wave 1 跨文件契约一致性与全仓禁词 ────────────────────────────
describe('Wave 1 跨文件契约一致性与全仓禁词', () => {
  const sisyphusSystem = createSisyphusAgent().system ?? '';

  test('sisyphus 主契约含 Workflow 标题、总批准默认值制口径且无禁词', () => {
    expect(sisyphusSystem).toContain('## Sisyphus Workflow');
    expect(sisyphusSystem).toContain('单次总批准（consolidated approval');
    expect(sisyphusSystem).toMatch(/回落默认值/);
    expect(sisyphusSystem).not.toMatch(BANNED_TERM);
  });

  test('复杂度分层口径在 sisyphus / intake / brainstorm 三处一致', () => {
    for (const [name, content] of [
      ['sisyphus system', sisyphusSystem],
      ['sisyphus-intake', byName('sisyphus-intake').content],
      ['sisyphus-brainstorm', byName('sisyphus-brainstorm').content],
    ] as const) {
      for (const tier of ['Trivial', 'Standard', 'Architecture'] as const) {
        expect(content, `${name} 须包含复杂度档位 ${tier}`).toContain(tier);
      }
    }
  });

  test('全仓禁词扫描：src/、docs/、README.md、AGENTS.md 均无禁词残留', () => {
    const files = [
      ...listFiles(join(REPO_ROOT, 'src')),
      ...listFiles(join(REPO_ROOT, 'docs')),
      join(REPO_ROOT, 'README.md'),
      join(REPO_ROOT, 'AGENTS.md'),
    ];
    expect(files.length, '禁词扫描应覆盖 src/ 与 docs/ 下的文件').toBeGreaterThan(0);
    for (const file of files) {
      // 超过 1MB 的文件跳过扫描（当前仓库无此量级文件）
      if (statSync(file).size > MAX_SCAN_BYTES) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, `禁词残留: ${file}`).not.toMatch(BANNED_TERM);
    }
  });
});
