import { describe, expect, test } from 'bun:test';
import {
  mergePluginConfigs,
  resolvePresetAgents,
} from './config/loader';
import { PluginConfigSchema } from './config/schema';
import { getAutoUpdateConfig } from './config/utils';

describe('agent preset 配置 schema', () => {
  test('支持顶层 preset 和 presets', () => {
    const result = PluginConfigSchema.safeParse({
      preset: 'fast',
      presets: {
        fast: {
          explorer: { model: 'openai/gpt-5', temperature: 0.2 },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test('preset 作为基础，显式 agents 覆盖其字段', () => {
    const agents = resolvePresetAgents({
      preset: 'fast',
      presets: {
        fast: {
          explorer: { model: 'preset/model', options: { effort: 'low' } },
        },
      },
      agents: {
        explorer: { model: 'explicit/model' },
      },
    });

    expect(agents).toEqual({
      explorer: {
        model: 'explicit/model',
        options: { effort: 'low' },
      },
    });
  });

  test('项目配置覆盖用户配置，并合并 preset 内容', () => {
    const merged = mergePluginConfigs(
      {
        preset: 'default',
        presets: { default: { explorer: { model: 'user/model' } } },
        agents: { fixer: { temperature: 0.2 } },
      },
      {
        presets: { default: { explorer: { temperature: 0.8 } } },
        agents: { fixer: { model: 'project/model' } },
      },
    );

    expect(resolvePresetAgents(merged)).toEqual({
      explorer: { model: 'user/model', temperature: 0.8 },
      fixer: { temperature: 0.2, model: 'project/model' },
    });
  });

  test('未知 preset 回退到显式 agents', () => {
    const config = {
      preset: 'missing',
      presets: { fast: { explorer: { model: 'preset/model' } } },
      agents: { fixer: { model: 'explicit/model' } },
    };

    expect(resolvePresetAgents(config)).toEqual(config.agents);
  });
});

describe('autoUpdate 配置', () => {
  test('默认启用，检查间隔为 3 小时，清理历史版本默认开启', () => {
    expect(getAutoUpdateConfig()).toEqual({
      enabled: true,
      checkIntervalMs: 10_800_000,
      cleanup: true,
    });
  });

  test('支持覆盖 enabled、checkIntervalMs 与 cleanup，且不允许 allowMajor', () => {
    expect(
      PluginConfigSchema.safeParse({
        autoUpdate: { enabled: false, checkIntervalMs: 60_000 },
      }).success,
    ).toBe(true);
    expect(
      PluginConfigSchema.safeParse({
        autoUpdate: { cleanup: false },
      }).success,
    ).toBe(true);
    expect(
      PluginConfigSchema.safeParse({
        autoUpdate: { allowMajor: true },
      }).success,
    ).toBe(false);
    expect(getAutoUpdateConfig({ autoUpdate: { checkIntervalMs: 60_000 } })).toEqual({
      enabled: true,
      checkIntervalMs: 60_000,
      cleanup: true,
    });
    expect(getAutoUpdateConfig({ autoUpdate: { cleanup: false } }).cleanup).toBe(false);
  });
});

describe('tools/hooks 结构化配置键面（P1-2 回归）', () => {
  test('clipboard_image / oceanus_config_generate 可被 tools 结构化配置', () => {
    expect(
      PluginConfigSchema.safeParse({
        tools: { clipboard_image: { enabled: false }, oceanus_config_generate: { enabled: true } },
      }).success,
    ).toBe(true);
  });

  test('image_materializer / image_error_hint 可被 hooks 结构化配置', () => {
    expect(
      PluginConfigSchema.safeParse({
        hooks: { image_materializer: { enabled: false }, image_error_hint: { enabled: true } },
      }).success,
    ).toBe(true);
  });

  test('结构化关闭 image hooks 不再使整份配置失效', () => {
    const result = PluginConfigSchema.safeParse({
      agents: {},
      hooks: { image_materializer: { enabled: false }, image_error_hint: { enabled: false } },
      tools: { clipboard_image: { enabled: false }, oceanus_config_generate: { enabled: false } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.image_materializer?.enabled).toBe(false);
      expect(result.data.tools?.clipboard_image?.enabled).toBe(false);
    }
  });

  test('未知工具/Hook 名仍被 strict 拒绝', () => {
    expect(PluginConfigSchema.safeParse({ tools: { bogus_tool: { enabled: false } } }).success).toBe(false);
    expect(PluginConfigSchema.safeParse({ hooks: { bogus_hook: { enabled: false } } }).success).toBe(false);
  });
});
