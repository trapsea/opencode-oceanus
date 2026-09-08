import { describe, expect, test } from 'bun:test';
import { buildAiRatioInstruction, createAiRatioCommand, parseAiRatioArgument } from './ai-ratio';

/**
 * `/ai-ratio` 命令契约测试。
 *
 * 覆盖：指令正文包含完整统计工作流且不引用 python 脚本；参数解析
 * 支持 --since/--branch；prompt 注入透传 delivery；失败降级回执。
 */
describe('ai-ratio command', () => {
  test('指令正文包含批量询问、采集、判定、统计与报告流程，且不耦合 python 脚本', () => {
    const text = buildAiRatioInstruction('');
    expect(text).toContain('question 工具批量询问');
    expect(text).toContain('最近 1 个月');
    expect(text).toContain('最近 1 年');
    expect(text).toContain('自定义输入起始日期');
    expect(text).toContain('当前分支');
    expect(text).toContain('一次调用、两个 questions');
    expect(text).toContain('--no-merges');
    expect(text).toContain('ai-gen@company.com');
    expect(text).toContain('[AI]');
    expect(text).toContain('[@开发者]');
    expect(text).toContain('.ai-attribution/');
    expect(text).toContain('人工修改率');
    expect(text).toContain('Markdown 报告');
    expect(text).toContain('禁止任何工作区或仓库写操作');
    // 解耦约束：不出现脚本文件名或 python 调用。
    expect(text).not.toContain('ai_code_ratio');
    expect(text).not.toContain('python');
  });

  test('parseAiRatioArgument 解析 --since/--branch，剩余内容进补充要求', () => {
    const parsed = parseAiRatioArgument('--since 2026-01-01 --branch feat/x 只看后端模块');
    expect(parsed.since).toBe('2026-01-01');
    expect(parsed.branch).toBe('feat/x');
    expect(parsed.extra).toBe('只看后端模块');
  });

  test('指令正文回显已指定范围（跳过对应询问）并附加补充要求', () => {
    const text = buildAiRatioInstruction('--since 2026-01-01 只看后端模块');
    expect(text).toContain('起始日期：2026-01-01');
    expect(text).toContain('跳过时间范围询问');
    expect(text).toContain('补充要求');
    expect(text).toContain('只看后端模块');
  });

  test('execute 注入指令并透传 delivery，无补充要求时不附加小节', async () => {
    const prompts: Array<{ sessionID: string; text: string; delivery: string }> = [];
    const command = createAiRatioCommand({
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
    const command = createAiRatioCommand({
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
