import { describe, expect, test } from 'bun:test';
import { buildOceanusPrompt } from './oceanus';
import { createSisyphusAgent } from './sisyphus';
import { createExplorerAgent } from './explorer';
import { createOracleAgent } from './oracle';
import { createLibrarianAgent } from './librarian';
import { createFixerAgent } from './fixer';
import { createAgents } from './index';
import { SISYPHUS_BRAINSTORM_SKILL } from '../skills/sisyphus-brainstorm';
import { SISYPHUS_REVIEW_SKILL } from '../skills/sisyphus-review';

const registered = ['cbm_status', 'cbm_index', 'cbm_search_graph', 'cbm_trace', 'cbm_code', 'cbm_query', 'cbm_detect_changes'];

describe('CBM-GATE-01 静态提示词契约', () => {
  test('sisyphus prompt 声明五阶段并包含 finish', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toMatch(/intake[\s\S]*brainstorm[\s\S]*plan[\s\S]*execute[\s\S]*review[\s\S]*finish/i);
  });

  test('SOLUTION_ANALYSIS 具有完整前置条件且不承担 Intake', () => {
    const prompt = createAgents().find((a) => a.name === 'metis')!.system!;
    expect(prompt).toMatch(/INTAKE/i);
    expect(prompt).toMatch(/SOLUTION_ANALYSIS/i);
    expect(prompt).toMatch(/exactly one mode|一个模式/i);
    expect(prompt).toMatch(/explicitly requested|明确指定/i);
    expect(prompt).toMatch(/clarification|澄清/);
    expect(prompt).toMatch(/unresolved|未决/);
    expect(prompt).toMatch(/do not silently perform Intake|不得.*Intake/i);
  });

  test('Sisyphus 直接完成 Intake，代码/混合任务只尝试一次并 fail-open', () => {
    const prompt = `${createSisyphusAgent().system!}\n${SISYPHUS_BRAINSTORM_SKILL.content}`;
    expect(prompt).toMatch(/Intake/);
    expect(prompt).toContain('cbm_index');
    expect(prompt).toMatch(/failure[\s\S]*timeout[\s\S]*in-progress|失败[\s\S]*超时[\s\S]*in-progress/i);
    expect(prompt).toMatch(/fail-open/i);
    expect(prompt).toMatch(/code\/mixed|代码\/混合/);
  });

  test('澄清、批准由主 Agent，专业能力条件委派，Finish 不委派', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toMatch(/主 Agent.*澄清|owns clarification|user clarification/i);
    expect(prompt).toMatch(/approval|批准/);
    expect(prompt).toMatch(/delegate when|委派|按需/);
    expect(prompt).toMatch(/Finish/);
  });

  test('Plan 必须经过 Momus OKAY，并保留人工批准门禁', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toMatch(/@momus[\s\S]*OKAY[\s\S]*execute/i);
    expect(prompt).toMatch(/REJECT[\s\S]*(back to plan|回.*plan)/i);
    expect(prompt).toMatch(/human approval|人工批准|approval/i);
    expect(prompt).toMatch(/both|双|two gates|两个门禁/i);
  });

  test('Review 的 subagent、Momus、Sisyphus 证据边界明确', () => {
    const review = SISYPHUS_REVIEW_SKILL.content;
    expect(review).toMatch(/Review subagent.*只读.*不修改代码.*不运行 task/i);
    expect(review).toMatch(/Momus.*审查 evidence.*不.*替代.*代码 review/i);
    expect(review).toMatch(/Sisyphus.*owns.*review|Sisyphus.*负责.*review/i);
    expect(review).toMatch(/@oracle.*independent code review|@oracle.*独立.*代码审查/i);
    expect(review).toMatch(/uncertainty.*not achieved|不确定性.*未达成/i);
    expect(review).toMatch(/evidence.*tests.*matrix|证据.*测试.*矩阵/i);
  });

  test('Finish 只接受阶段输入且声明禁止动作', () => {
    const prompt = `${createSisyphusAgent().system!}\n${SISYPHUS_REVIEW_SKILL.content}`;
    expect(prompt).toMatch(/Finish/);
    expect(prompt).toMatch(/input|输入/i);
    expect(prompt).toMatch(/禁止|不得|must not|do not/i);
  });

  test('仅引用已注册 CBM 工具并包含初始化规则', () => {
    const prompts = [buildOceanusPrompt(), createSisyphusAgent().system!, SISYPHUS_BRAINSTORM_SKILL.content, SISYPHUS_REVIEW_SKILL.content];
    for (const prompt of prompts) {
      expect(prompt).not.toContain('trace_path');
      for (const match of prompt.matchAll(/\bcbm_[a-z_]+\b/g)) expect(registered).toContain(match[0]);
    }
    expect(prompts.join('\n')).toMatch(/grep/);
    expect(prompts.join('\n')).toMatch(/read/);
    expect(prompts.join('\n')).toContain('cbm_index');
  });

  test('工具参数示例完整，角色边界明确', () => {
    const explorer = createExplorerAgent().system!;
    expect(explorer).toContain('cbm_status');
    expect(explorer).toContain('禁止');
    expect(explorer).toContain('query=".*OrderHandler.*"');
    expect(createOracleAgent().system).toContain('since="HEAD~1"');
    expect(createLibrarianAgent().system).toContain('fallback');
    expect(createFixerAgent().system).toContain('fallback');
  });
});
