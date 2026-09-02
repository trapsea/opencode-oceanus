import { describe, expect, test } from 'bun:test';
import {
  buildOceanusPrompt,
  buildOceanusPromptSections,
  renderPrompt,
} from './oceanus';
import { createSisyphusAgent } from './sisyphus';

describe('提示词 sections 组装', () => {
  test('按固定顺序渲染四个 sections', () => {
    const prompt = renderPrompt(buildOceanusPromptSections());
    expect(prompt.indexOf('<Role>')).toBeLessThan(prompt.indexOf('<Agents>'));
    expect(prompt.indexOf('<Agents>')).toBeLessThan(prompt.indexOf('<Workflow>'));
    expect(prompt.indexOf('<Workflow>')).toBeLessThan(prompt.indexOf('<Communication>'));
  });

  test('Sisyphus 覆盖 role/workflow 并保留完整阶段内容', () => {
    const prompt = createSisyphusAgent().system!;
    expect(prompt).toContain('You are Sisyphus');
    expect(prompt).toContain('## Sisyphus Workflow');
    expect(prompt).toContain('CBM 阶段边界');
    expect(prompt).toContain('<Communication>');
  });

  test('缺失 section 显式失败', () => {
    expect(() => renderPrompt({ role: '', agents: 'a', workflow: 'w', communication: 'c' })).toThrow();
  });

  test('Workflow 使用连续顶级编号并包含最终完成门禁', () => {
    const workflow = buildOceanusPromptSections().workflow;
    expect(workflow).toContain('## 5. Verify');
    expect(workflow).not.toContain('## 6. Verify');
    for (const rule of ['task_status', 'task_result', 'final diff', 'acceptance criterion', 'stale', 'failed', 'blocked', 'uncertain', 'Completion Audit']) {
      expect(workflow).toContain(rule);
    }
  });

  test('Sisyphus 变体不含 Oceanus 自指路由与视角残留', () => {
    const sys = createSisyphusAgent().system!;
    expect(sys).not.toContain('suggest switching to');
    expect(sys).not.toContain('route the work to `@sisyphus`');
    expect(sys).not.toContain('For Sisyphus work');
    expect(sys).not.toContain('Oceanus owns clarification');
    expect(sys).toContain('Sisyphus owns clarification');
    expect(sys).toContain('You are @sisyphus');
  });

  test('Oceanus 的 sisyphus 路由句收敛为一处且保留 Intake 语义', () => {
    const prompt = buildOceanusPrompt();
    expect(prompt.split('suggest switching to').length - 1).toBe(1);
    expect(prompt).toContain('Oceanus owns clarification');
    expect(prompt).toContain('do not claim that Oceanus itself completed Intake');
  });
});
