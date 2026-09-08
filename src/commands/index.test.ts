import { describe, expect, test } from 'bun:test';
import { createCommands } from './index';
import type { CommandDefinition } from './index';

/**
 * Commands 聚合与 v2 注册契约测试。
 *
 * preset 已完全迁移到 TUI 侧（src/tui-preset.tsx，参考 oh-my-opencode-slim），
 * 不再注册 server command；cbm 命令已移除（能力由 MCP 工具供 agent 调度，
 * 不暴露用户命令）。此处覆盖 preset 命令族的聚合契约。
 */

describe('commands 聚合与 v2 注册契约', () => {
  const presetStub = () => ({
    listPresets: () => ({ current: undefined, presets: {} }),
    switchPreset: () => ({ ok: false, message: '', summary: [] }),
    switchSessionModel: async () => null,
    rebuildAgents: async () => {},
    reply: async () => {},
  });

  test('createCommands 注册 preset、git-commit 与 ai-ratio，不再注册 cbm 命令', () => {
    const commands = createCommands({
      preset: presetStub(),
      gitCommit: {
        prompt: async () => {},
        reply: async () => {},
      },
      aiRatio: {
        prompt: async () => {},
        reply: async () => {},
      },
    });
    const command = commands.find((c) => c.name === 'preset') as CommandDefinition | undefined;
    expect(command, 'command preset 已注册').toBeDefined();
    expect(typeof command!.description).toBe('string');
    expect(typeof command!.execute).toBe('function');
    expect(commands.some((c) => c.name === 'ai-ratio'), 'ai-ratio 命令已注册').toBe(true);
    expect(commands.some((c) => c.name === 'cbm'), 'cbm 命令不应注册').toBe(false);
  });

  test('preset.execute 无参数走查询 + synthetic 回执，不重建 registry', async () => {
    const replies: string[] = [];
    let rebuilt = 0;
    const commands = createCommands({
      preset: {
        ...presetStub(),
        listPresets: () => ({ current: 'zai', presets: { zai: {}, openai: {} } }),
        reply: async (_s, text) => { replies.push(text); },
        rebuildAgents: async () => { rebuilt += 1; },
      },
    });
    const preset = commands.find((c) => c.name === 'preset')!;
    await preset.execute({ sessionID: 's1', prompt: { text: '' }, delivery: 'steer' });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('zai');
    expect(rebuilt).toBe(0);
  });

  test('preset.execute 切换成功：落盘 + 会话模型 + registry 重建 + 回执', async () => {
    const replies: string[] = [];
    const calls: string[] = [];
    const commands = createCommands({
      preset: {
        ...presetStub(),
        listPresets: () => ({ current: 'a', presets: {} }),
        switchPreset: (name) => (name === 'ok' ? { ok: true, message: 'saved', summary: ['oceanus → m1'] } : { ok: false, message: 'missing', summary: [] }),
        switchSessionModel: async () => '当前会话（oceanus）已立即切换到 p/m；',
        rebuildAgents: async () => { calls.push('rebuild'); },
        reply: async (_s, text) => { replies.push(text); },
      },
      gitCommit: { prompt: async () => {}, reply: async () => {} },
      aiRatio: { prompt: async () => {}, reply: async () => {} },
    });
    const preset = commands.find((c) => c.name === 'preset')!;
    await preset.execute({ sessionID: 's1', prompt: { text: 'ok' }, delivery: 'steer' });
    expect(calls).toEqual(['rebuild']);
    expect(replies[0]).toContain('已立即切换');
    expect(replies[0]).toContain('oceanus → m1');

    // 未知 preset：失败回执，不重建。
    replies.length = 0;
    calls.length = 0;
    await preset.execute({ sessionID: 's1', prompt: { text: 'missing' }, delivery: 'steer' });
    expect(calls).toEqual([]);
    expect(replies[0]).toContain('missing');
  });
});
