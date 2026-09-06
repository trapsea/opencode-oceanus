import { describe, expect, test } from 'bun:test';
import { buildOceanusPrompt } from './oceanus';
import { createSisyphusAgent } from './sisyphus';
import { createExplorerAgent } from './explorer';
import { createOracleAgent } from './oracle';
import { createLibrarianAgent } from './librarian';
import { createFixerAgent } from './fixer';
import { OCEANUS_BRAINSTORM_SKILL } from '../skills/oceanus-brainstorm';
import { OCEANUS_REVIEW_SKILL } from '../skills/oceanus-review';
import { CBM_LIFECYCLE, CBM_TOOLS, cbmSection } from '../cbm/registry';

/** 注册工具名来自注册表单一来源（src/cbm/registry.ts）。 */
const registered = CBM_TOOLS;

describe('CBM-GATE-01 静态提示词契约', () => {
  test('提示词自然语言使用中文', () => {
    expect(createSisyphusAgent().system!).not.toMatch(/You are an?\s+|You must\s+/);
  });
  test('sisyphus prompt 声明五阶段并包含 finish', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toMatch(/intake[\s\S]*brainstorm[\s\S]*plan[\s\S]*execute[\s\S]*review[\s\S]*finish/i);
  });

  test('Sisyphus 直接完成 Intake，代码/混合任务只尝试一次并 fail-open', () => {
    const prompt = `${createSisyphusAgent().system!}\n${OCEANUS_BRAINSTORM_SKILL.content}`;
    expect(prompt).toMatch(/Intake/);
    expect(prompt).toContain('cbm_index');
    expect(prompt).toMatch(/failure[\s\S]*timeout[\s\S]*(starting|stale)|失败[\s\S]*超时[\s\S]*(starting|stale)/i);
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

  test('Plan 必须经过 oracle 场景 gate OKAY，并保留人工批准门禁', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toMatch(/@oracle[\s\S]*OKAY[\s\S]*execute/i);
    expect(prompt).toMatch(/REJECT[\s\S]*(back to plan|回.*plan)/i);
    expect(prompt).toMatch(/human approval|人工批准|approval/i);
    expect(prompt).toMatch(/both|双|two gates|两个门禁/i);
  });

  test('Review 的 subagent、oracle gate 场景、Sisyphus 证据边界明确', () => {
    const review = OCEANUS_REVIEW_SKILL.content;
    expect(review).toMatch(/Review subagent.*只读.*不修改代码.*不运行 task/i);
    expect(review).toContain('代码审查走 diff-review 场景（条件触发）');
    expect(review).toMatch(/Sisyphus.*负责 spec\/plan\/diff 审查、测试验证和完成审计/);
    expect(review).toMatch(/@oracle.*独立代码审查/);
    expect(review).toMatch(/不确定性.*未达成/);
    expect(review).toContain('核查 evidence、tests 与 completionMatrix');
  });

  test('Finish 只接受阶段输入且声明禁止动作', () => {
    const prompt = `${createSisyphusAgent().system!}\n${OCEANUS_REVIEW_SKILL.content}`;
    expect(prompt).toMatch(/Finish/);
    expect(prompt).toMatch(/input|输入/i);
    expect(prompt).toMatch(/禁止|不得|must not|do not/i);
  });

  test('仅引用已注册 CBM 工具并包含初始化规则', () => {
    const prompts = [buildOceanusPrompt(), createSisyphusAgent().system!, OCEANUS_BRAINSTORM_SKILL.content, OCEANUS_REVIEW_SKILL.content];
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
    // 注册表 librarian 段以“外部资料仍使用 websearch/webfetch”表达降级语义
    //（原硬编码 fallback 措辞已收敛进注册表，见报告中的放宽说明）。
    expect(createLibrarianAgent().system).toContain('websearch/webfetch');
    expect(createFixerAgent().system).toContain('fallback');
  });

  test('角色 agent prompt 从注册表拼装 CBM 段落（单一来源）', () => {
    expect(createExplorerAgent().system).toContain(cbmSection('explorer'));
    expect(createOracleAgent().system).toContain(cbmSection('oracle'));
    expect(createLibrarianAgent().system).toContain(cbmSection('librarian'));
    expect(createFixerAgent().system).toContain(cbmSection('fixer'));
  });

  test('CBM_LIFECYCLE.full 只注入 sisyphus 一次，oceanus 基座不重复注入', () => {
    expect(buildOceanusPrompt()).not.toContain(CBM_LIFECYCLE.full);
    const sys = createSisyphusAgent().system!;
    expect(sys).toContain(CBM_LIFECYCLE.full);
    expect(sys.split(CBM_LIFECYCLE.full).length - 1).toBe(1);
  });

  test('CBM 主线句单一来源：oceanus 用注册表 brief，"唯一初始化点"两个 prompt 各至多一次', () => {
    expect(buildOceanusPrompt()).toContain(CBM_LIFECYCLE.brief);
    expect(buildOceanusPrompt().split('唯一初始化点').length - 1).toBe(0);
    const sys = createSisyphusAgent().system!;
    expect(sys.split('唯一初始化点').length - 1).toBe(1);
  });

  test('sisyphus system 含 oracle 场景 gate 影响面预估与 REJECT 门禁', () => {
    const sys = createSisyphusAgent().system!;
    expect(sys).toContain('plan-gate');
    expect(sys).toMatch(/REJECT/);
  });
});
