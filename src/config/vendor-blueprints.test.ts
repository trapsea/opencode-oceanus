import { describe, expect, test } from 'bun:test';
import {
  VENDOR_BLUEPRINTS,
  describeVendorBlueprint,
  getVendorBlueprint,
  listVendorBlueprints,
} from './vendor-blueprints';
import { generateVendorPreset } from '../tools/oceanus-config';
import type { Preset } from './presets';

/**
 * 厂商 blueprint 与 oceanus_config_generate 契约测试。
 *
 * 覆盖：blueprint 完整性（9 套、agent 全覆盖、model 带 provider 前缀）、
 * 与用户现有 jsonc 的关键映射一致性（default/zai/openai/deepseek）、
 * 生成工具的 conflict / overwrite / unknown-vendor / activate 分支。
 */
const ALL_AGENTS = [
  'oceanus',
  'sisyphus',
  'prometheus',
  'oracle',
  'librarian',
  'explorer',
  'designer',
  'fixer',
  'observer',
];

describe('vendor blueprints', () => {
  test('包含 9 套内置厂商', () => {
    expect(listVendorBlueprints().map((v) => v.name)).toEqual([
      'default',
      'zai',
      'openai',
      'deepseek',
      'ollama-cloud',
      'aliyun',
      'opencode-go',
      'anthropic',
      'gemini',
    ]);
  });

  test('每套 blueprint 覆盖全部 agent 且不含已删除的 metis/momus，model 带 provider 前缀', () => {
    for (const blueprint of VENDOR_BLUEPRINTS) {
      const agents = Object.keys(blueprint.preset).sort();
      expect(agents).toEqual([...ALL_AGENTS].sort());
      expect(agents).not.toContain('metis');
      expect(agents).not.toContain('momus');
      for (const [agent, override] of Object.entries(blueprint.preset)) {
        const model = override.model;
        expect(typeof model).toBe('string');
        expect(model as string).toContain('/');
        if (override.variant !== undefined) {
          expect(['low', 'medium', 'high', 'default']).toContain(override.variant);
        }
        expect(agent.length).toBeGreaterThan(0);
      }
      expect(typeof blueprint.displayName).toBe('string');
      expect(describeVendorBlueprint(blueprint)).toContain(blueprint.name);
    }
  });

  test('与用户现有 jsonc 逐字迁移一致，prometheus 与 oceanus 同档', () => {
    const jsoncExpectations: Record<string, Array<[string, string, string | undefined]>> = {
      default: [
        ['oceanus', 'ollama-cloud/minimax-m3', 'high'],
        ['prometheus', 'ollama-cloud/minimax-m3', 'high'],
        ['librarian', 'ollama-cloud/deepseek-v4-flash', 'default'],
        ['fixer', 'ollama-cloud/minimax-m3', 'low'],
      ],
      zai: [
        ['oceanus', 'zai-coding-plan/glm-5.3', undefined],
        ['prometheus', 'zai-coding-plan/glm-5.3', undefined],
        ['librarian', 'zai-coding-plan/glm-4.7', undefined],
        ['designer', 'zai-coding-plan/glm-5.3-flash', undefined],
        ['fixer', 'zai-coding-plan/glm-5.3', undefined],
      ],
      openai: [
        ['oceanus', 'openai/gpt-5.6-terra', undefined],
        ['prometheus', 'openai/gpt-5.6-terra', undefined],
        ['oracle', 'openai/gpt-5.6-terra', 'high'],
        ['librarian', 'openai/gpt-5.6-luna-fast', 'low'],
        ['fixer', 'openai/gpt-5.6-luna-fast', 'low'],
      ],
      deepseek: [
        ['oceanus', 'deepseek/deepseek-v4-flash', undefined],
        ['prometheus', 'deepseek/deepseek-v4-flash', undefined],
        ['designer', 'deepseek/deepseek-v4-flash', 'high'],
        ['explorer', 'deepseek/deepseek-v4-flash', 'low'],
      ],
      'opencode-go': [
        ['oceanus', 'opencode-go/glm-5.3', undefined],
        ['prometheus', 'opencode-go/glm-5.3', undefined],
        ['oracle', 'opencode-go/glm-5.3', 'high'],
        ['fixer', 'opencode-go/qwen-3.7-plus', 'low'],
        ['observer', 'opencode-go/glm-5.3-flash', 'medium'],
      ],
    };
    for (const [name, rows] of Object.entries(jsoncExpectations)) {
      const preset = getVendorBlueprint(name)?.preset;
      expect(preset).toBeDefined();
      for (const [agent, model, variant] of rows) {
        expect(preset?.[agent]?.model).toBe(model);
        expect(preset?.[agent]?.variant).toBe(variant);
      }
    }
  });
});

describe('generateVendorPreset', () => {
  function makeDfs(existing: Record<string, Preset> = {}) {
    const writes: Array<{ name: string; preset: Preset }> = [];
    const switches: string[] = [];
    return {
      writes,
      switches,
      deps: {
        readUserConfig: () => ({ presets: { ...existing } }),
        writePreset: (name: string, preset: Preset) => {
          writes.push({ name, preset });
          existing[name] = preset;
          return true;
        },
        switchPresetOnDisk: (presets: Record<string, Preset>, name: string) => {
          switches.push(name);
          return {
            ok: name in presets,
            presetName: name,
            message: name in presets ? 'ok' : 'missing',
            summary: [],
          };
        },
      },
    };
  }

  test('新厂商直接写入并返回 summary', async () => {
    const df = makeDfs();
    const result = await generateVendorPreset('gemini', {}, df.deps);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('written');
    expect(df.writes).toHaveLength(1);
    expect(df.writes[0]?.name).toBe('gemini');
    expect(result.summary?.length).toBe(9);
    expect(result.summary?.join('\n')).toContain('gemini/gemini-3-pro');
  });

  test('同名 preset 已存在且未授权覆盖时返回 conflict，不写入', async () => {
    const df = makeDfs({ zai: {} as Preset });
    const result = await generateVendorPreset('zai', {}, df.deps);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('conflict');
    expect(df.writes).toHaveLength(0);
  });

  test('overwrite=true 时覆盖写入', async () => {
    const df = makeDfs({ zai: {} as Preset });
    const result = await generateVendorPreset('zai', { overwrite: true }, df.deps);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('written');
    expect(df.writes).toHaveLength(1);
  });

  test('未知厂商返回可用清单', async () => {
    const df = makeDfs();
    const result = await generateVendorPreset('nope', {}, df.deps);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('unknown-vendor');
    expect(result.availableVendors).toContain('zai');
    expect(df.writes).toHaveLength(0);
  });

  test('activate=true 时写入后切换激活 preset', async () => {
    const df = makeDfs();
    const result = await generateVendorPreset('anthropic', { activate: true }, df.deps);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('已激活');
    expect(df.switches).toEqual(['anthropic']);
  });
});
