import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { createPresetCommand, runPresetCommand } from './commands';

/**
 * 本地最小 command 类型契约：仅镜像 OpenCode v2 `CommandDefinition` / `CommandInvocation`
 * 的运行时形状，避免在测试里依赖 plugin 包的内部路径导出。
 * 生产代码应返回真正的 `CommandDefinition`（来自 `@opencode-ai/plugin`），但其运行时
 * 结构必须与此处一致方可被 opencode 运行时接受。
 */
interface PresetCommandDefinition {
  name: string;
  description?: string;
  execute: (invocation: {
    sessionID: string;
    prompt: { text: string };
    delivery: 'steer' | 'queue';
  }) => Promise<void>;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'oceanus-commands-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('原生 preset command', () => {
  test('无参数列出当前 preset 和可用 preset', async () => {
    const configDir = await temporaryDirectory();
    await writeFile(
      join(configDir, 'opencode-oceanus.jsonc'),
      '{ "preset": "fast", "presets": { "safe": {}, "fast": {} } }\n',
    );

    await expect(runPresetCommand([], { configDir })).resolves.toEqual({
      current: 'fast',
      presets: ['fast', 'safe'],
    });
  });

  test('带参数时切换到已存在的 preset，并持久化选择', async () => {
    const configDir = await temporaryDirectory();
    const configPath = join(configDir, 'opencode-oceanus.jsonc');
    await writeFile(configPath, '{ "preset": "fast", "presets": { "safe": {} } }\n');

    await expect(runPresetCommand(['safe'], { configDir })).resolves.toMatchObject({
      preset: 'safe',
    });
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      preset: 'safe',
      presets: { safe: {} },
    });
  });

  test('未知 preset 被拒绝且不写入配置', async () => {
    const configDir = await temporaryDirectory();
    const configPath = join(configDir, 'opencode-oceanus.jsonc');
    const original = '{ "preset": "fast", "presets": { "fast": {} } }\n';
    await writeFile(configPath, original);

    await expect(runPresetCommand(['missing'], { configDir })).rejects.toThrow(/unknown|未知/i);
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  test('写入失败时将底层异常传递给调用方', async () => {
    const configDir = await temporaryDirectory();
    const unwritableConfigPath = join(configDir, '配置目录');
    // 将配置路径设为目录，模拟 rename/write 的失败；命令不得吞掉异常。
    await Bun.write(unwritableConfigPath, 'placeholder');
    await rm(unwritableConfigPath);
    await mkdir(unwritableConfigPath);

    await expect(
      runPresetCommand(['safe'], { configPath: unwritableConfigPath }),
    ).rejects.toThrow();
  });
});

/**
 * AUTO-RELOAD-001：preset command 成功切换时应触发 agent reload；
 * 查询、未知 preset、写入失败时不得触发。
 *
 * 测试接口需求（TDD 红→绿契约，待生产实现满足）：
 * - `commands.ts` 必须导出 `createPresetCommand(handlers)` 工厂：
 *   - `handlers.runPreset`：与现有 `runPresetCommand` 签名一致。
 *   - `handlers.reloadAgents：() => Promise<void>`：切换成功时调用一次。
 *     查询路径、未知 preset 路径、写入失败路径均不调用。
 *   - `handlers.reply：(text, invocation) => Promise<void>`：用于回写消息；
 *     不在 reload 行为的契约范围，但工厂需要它以避免与 ctx 耦合。
 * - 工厂返回的 `CommandDefinition` 必须：
 *   - `name === 'preset'`
 *   - `execute(invocation)`：从 `invocation.prompt.text` 解析参数；
 *     切换成功 → `reloadAgents()` + `reply(成功消息, invocation)`；
 *     查询路径 → 仅 `reply(...)`，不 reload；
 *     未知/失败 → 仅 `reply(失败消息, invocation)`，不 reload、不抛。
 *
 * 这些测试**预期**在 `createPresetCommand` 尚未实现时失败（红灯），
 * 由后续生产实现补齐后转绿。
 */
describe('preset command agent reload (AUTO-RELOAD-001)', () => {
  interface ReloadSpy {
    calls: number;
    fn: () => Promise<void>;
  }
  interface ReplySpy {
    messages: string[];
    fn: (text: string, invocation: { sessionID: string; prompt: { text: string }; delivery: 'steer' | 'queue' }) => Promise<void>;
  }
  interface Harness {
    command: PresetCommandDefinition;
    reload: ReloadSpy;
    reply: ReplySpy;
    invoke: (text: string) => Promise<void>;
  }

  function buildHarness(configDir: string): Harness {
    const reload: ReloadSpy = {
      calls: 0,
      fn: async () => {
        reload.calls += 1;
      },
    };
    const reply: ReplySpy = {
      messages: [],
      fn: async (text) => {
        reply.messages.push(text);
      },
    };
    const command: PresetCommandDefinition = createPresetCommand({
      runPreset: (args: readonly string[], options: Parameters<typeof runPresetCommand>[1] = {}) =>
        runPresetCommand(args, { ...options, configDir }),
      reloadAgents: () => reload.fn(),
      reply: (text: string, invocation: ReplySpy['fn'] extends (t: string, i: infer I) => unknown ? I : never) =>
        reply.fn(text, invocation),
    });
    const invoke = async (text: string): Promise<void> => {
      await command.execute({
        sessionID: 'session-test',
        prompt: { text },
        delivery: 'steer',
      });
    };
    return { command, reload, reply, invoke };
  }

  test('切换到已存在 preset 时触发一次 agent reload 并发出成功消息', async () => {
    const configDir = await temporaryDirectory();
    await writeFile(
      join(configDir, 'opencode-oceanus.jsonc'),
      '{ "preset": "fast", "presets": { "safe": {}, "fast": {} } }\n',
    );
    const harness = buildHarness(configDir);

    await harness.invoke('safe');

    expect(harness.reload.calls).toBe(1);
    expect(harness.reply.messages).toHaveLength(1);
    expect(harness.reply.messages[0]).toMatch(/safe/);
  });

  test('无参数（查询）路径不触发 agent reload，仅回写当前 preset 列表', async () => {
    const configDir = await temporaryDirectory();
    await writeFile(
      join(configDir, 'opencode-oceanus.jsonc'),
      '{ "preset": "fast", "presets": { "safe": {}, "fast": {} } }\n',
    );
    const harness = buildHarness(configDir);

    await harness.invoke('');

    expect(harness.reload.calls).toBe(0);
    expect(harness.reply.messages).toHaveLength(1);
    expect(harness.reply.messages[0]).toMatch(/fast/);
  });

  test('未知 preset 不触发 agent reload，并将错误消息回写', async () => {
    const configDir = await temporaryDirectory();
    await writeFile(
      join(configDir, 'opencode-oceanus.jsonc'),
      '{ "preset": "fast", "presets": { "fast": {} } }\n',
    );
    const harness = buildHarness(configDir);

    await harness.invoke('does-not-exist');

    expect(harness.reload.calls).toBe(0);
    expect(harness.reply.messages).toHaveLength(1);
    expect(harness.reply.messages[0]).toMatch(/unknown|未知|failed/i);
  });

  test('写入失败时不触发 agent reload，底层异常被回写而非抛出', async () => {
    const configDir = await temporaryDirectory();
    const unwritableConfigPath = join(configDir, '配置目录');
    await Bun.write(unwritableConfigPath, 'placeholder');
    await rm(unwritableConfigPath);
    await mkdir(unwritableConfigPath);

    const reload: ReloadSpy = { calls: 0, fn: async () => undefined };
    const reply: ReplySpy = {
      messages: [],
      fn: async (text) => {
        reply.messages.push(text);
      },
    };
    const command: PresetCommandDefinition = createPresetCommand({
      runPreset: (args: readonly string[], options: Parameters<typeof runPresetCommand>[1] = {}) =>
        runPresetCommand(args, { ...options, configPath: unwritableConfigPath }),
      reloadAgents: () => reload.fn(),
      reply: (text: string, invocation: ReplySpy['fn'] extends (t: string, i: infer I) => unknown ? I : never) =>
        reply.fn(text, invocation),
    });

    await command.execute({
      sessionID: 'session-test',
      prompt: { text: 'safe' },
      delivery: 'steer',
    });

    expect(reload.calls).toBe(0);
    expect(reply.messages).toHaveLength(1);
    expect(reply.messages[0]).toMatch(/failed|错误|异常/i);
  });
});
