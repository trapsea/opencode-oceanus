import { describe, expect, test } from 'bun:test';
import { mergePluginConfigs } from './loader';
import { PluginConfigSchema } from './schema';
import {
  DEFAULT_CODEBASE_MEMORY_VERSION,
  getCodebaseMemoryConfig,
  getDefaultCodebaseMemoryConfig,
  isCodebaseMemoryAutoIndexEnabled,
  isCodebaseMemoryCliFallbackEnabled,
  isCodebaseMemoryEnabled,
  isCodebaseMemoryGuidanceEnabled,
  isCodebaseMemoryMcpEnabled,
  isCodebaseMemoryUiAutoStart,
} from './utils';

const fullCodebaseMemory = {
  enabled: true,
  autoDownload: true,
  version: '0.11.0',
  binaryPath: '/opt/cbm/codebase-memory-mcp',
  cacheDir: '/tmp/cbm-cache',
  autoIndex: true,
  indexOnStart: true,
  mcp: false,
  cliFallback: true,
  guidance: false,
  ui: {
    enabled: true,
    autoStart: true,
    host: '0.0.0.0',
    port: 8080,
    open: true,
  },
};

describe('codebaseMemory 配置 schema', () => {
  test('接受完整合法配置（含 ui 子对象）', () => {
    const result = PluginConfigSchema.safeParse({
      codebaseMemory: fullCodebaseMemory,
    });
    expect(result.success).toBe(true);
  });

  test('接受只启用少数字段的配置', () => {
    const result = PluginConfigSchema.safeParse({
      codebaseMemory: { enabled: true },
    });
    expect(result.success).toBe(true);
  });

  test('codebaseMemory 缺省时允许空配置', () => {
    const result = PluginConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('拒绝 codebaseMemory 内未知字段', () => {
    const result = PluginConfigSchema.safeParse({
      codebaseMemory: { bogus: true },
    });
    expect(result.success).toBe(false);
  });

  test('拒绝 ui 子对象内未知字段', () => {
    const result = PluginConfigSchema.safeParse({
      codebaseMemory: { ui: { bogus: 1 } },
    });
    expect(result.success).toBe(false);
  });

  test('拒绝 ui.port 非合法端口', () => {
    expect(
      PluginConfigSchema.safeParse({
        codebaseMemory: { ui: { port: 0 } },
      }).success,
    ).toBe(false);
    expect(
      PluginConfigSchema.safeParse({
        codebaseMemory: { ui: { port: 70000 } },
      }).success,
    ).toBe(false);
    expect(
      PluginConfigSchema.safeParse({
        codebaseMemory: { ui: { port: '9749' } },
      }).success,
    ).toBe(false);
  });

  test('拒绝空 version', () => {
    const result = PluginConfigSchema.safeParse({
      codebaseMemory: { version: '' },
    });
    expect(result.success).toBe(false);
  });
});

describe('codebaseMemory 默认值', () => {
  test('未配置时返回默认 resolved 配置', () => {
    const resolved = getDefaultCodebaseMemoryConfig();
    expect(resolved.enabled).toBe(true);
    expect(resolved.autoDownload).toBe(true);
    expect(resolved.version).toBe(DEFAULT_CODEBASE_MEMORY_VERSION);
    expect(resolved.autoIndex).toBe(true);
    expect(resolved.indexOnStart).toBe(false);
    expect(resolved.mcp).toBe(true);
    expect(resolved.cliFallback).toBe(true);
    expect(resolved.guidance).toBe(true);
    expect(resolved.ui).toEqual({
      enabled: true,
      autoStart: false,
      host: '127.0.0.1',
      port: 9749,
      open: false,
    });
  });

  test('未配置 codebaseMemory 时 getCodebaseMemoryConfig 返回默认', () => {
    expect(getCodebaseMemoryConfig(undefined)).toEqual(
      getDefaultCodebaseMemoryConfig(),
    );
    expect(getCodebaseMemoryConfig(PluginConfigSchema.parse({}))).toEqual(
      getDefaultCodebaseMemoryConfig(),
    );
  });

  test('部分字段覆盖后其余保持默认', () => {
    const config = PluginConfigSchema.parse({
      codebaseMemory: { version: '1.0.0', mcp: false },
    });
    const resolved = getCodebaseMemoryConfig(config);
    expect(resolved.version).toBe('1.0.0');
    expect(resolved.mcp).toBe(false);
    expect(resolved.enabled).toBe(true);
    expect(resolved.autoDownload).toBe(true);
    expect(resolved.autoIndex).toBe(true);
    expect(resolved.cliFallback).toBe(true);
    expect(resolved.guidance).toBe(true);
  });

  test('ui 子对象部分字段覆盖后其余保持默认', () => {
    const config = PluginConfigSchema.parse({
      codebaseMemory: { ui: { port: 9000 } },
    });
    const resolved = getCodebaseMemoryConfig(config);
    expect(resolved.ui.port).toBe(9000);
    expect(resolved.ui.host).toBe('127.0.0.1');
    expect(resolved.ui.autoStart).toBe(false);
    expect(resolved.ui.open).toBe(false);
    expect(resolved.ui.enabled).toBe(true);
  });
});

describe('codebaseMemory 启用判断与访问', () => {
  test('isCodebaseMemoryEnabled 默认为 true，可显式关闭', () => {
    expect(isCodebaseMemoryEnabled(undefined)).toBe(true);
    expect(
      isCodebaseMemoryEnabled(
        PluginConfigSchema.parse({ codebaseMemory: { enabled: false } }),
      ),
    ).toBe(false);
  });

  test('autoIndex / mcp / cliFallback / guidance 访问器', () => {
    const config = PluginConfigSchema.parse({
      codebaseMemory: {
        autoIndex: false,
        mcp: false,
        cliFallback: false,
        guidance: false,
      },
    });
    expect(isCodebaseMemoryAutoIndexEnabled(config)).toBe(false);
    expect(isCodebaseMemoryMcpEnabled(config)).toBe(false);
    expect(isCodebaseMemoryCliFallbackEnabled(config)).toBe(false);
    expect(isCodebaseMemoryGuidanceEnabled(config)).toBe(false);
  });

  test('ui.autoStart 访问器默认为 false', () => {
    expect(isCodebaseMemoryUiAutoStart(undefined)).toBe(false);
    const config = PluginConfigSchema.parse({
      codebaseMemory: { ui: { autoStart: true } },
    });
    expect(isCodebaseMemoryUiAutoStart(config)).toBe(true);
  });
});

describe('codebaseMemory 用户/项目合并与兼容', () => {
  test('项目 codebaseMemory 与用户配置深度合并，未显式字段保留用户值', () => {
    const merged = mergePluginConfigs(
      { codebaseMemory: { version: '0.10.8', autoIndex: true } },
      { codebaseMemory: { version: '0.11.0', mcp: false } },
    );
    expect(merged.codebaseMemory).toEqual({
      version: '0.11.0',
      autoIndex: true,
      mcp: false,
    });
  });

  test('项目仅配置 ui 子字段时保留用户 ui 其余子字段', () => {
    const merged = mergePluginConfigs(
      { codebaseMemory: { ui: { host: '0.0.0.0', autoStart: true } } },
      { codebaseMemory: { ui: { port: 9000 } } },
    );
    expect(merged.codebaseMemory).toEqual({
      ui: { host: '0.0.0.0', autoStart: true, port: 9000 },
    });
  });

  test('项目显式 ui 子字段覆盖用户同名字段', () => {
    const merged = mergePluginConfigs(
      { codebaseMemory: { ui: { host: '0.0.0.0', port: 8080 } } },
      { codebaseMemory: { ui: { port: 9090 } } },
    );
    expect(merged.codebaseMemory).toEqual({
      ui: { host: '0.0.0.0', port: 9090 },
    });
  });

  test('顶层字段深度合并：项目优先，用户未覆盖字段保留', () => {
    const merged = mergePluginConfigs(
      {
        codebaseMemory: {
          version: '0.10.8',
          autoIndex: true,
          mcp: true,
          cliFallback: false,
        },
      },
      { codebaseMemory: { version: '0.11.0' } },
    );
    expect(merged.codebaseMemory).toEqual({
      version: '0.11.0',
      autoIndex: true,
      mcp: true,
      cliFallback: false,
    });
  });

  test('项目未配置 codebaseMemory 时保留用户全部配置', () => {
    const merged = mergePluginConfigs(
      { codebaseMemory: { version: '0.10.8', ui: { port: 8080 } } },
      {},
    );
    expect(merged.codebaseMemory).toEqual({
      version: '0.10.8',
      ui: { port: 8080 },
    });
  });

  test('用户未配置 codebaseMemory 时采用项目配置', () => {
    const merged = mergePluginConfigs(
      {},
      { codebaseMemory: { version: '0.11.0', ui: { port: 9090 } } },
    );
    expect(merged.codebaseMemory).toEqual({
      version: '0.11.0',
      ui: { port: 9090 },
    });
  });

  test('合并后未在任何层显式的字段仍由默认值补齐', () => {
    const merged = mergePluginConfigs(
      { codebaseMemory: { version: '0.10.8' } },
      { codebaseMemory: { mcp: false } },
    );
    const resolved = getCodebaseMemoryConfig(merged);
    expect(resolved.version).toBe('0.10.8');
    expect(resolved.mcp).toBe(false);
    expect(resolved.autoIndex).toBe(true);
    expect(resolved.enabled).toBe(true);
  });

  test('用户显式字段在项目未覆盖时得到保留', () => {
    const merged = mergePluginConfigs(
      { codebaseMemory: { autoIndex: false, ui: { autoStart: true } } },
      { codebaseMemory: { version: '0.11.0' } },
    );
    const resolved = getCodebaseMemoryConfig(merged);
    expect(resolved.version).toBe('0.11.0');
    expect(resolved.autoIndex).toBe(false);
    expect(resolved.ui.autoStart).toBe(true);
  });

  test('现有配置（无 codebaseMemory）兼容', () => {
    const config = PluginConfigSchema.parse({ disabled_agents: ['observer'] });
    expect(config.codebaseMemory).toBeUndefined();
    expect(getCodebaseMemoryConfig(config).enabled).toBe(true);
  });
});
