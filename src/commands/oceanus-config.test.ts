import { describe, expect, test } from 'bun:test';
import { buildOceanusConfigInstruction, createOceanusConfigCommand } from './oceanus-config';

/**
 * `/oceanus-config` 命令契约测试：指令正文包含完整厂商清单与
 * question / oceanus_config_generate 工作流；prompt 注入透传 delivery；
 * prompt 失败时降级 synthetic 回执。
 */
describe('oceanus-config command', () => {
  test('指令正文包含全部内置厂商与核心流程', () => {
    const text = buildOceanusConfigInstruction('');
    for (const vendor of [
      'default',
      'zai',
      'openai',
      'deepseek',
      'ollama-cloud',
      'aliyun',
      'opencode-go',
      'anthropic',
      'gemini',
    ]) {
      expect(text).toContain(vendor);
    }
    expect(text).toContain('question');
    expect(text).toContain('oceanus_config_generate');
    expect(text).toContain('检测现有配置');
    expect(text).toContain('初始化默认集合');
    for (const v of ['zai', 'openai', 'deepseek', 'ollama-cloud', 'opencode-go']) {
      expect(text.match(/直接按默认初始化集合生成：[^\n]*/)?.[0] ?? '').toContain(v);
    }
    // 默认集合之外：default（preset 名）不在默认初始化集合行中。
    expect(text.match(/直接按默认初始化集合生成：[^\n]*/)?.[0] ?? '').not.toContain('default');
    expect(text).toContain('激活默认推荐 zai');
    expect(text).toContain('overwrite=true');
    expect(text).toContain('activate=true');
    expect(text).toContain('不手工编辑用户级配置');
  });

  test('补充要求会附加到指令末尾', () => {
    const text = buildOceanusConfigInstruction('只要轻量模型');
    expect(text).toContain('补充要求');
    expect(text).toContain('只要轻量模型');
  });

  test('execute 注入指令并透传 delivery', async () => {
    const prompts: Array<{ sessionID: string; text: string; delivery: string }> = [];
    const command = createOceanusConfigCommand({
      prompt: async (sessionID, text, delivery) => {
        prompts.push({ sessionID, text, delivery });
      },
      reply: async () => {},
    });
    await command.execute({
      sessionID: 'ses_test',
      prompt: { text: '  ' },
      delivery: 'steer',
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.sessionID).toBe('ses_test');
    expect(prompts[0]?.delivery).toBe('steer');
    expect(prompts[0]?.text).toContain('oceanus_config_generate');
  });

  test('prompt 失败时降级 synthetic 回执', async () => {
    const replies: string[] = [];
    const command = createOceanusConfigCommand({
      prompt: async () => {
        throw new Error('宿主 session.prompt 能力不可用');
      },
      reply: async (_sessionID, text) => {
        replies.push(text);
      },
    });
    await command.execute({
      sessionID: 'ses_test',
      prompt: { text: '' },
      delivery: 'queue',
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('宿主 session.prompt 能力不可用');
  });
});
