import { describe, expect, test } from 'bun:test';
import { buildOceanusPrompt } from './oceanus';
import { createSisyphusAgent } from './sisyphus';
import { createExplorerAgent } from './explorer';
import { createOracleAgent } from './oracle';
import { createLibrarianAgent } from './librarian';
import { createFixerAgent } from './fixer';
import { OCEANUS_DISCUSS_SKILL } from '../skills/oceanus-discuss';
import { OCEANUS_INTAKE_SKILL } from '../skills/oceanus-intake';
import { OCEANUS_REVIEW_SKILL } from '../skills/oceanus-review';
import { CBM_LIFECYCLE, CBM_TOOLS, cbmSection } from '../cbm/registry';
import { SISYPHUS_WORKFLOW_PROTOCOL } from './protocol';

/** 注册工具名来自注册表单一来源（src/cbm/registry.ts）。 */
const registered = CBM_TOOLS;

describe('CBM-GATE-01 静态提示词契约', () => {
  test('提示词自然语言使用中文', () => {
    expect(createSisyphusAgent().system!).not.toMatch(/You are an?\s+|You must\s+/);
  });
  test('sisyphus prompt 声明五阶段并包含 finish', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toMatch(/intake[\s\S]*discuss[\s\S]*plan[\s\S]*execute[\s\S]*review[\s\S]*finish/i);
  });

  test('Sisyphus system 内置 workflow 总契约且不依赖加载 workflow Skill', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toContain(SISYPHUS_WORKFLOW_PROTOCOL.trim());
    expect(prompt).toContain('阶段 Skill 是详细操作手册，不是遵守本总契约的前置条件');
    expect(prompt).not.toContain('加载 oceanus-workflow Skill 获取六阶段顺序');
    expect(prompt.indexOf('<Role>')).toBeLessThan(prompt.indexOf('<Agents>'));
    expect(prompt.indexOf('<Agents>')).toBeLessThan(prompt.indexOf('<Workflow>'));
    expect(prompt.indexOf('<Workflow>')).toBeLessThan(prompt.indexOf('<Communication>'));
  });

  test('Oceanus 不泄漏 Sisyphus 六阶段详细契约', () => {
    const prompt = buildOceanusPrompt();
    expect(prompt).not.toContain('## Sisyphus 六阶段总契约');
    expect(prompt).toContain('CBM 生命周期：');
  });

  test('Sisyphus 直接完成 Intake，代码/混合任务只尝试一次并 fail-open', () => {
    const prompt = `${createSisyphusAgent().system!}\n${OCEANUS_INTAKE_SKILL.content}`;
    expect(prompt).toMatch(/Intake/);
    expect(prompt).toContain('cbm_index');
    expect(prompt).toMatch(/failure[\s\S]*超时|失败[\s\S]*超时/i);
    expect(prompt).toMatch(/fail-open/i);
    expect(prompt).toMatch(/code\/mixed|代码\/混合/);
  });

  test('澄清、批准由主 Agent，专业能力条件委派，Finish 不委派', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toMatch(/主 Agent.*澄清|owns clarification|user clarification/i);
    expect(prompt).toMatch(/approval|批准/);
    expect(prompt).toMatch(/delegate when|委派|按需/);
    expect(prompt).toMatch(/finish/i);
  });

  test('Plan 自查影响面，Oracle advisory 可选且不构成门禁', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toContain('impact_estimate');
    expect(prompt).toContain('consult/analysis 仍仅在需要时调用并只返回 advisory');
    expect(prompt).toContain('不授予批准');
  });

  test('Review 由 Oracle 正式审查且 Sisyphus 保留编排边界', () => {
    const review = OCEANUS_REVIEW_SKILL.content;
    expect(review).toMatch(/正式审查由 Oracle 只读执行.*不修改代码.*不运行 task/i);
    expect(review).toContain('每次 Review 都必须使用 `review` 场景');
    expect(review).toContain('@oracle');
    expect(review).toContain('准备 Brief');
    expect(review).toMatch(/不确定性.*未达成/);
    expect(review).toContain('完整 Oracle Brief');
  });

  test('Finish 只接受阶段输入且声明禁止动作', () => {
    const prompt = `${createSisyphusAgent().system!}\n${OCEANUS_REVIEW_SKILL.content}`;
    expect(prompt).toMatch(/Finish/i);
    expect(prompt).toMatch(/input|输入/i);
    expect(prompt).toMatch(/禁止|不得|must not|do not/i);
  });

  test('仅引用已注册 CBM 工具并包含初始化规则', () => {
    const prompts = [buildOceanusPrompt(), createSisyphusAgent().system!, OCEANUS_DISCUSS_SKILL.content, OCEANUS_REVIEW_SKILL.content];
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

  test('完整 CBM 生命周期下沉到 Skill，主 prompt 只保留摘要', () => {
    expect(buildOceanusPrompt()).not.toContain(CBM_LIFECYCLE.full);
    const sys = createSisyphusAgent().system!;
    expect(sys).not.toContain(CBM_LIFECYCLE.full);
    expect(sys).toContain('CBM 生命周期');
  });

  test('agent 路由描述常驻于 Oceanus/Sisyphus prompt，不依赖调度 Skill', () => {
    const oceanus = buildOceanusPrompt();
    const sys = createSisyphusAgent().system!;
    for (const prompt of [oceanus, sys]) {
      for (const name of ['@explorer', '@librarian', '@oracle', '@designer', '@fixer', '@observer']) {
        expect(prompt).toContain(name);
      }
      expect(prompt).toContain('大范围侦察');
      expect(prompt).toContain('不委派');
      expect(prompt).toContain('完全不相交且机械同构');
      expect(prompt).toContain('Wave');
      expect(prompt).not.toContain('oceanus-orchestration');
    }
  });

  test('主 agent prompt 包含可执行的委派收益判断与调度生命周期', () => {
    const prompts = [buildOceanusPrompt(), createSisyphusAgent().system!];
    for (const prompt of prompts) {
      expect(prompt).toContain('强制直做');
      expect(prompt).toContain('委派收益信号');
      expect(prompt).toContain('收益/成本检查');
      expect(prompt).toContain('“任务复杂”“可能更快”“存在可用 agent”不是拒绝理由');
      expect(prompt).toContain('调度生命周期');
      expect(prompt).toContain('声明 Files/依赖/验证');
      expect(prompt).toContain('主 Agent 整合 → 主 Agent 最终验证');
      expect(prompt).toContain('默认必须委派');
      expect(prompt).toContain('若决定不委派，必须');
      expect(prompt).toContain('触发器到调用的直接映射');
      expect(prompt).toContain('正向调用示例');
      expect(prompt).toContain('委派 prompt 格式硬门');
      expect(prompt).toContain('禁止把“目标：… 背景：… 范围：… 非目标：…”等多个字段压在同一行');
      expect(prompt).toContain('prompt 字符串必须实际包含换行');
    }
  });

  test('Sisyphus 不再把调度协议归因于 Skill', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toContain('六阶段总契约与 subagent 调度规则以本 Agent 常驻提示词为准');
    expect(prompt).not.toContain('Skill 承载阶段专属流程、调度协议与门禁细节');
  });

  test('CBM 主线句单一来源：oceanus 用注册表 brief，首次初始化与 Review 刷新边界明确', () => {
    expect(buildOceanusPrompt()).toContain(CBM_LIFECYCLE.brief);
    expect(buildOceanusPrompt()).toContain('首次初始化');
    const sys = createSisyphusAgent().system!;
    expect(sys).toContain('首次初始化');
    expect(sys).toContain('Review');
  });

  test('sisyphus system 含 Plan 自查与 Oracle Review 正式职责', () => {
    const sys = createSisyphusAgent().system!;
    expect(sys).toContain('impact_estimate');
    expect(sys).toContain('Oracle 在 Review 阶段执行正式只读审查');
    expect(sys).not.toContain('plan-gate 的预估');
  });
});
