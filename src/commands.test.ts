import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildAgentUpdates,
  buildPresetSummary,
  deletePreset,
  describeOverride,
  removeAgentFromPreset,
  setAgentOverride,
  switchPresetOnDisk,
  writePreset,
  type Preset,
} from './config/presets';

/**
 * preset 落盘操作测试（omo-slim switchPresetOnDisk 语义）：
 * 切换/增删只写用户级配置文件，不触碰 agent registry；
 * 新 preset 由下一次 loadPluginConfig 读盘时生效。
 */

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'oceanus-presets-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeUserConfig(configDir: string, source: string): Promise<string> {
  const configPath = join(configDir, 'opencode-oceanus.jsonc');
  await writeFile(configPath, source);
  return configPath;
}

describe('switchPresetOnDisk（omo-slim 落盘语义）', () => {
  test('切换到已存在 preset：持久化名称并返回变更摘要', async () => {
    const configDir = await temporaryDirectory();
    const configPath = await writeUserConfig(
      configDir,
      '{ "preset": "fast", "presets": { "safe": { "explorer": { "model": "safe/model" } }, "fast": {} } }\n',
    );

    const result = switchPresetOnDisk(
      { safe: { explorer: { model: 'safe/model' } }, fast: {} },
      'safe',
      { configDir },
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('explorer → safe/model');
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      preset: 'safe',
      presets: { safe: { explorer: { model: 'safe/model' } }, fast: {} },
    });
  });

  test('未知 preset：失败并给出可用列表，不写配置', async () => {
    const configDir = await temporaryDirectory();
    const original = '{ "preset": "fast", "presets": { "fast": {} } }\n';
    const configPath = await writeUserConfig(configDir, original);

    const result = switchPresetOnDisk({ fast: {} }, 'missing', { configDir });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('fast');
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  test('空 preset（无 agent 覆盖）被拒绝', () => {
    const result = switchPresetOnDisk({ empty: {} }, 'empty');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('为空');
  });

  test('写入失败向上抛出（不静默吞掉）', async () => {
    const configDir = await temporaryDirectory();
    const unwritableConfigPath = join(configDir, '配置目录');
    await mkdir(unwritableConfigPath, { recursive: true });

    expect(() =>
      switchPresetOnDisk({ safe: { oceanus: { model: 'm' } } }, 'safe', {
        configPath: unwritableConfigPath,
      }),
    ).toThrow();
  });
});

describe('writePreset / deletePreset', () => {
  test('writePreset 创建 preset 并保留其它字段', async () => {
    const configDir = await temporaryDirectory();
    const configPath = await writeUserConfig(
      configDir,
      '{ "preset": "fast", "presets": { "fast": {} }, "disabled_agents": [] }\n',
    );

    const ok = writePreset('cheap', { fixer: { model: 'cheap/model' } }, { configDir });

    expect(ok).toBe(true);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      preset: 'fast',
      presets: { fast: {}, cheap: { fixer: { model: 'cheap/model' } } },
      disabled_agents: [],
    });
  });

  test('deletePreset 删除指定 preset；删除激活项时同时清除顶层 preset', async () => {
    const configDir = await temporaryDirectory();
    const configPath = await writeUserConfig(
      configDir,
      '{ "preset": "fast", "presets": { "fast": {}, "safe": {} } }\n',
    );

    expect(deletePreset('fast', { configDir })).toBe(true);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ presets: { safe: {} } });

    expect(deletePreset('missing', { configDir })).toBe(false);
  });
});

describe('内存 preset 编辑辅助（不可变）', () => {
  test('setAgentOverride / removeAgentFromPreset 返回新对象', () => {
    const preset: Preset = { explorer: { model: 'a/b' } };
    const added = setAgentOverride(preset, 'fixer', { temperature: 0.2 });
    expect(added).toEqual({ explorer: { model: 'a/b' }, fixer: { temperature: 0.2 } });
    expect(preset).toEqual({ explorer: { model: 'a/b' } });

    const removed = removeAgentFromPreset(added, 'explorer');
    expect(removed).toEqual({ fixer: { temperature: 0.2 } });
    expect(removeAgentFromPreset(removed, 'missing')).toBe(removed);
  });

  test('buildAgentUpdates 解析 legacy 别名并剔除空覆盖', () => {
    const updates = buildAgentUpdates({
      explore: { model: 'x/y' },
      empty: {},
      oceanus: { variant: 'high' },
    });
    expect(Object.keys(updates).sort()).toEqual(['explorer', 'oceanus']);
  });

  test('describeOverride / buildPresetSummary 输出可读摘要', () => {
    expect(describeOverride({ model: 'p/m', variant: 'high', temperature: 0.3 })).toBe(
      'p/m, variant=high, temp=0.3',
    );
    expect(describeOverride({})).toBe('(unset)');
    const summary = buildPresetSummary({ explorer: { model: 'p/m' } });
    expect(summary).toEqual(['explorer → p/m']);
  });
});
