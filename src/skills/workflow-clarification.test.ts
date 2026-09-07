import { describe, expect, test } from 'bun:test';
import { OCEANUS_SKILLS } from './index';
import { OCEANUS_FINISH_SKILL, decideFinish, type FinishInput } from './oceanus-finish';
import { createSisyphusAgent } from '../agents/sisyphus';

const skill = (name: string) => OCEANUS_SKILLS.find((item) => item.name === name)!;

describe('Sisyphus 工作流澄清契约', () => {
  test('Skill 注册对象包含分类，阶段与支持型 Skill 可区分', () => {
    for (const item of OCEANUS_SKILLS) expect(item.category).toBeDefined();
    expect(skill('oceanus-intake').category).toBe('phase');
    expect(skill('oceanus-debugging').category).toBe('support');
  });

  test('调度协议由 Agent 常驻 prompt 提供，不注册调度 Skill', () => {
    expect(skill('oceanus-orchestration')).toBeUndefined();
  });

  test('TypeScript description 与 frontmatter 保持同步', () => {
    for (const item of OCEANUS_SKILLS) {
      expect(item.content.match(/^description:\s*(.+)$/m)?.[1]).toBe(item.description);
    }
  });

  test('六阶段总契约已内置到 Sisyphus，不注册 workflow Skill', () => {
    const prompt = createSisyphusAgent().system!;
    expect(skill('oceanus-workflow')).toBeUndefined();
    expect(prompt).toContain('phase_handoff');
    expect(prompt).toContain('current_phase');
    expect(prompt).toContain('next_action');
  });

  test('Review BLOCKER 默认自动闭环到 Finish', () => {
    const review = skill('oceanus-review').content;
    const execute = skill('oceanus-execute').content;
    expect(createSisyphusAgent().system).toContain('自动回退闭环');
    expect(review).toContain('不得等待用户再次提示');
    expect(review).toContain('全部 blocker 任务');
    expect(execute).toContain('自动重新进入 Review');
    expect(execute).toContain('BLOCKER 清单');
  });

  test('CBM 区分 Intake 首次初始化与 Review 刷新', () => {
    expect(createSisyphusAgent().system).toContain('首次初始化');
    expect(createSisyphusAgent().system).toContain('刷新');
    expect(skill('oceanus-review').content).toContain('刷新');
  });

  test('Finish 不要求人工批准且不写入经验文件', () => {
    const complete: FinishInput = {
      review: 'accepted', completion: 'green', ledger: 'complete', evidence: 'fresh',
    };
    expect(decideFinish(complete)).toEqual({ complete: true, gaps: [] });
    expect(OCEANUS_FINISH_SKILL.content).not.toContain('human（APPROVED）');
    expect(OCEANUS_FINISH_SKILL.content).not.toContain('learnings/');
  });

  test('discuss 主流程要求 Intake，允许只读调研但禁止写入 worker', () => {
    const content = skill('oceanus-discuss').content;
    expect(content).toContain('主流程必须有 `intake_report`');
    expect(content).toContain('只读调研');
    expect(content).toContain('写入 worker');
    expect(content).toContain('多选');
  });
});
