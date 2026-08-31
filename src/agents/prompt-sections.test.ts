import { describe, expect, test } from 'bun:test';
import {
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
});
