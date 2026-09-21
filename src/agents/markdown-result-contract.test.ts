import { describe, expect, test } from 'bun:test';
import { createDesignerAgent } from './designer';
import { createExplorerAgent } from './explorer';
import { createFixerAgent } from './fixer';
import { createLibrarianAgent } from './librarian';
import { createObserverAgent } from './observer';
import { createOracleAgent } from './oracle';

const agents = [
  createExplorerAgent,
  createLibrarianAgent,
  createFixerAgent,
  createDesignerAgent,
  createObserverAgent,
  createOracleAgent,
];

describe('内置 subagent Markdown 返回契约', () => {
  test('所有默认 prompt 使用同一 Markdown 外壳', () => {
    for (const createAgent of agents) {
      const system = createAgent().system!;
      for (const section of [
        '# 结果',
        '## 状态',
        '## 摘要',
        '## 详情',
        '## 证据',
        '## 验证',
        '## 未确认项',
        '## 负向发现',
        '## 剩余风险',
      ]) {
        expect(system, `${createAgent.name} 包含 ${section}`).toContain(section);
      }
    }
  });

  test('固定 XML 返回格式不再出现在默认 prompt', () => {
    const explorer = createExplorerAgent().system!;
    const fixer = createFixerAgent().system!;
    const oracle = createOracleAgent().system!;

    expect(explorer).not.toContain('<results>');
    expect(explorer).not.toContain('<findings>');
    expect(fixer).not.toContain('<summary>');
    expect(fixer).not.toContain('<changes>');
    expect(fixer).not.toContain('<verification>');
    expect(oracle).not.toContain('<oracle_scene');
  });

  test('所有自定义 prompt 都不能移除 Markdown 返回契约', () => {
    for (const createAgent of agents) {
      const system = createAgent(undefined, '自定义提示词').system!;
      expect(system, `${createAgent.name} 保留自定义内容`).toContain('自定义提示词');
      expect(system, `${createAgent.name} 保留结果标题`).toContain('# 结果');
      expect(system, `${createAgent.name} 保留剩余风险章节`).toContain('## 剩余风险');
    }
  });
});
