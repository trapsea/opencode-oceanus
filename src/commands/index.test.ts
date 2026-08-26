import { describe, expect, test } from 'bun:test';
import { createCommands } from './index';
import type {
  CbmCommandHandlers,
  CommandDefinition,
  CommandInvocation,
  PresetCommandHandlers,
} from './index';

/**
 * Commands 目录化与注入契约测试（commands-directory-injection · Wave 1 · 红灯）。
 *
 * 本文件先行描述未来目录化 API，预期在 Wave 2 生产实现落地前**无法导入**而失败
 * （红灯）：当前 `src/commands` 是单文件 `commands.ts`，尚无 `src/commands/index.ts`，
 * 因此 `./index` 不可解析。Wave 2 目录化实现补齐后本文件应转绿。
 *
 * 契约（来自已批准 spec/plan）：
 * - `./index` 必须导出 `createCommands(deps)` 聚合工厂，以及 command 相关类型
 *   （`CommandDefinition` / `CommandInvocation` / `PresetCommandHandlers`）。
 * - `createCommands` 以最小注入依赖为参数，返回 `CommandDefinition[]`；每个 command
 *   的依赖按命令名命名空间隔离（本次仅 `preset`）。
 * - 返回数组必须包含名为 `preset` 的定义，形状为 `{ name, description, execute }`。
 * - `preset.execute` 必须通过注入的 handlers 触发 reload / reply，而非直接持有插件 ctx：
 *   切换成功 → `reloadAgents()` + `reply(...)`；查询路径 → 仅 `reply(...)`；
 *   未知/失败 → 仅 `reply(...)`，不 reload、不抛。
 *
 * 注意：本文件不依赖旧的 `./commands`（即 `src/commands.ts`）导出，仅面向未来目录 API。
 */

/** 由最小 preset handlers 构造 spy 化依赖，用于断言 reload / reply 触发情况。 */
function makePresetDeps(runPreset: PresetCommandHandlers['runPreset']) {
  const reload = { calls: 0 };
  const replies: string[] = [];
  const deps: PresetCommandHandlers = {
    runPreset,
    reloadAgents: async () => {
      reload.calls += 1;
    },
    reply: async (text) => {
      replies.push(text);
    },
  };
  return { deps, reload, replies };
}

function presetDefinition(deps: PresetCommandHandlers): CommandDefinition {
  const preset = createCommands({ preset: deps, cbm: cbmStub() }).find(
    (command) => command.name === 'preset',
  );
  expect(preset).toBeDefined();
  return preset as CommandDefinition;
}

/** 最小 cbm handlers 桩：仅供聚合/类型契约测试，不参与 preset 行为断言。 */
function cbmStub(): CbmCommandHandlers {
  return {
    reply: async () => {},
  };
}

describe('commands 聚合与 v2 注册契约（commands-directory-injection）', () => {
  test('createCommands 注入最小 preset handlers 后返回包含 preset 的数组', () => {
    const { deps } = makePresetDeps(async () => ({ current: 'none', presets: [] }));

    const commands = createCommands({ preset: deps, cbm: cbmStub() });

    expect(Array.isArray(commands)).toBe(true);
    expect(commands.some((command) => command.name === 'preset')).toBe(true);
  });

  test('createCommands 同时注册 cbm 命令族（CBM-10）', () => {
    const { deps } = makePresetDeps(async () => ({ current: 'none', presets: [] }));

    const commands = createCommands({ preset: deps, cbm: cbmStub() });

    const cbm = commands.find((command) => command.name === 'cbm');
    expect(cbm).toBeDefined();
    expect(typeof cbm!.description).toBe('string');
    expect(cbm!.description!.length).toBeGreaterThan(0);
    expect(typeof cbm!.execute).toBe('function');
  });

  test('preset 定义具有 name/description/execute 形状', () => {
    const { deps } = makePresetDeps(async () => ({ current: 'none', presets: [] }));

    const preset = presetDefinition(deps);

    expect(preset.name).toBe('preset');
    expect(typeof preset.description).toBe('string');
    expect(preset.description!.length).toBeGreaterThan(0);
    expect(typeof preset.execute).toBe('function');
  });

  test('preset.execute 切换成功时通过注入依赖触发 reload 与 reply', async () => {
    const { deps, reload, replies } = makePresetDeps(async () => ({ preset: 'fast' }));
    const preset = presetDefinition(deps);
    const invocation: CommandInvocation = {
      sessionID: 'session-contract',
      prompt: { text: 'fast' },
      delivery: 'steer',
    };

    await preset.execute(invocation);

    expect(reload.calls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/fast/);
  });

  test('preset.execute 查询路径仅 reply，不触发 reload', async () => {
    const { deps, reload, replies } = makePresetDeps(async () => ({
      current: 'fast',
      presets: ['fast'],
    }));
    const preset = presetDefinition(deps);
    const invocation: CommandInvocation = {
      sessionID: 'session-contract',
      prompt: { text: '' },
      delivery: 'queue',
    };

    await preset.execute(invocation);

    expect(reload.calls).toBe(0);
    expect(replies).toHaveLength(1);
  });

  test('preset.execute 未知/失败路径仅 reply，不 reload、不抛异常', async () => {
    const { deps, reload, replies } = makePresetDeps(async () => {
      throw new Error('Unknown preset（未知 preset）');
    });
    const preset = presetDefinition(deps);
    const invocation: CommandInvocation = {
      sessionID: 'session-contract',
      prompt: { text: 'missing' },
      delivery: 'steer',
    };

    await expect(preset.execute(invocation)).resolves.toBeUndefined();

    expect(reload.calls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/unknown|未知|failed/i);
  });
});
