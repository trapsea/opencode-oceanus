import { describe, expect, test } from 'bun:test';
import {
  mergePluginConfigs,
  resolvePresetAgents,
} from './config/loader';
import { PluginConfigSchema } from './config/schema';

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
