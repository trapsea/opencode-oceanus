import { describe, expect, test } from 'bun:test';
import {
  PluginConfigSchema,
  type HookConfig,
  type ToolConfig,
} from './schema';
import {
  mergePluginConfigs,
  resolvePresetAgents,
} from './loader';
import {
  getDisabledHooks,
  getDisabledTools,
  getHookConfig,
  getToolConfig,
  isHookEnabled,
  isToolEnabled,
} from './utils';

describe('工具/Hook 结构化配置 schema', () => {
  test('接受 tools/hooks/disabled_tools/disabled_hooks 结构化配置', () => {
    const result = PluginConfigSchema.safeParse({
      disabled_tools: ['legacy_tool'],
      disabled_hooks: ['legacy_hook'],
      tools: {
        ast_grep_search: { enabled: true, timeoutMs: 30000, maxMatches: 200 },
        hashline_edit: { enabled: false, maxFileBytes: 1048576 },
        task_status: { enabled: true },
      },
      hooks: {
        apply_patch: { enabled: true },
        tool_loop_guard: { enabled: true, warnAt: 3, blockAt: 5 },
        task_registry_observer: { enabled: true },
      },
    });

    expect(result.success).toBe(true);
  });

  test('默认 enabled 为 true（未配置时）', () => {
    const config = PluginConfigSchema.parse({});
    expect(isToolEnabled(config, 'ast_grep_search')).toBe(true);
    expect(isHookEnabled(config, 'tool_loop_guard')).toBe(true);
  });

  test('拒绝未知工具名', () => {
    const result = PluginConfigSchema.safeParse({
      tools: { unknown_tool: { enabled: true } },
    });
    expect(result.success).toBe(false);
  });

  test('拒绝未知 Hook 名', () => {
    const result = PluginConfigSchema.safeParse({
      hooks: { unknown_hook: { enabled: true } },
    });
    expect(result.success).toBe(false);
  });

  test('拒绝工具配置中的未知字段', () => {
    const result = PluginConfigSchema.safeParse({
      tools: { task_status: { enabled: true, bogusField: 1 } },
    });
    expect(result.success).toBe(false);
  });

  test('拒绝 Hook 配置中的未知字段', () => {
    const result = PluginConfigSchema.safeParse({
      hooks: { apply_patch: { enabled: true, nope: 'x' } },
    });
    expect(result.success).toBe(false);
  });

  test('拒绝未知顶层配置字段', () => {
    const result = PluginConfigSchema.safeParse({ tools_extra: {} });
    expect(result.success).toBe(false);
  });
});

describe('tools/hooks 深度合并', () => {
  test('同一项只覆盖显式提供的字段（工具）', () => {
    const merged = mergePluginConfigs(
      {
        tools: {
          ast_grep_search: { enabled: true, timeoutMs: 1000 },
        },
      },
      {
        tools: {
          ast_grep_search: { maxMatches: 5 },
        },
      },
    );

    expect(merged.tools?.ast_grep_search).toEqual({
      enabled: true,
      timeoutMs: 1000,
      maxMatches: 5,
    });
  });

  test('同一项只覆盖显式提供的字段（Hook）', () => {
    const merged = mergePluginConfigs(
      {
        hooks: {
          tool_loop_guard: { enabled: true, warnAt: 3 },
        },
      },
      {
        hooks: {
          tool_loop_guard: { blockAt: 5 },
        },
      },
    );

    expect(merged.hooks?.tool_loop_guard).toEqual({
      enabled: true,
      warnAt: 3,
      blockAt: 5,
    });
  });

  test('项目配置覆盖用户配置的独立项', () => {
    const merged = mergePluginConfigs(
      {
        tools: { task_status: { enabled: false } },
        hooks: { apply_patch: { enabled: true } },
      },
      {
        tools: { task_result: { enabled: true } },
      },
    );

    expect(merged.tools?.task_status).toEqual({ enabled: false });
    expect(merged.tools?.task_result).toEqual({ enabled: true });
    expect(merged.hooks?.apply_patch).toEqual({ enabled: true });
  });

  test('disabled 列表作为数组整体由项目覆盖用户配置', () => {
    const merged = mergePluginConfigs(
      { disabled_tools: ['a'], disabled_hooks: ['x'] },
      { disabled_tools: ['b', 'c'] },
    );

    expect(merged.disabled_tools).toEqual(['b', 'c']);
    expect(merged.disabled_hooks).toEqual(['x']);
  });
});

describe('工具/Hook 启停判断（禁用列表优先）', () => {
  test('disabled_tools 优先于 item.enabled=true', () => {
    const config = PluginConfigSchema.parse({
      disabled_tools: ['task_status'],
      tools: { task_status: { enabled: true } },
    });
    expect(isToolEnabled(config, 'task_status')).toBe(false);
  });

  test('disabled_hooks 优先于 item.enabled=true', () => {
    const config = PluginConfigSchema.parse({
      disabled_hooks: ['apply_patch'],
      hooks: { apply_patch: { enabled: true } },
    });
    expect(isHookEnabled(config, 'apply_patch')).toBe(false);
  });

  test('item.enabled=false 禁用对应能力', () => {
    const config = PluginConfigSchema.parse({
      tools: { hashline_edit: { enabled: false } },
      hooks: { tool_loop_guard: { enabled: false } },
    });
    expect(isToolEnabled(config, 'hashline_edit')).toBe(false);
    expect(isHookEnabled(config, 'tool_loop_guard')).toBe(false);
  });

  test('未禁用且未显式 enabled 时默认启用', () => {
    const config = PluginConfigSchema.parse({
      disabled_tools: ['task_cancel'],
    });
    expect(isToolEnabled(config, 'ast_grep_search')).toBe(true);
    expect(isToolEnabled(config, 'task_cancel')).toBe(false);
    expect(isHookEnabled(config, 'json_error_recovery')).toBe(true);
  });

  test('getToolConfig / getHookConfig 返回对应配置', () => {
    const config = PluginConfigSchema.parse({
      tools: { task_result: { enabled: true } },
      hooks: { tool_output_truncator: { enabled: true, maxOutputBytes: 100 } },
    });

    const toolCfg = getToolConfig(config, 'task_result') as ToolConfig;
    expect(toolCfg?.enabled).toBe(true);

    const hookCfg = getHookConfig(
      config,
      'tool_output_truncator',
    ) as HookConfig;
    expect(hookCfg?.maxOutputBytes).toBe(100);
  });

  test('getDisabledTools / getDisabledHooks 返回禁用集合', () => {
    const config = PluginConfigSchema.parse({
      disabled_tools: ['a', 'b'],
      disabled_hooks: ['c'],
    });
    expect(getDisabledTools(config)).toEqual(new Set(['a', 'b']));
    expect(getDisabledHooks(config)).toEqual(new Set(['c']));
  });
});

describe('与 preset/agent 配置共存', () => {
  test('结构化 tools/hooks 不影响 agent preset 解析', () => {
    const merged = mergePluginConfigs(
      {
        preset: 'fast',
        presets: { fast: { explorer: { model: 'user/model' } } },
        tools: { ast_grep_search: { enabled: true } },
      },
      {
        tools: { ast_grep_search: { timeoutMs: 5000 } },
      },
    );

    expect(resolvePresetAgents(merged)).toEqual({
      explorer: { model: 'user/model' },
    });
    expect(merged.tools?.ast_grep_search).toEqual({
      enabled: true,
      timeoutMs: 5000,
    });
  });
});
