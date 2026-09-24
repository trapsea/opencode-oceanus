import { describe, expect, test } from 'bun:test';
import { buildGitCommitInstruction, createGitCommitCommand } from './git-commit';

/**
 * `/git-commit` 命令契约测试。
 *
 * 覆盖：指令正文包含完整工作流且剥离 plan_state 依赖；prompt 注入
 * 透传 delivery；prompt 失败时降级 synthetic 回执。
 */
describe('git-commit command', () => {
  test('指令正文包含核心流程、[AI] 前缀与 question 决策环节，且不包含 plan_state 归因体系', () => {
    const text = buildGitCommitInstruction('');
    expect(text).toContain('一次性扫描');
    expect(text).toContain('禁止逐文件循环');
    expect(text).toContain('--unified=0');
    expect(text).toContain('默认把所有变更合并为一次提交');
    expect(text).toContain('[需求]');
    expect(text).toContain('[缺陷]');
    expect(text).toContain('[通用]');
    expect(text).toContain('[紧急]');
    expect(text).toContain('`[AI][标签][模块名] 简短描述`');
    expect(text).toContain('所有 commit message 前缀必须带 `[AI]`');
    expect(text).toContain('question');
    expect(text).toContain('确认提交');
    expect(text).toContain('继续拆分');
    expect(text).toContain('不提交');
    // 剥离脚本归因：publish / manifest 不得出现。
    expect(text).not.toContain('plan_state');
    expect(text).not.toContain('publish');
    expect(text).not.toContain('AI-Manifest');
  });

  test('补充要求会附加到指令末尾', () => {
    const text = buildGitCommitInstruction('只分析已暂存变更');
    expect(text).toContain('补充要求');
    expect(text).toContain('只分析已暂存变更');
  });

  test('execute 注入指令并透传 delivery，无补充要求时不附加小节', async () => {
    const prompts: Array<{ sessionID: string; text: string; delivery: string }> = [];
    const command = createGitCommitCommand({
      prompt: async (sessionID, text, delivery) => {
        prompts.push({ sessionID, text, delivery });
      },
      reply: async () => {
        throw new Error('不应触发降级回执');
      },
    });
    await command.execute({ sessionID: 's1', prompt: { text: '  ' }, delivery: 'queue' });
    expect(prompts).toHaveLength(1);
    expect(prompts[0].sessionID).toBe('s1');
    expect(prompts[0].delivery).toBe('queue');
    expect(prompts[0].text).not.toContain('补充要求');
  });

  test('prompt 失败时降级 synthetic 回执，不静默失败', async () => {
    const replies: string[] = [];
    const command = createGitCommitCommand({
      prompt: async () => {
        throw new Error('宿主 session.prompt 能力不可用');
      },
      reply: async (_s, text) => {
        replies.push(text);
      },
    });
    await command.execute({ sessionID: 's1', prompt: { text: '' }, delivery: 'steer' });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('宿主 session.prompt 能力不可用');
  });
});
