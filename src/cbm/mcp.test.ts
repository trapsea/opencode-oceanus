import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { buildTarGz, mockBinaryContent } from '../../test-fixtures/cbm/archives';
import { getPlatformKey, resolveCbmPlatform } from './constants';
import { createCanonicalManifest } from './manifest';
import { resetProvisionSingleton } from './provision';
import {
  buildLocalConfig,
  buildMcpEnvironment,
  CBM_MANAGED_MARKER_ENV,
  isCbmManaged,
  MCP_ENV_WHITELIST,
  MCP_SERVER_NAME,
  registerCbmMcp,
  removeCbmMcp,
  resolveExpectedBinaryPath,
} from './mcp';
import type { MCPDraftLike, MCPServerConfigLike } from '../runtime/types';
import type { PluginConfig } from '../config/schema';
import { getCodebaseMemoryConfig } from '../config/utils';

/**
 * CBM-08：ctx.mcp.transform 本地 codebase-memory-mcp server 注册器。
 *
 * 使用 fake MCP draft（真实 MCPDraft 形状），覆盖：
 * draft.set 参数、禁用配置、同名配置保护、reload 失败隔离、
 * 安装成功更新（command/environment/disabled=false）、二进制缺失不注册、
 * 环境白名单、cleanup ownership。安装路径复用 CBM-05 注入（fake download/spawn）。
 */

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cbm-mcp-'));
}

function makeFakeDraft(initial: Record<string, MCPServerConfigLike> = {}) {
  const map = new Map<string, MCPServerConfigLike>(Object.entries(initial));
  const draft: MCPDraftLike = {
    list: () => Array.from(map.entries()),
    get: (name) => map.get(name),
    set: (name, cfg) => {
      map.set(name, cfg);
    },
    update: (name, cb) => {
      const cfg = map.get(name);
      if (cfg) cb(cfg);
    },
    remove: (name) => {
      map.delete(name);
    },
  };
  return { draft, map };
}

function makeFakeMcpCtx(draft: MCPDraftLike) {
  let reloadFail = false;
  let reloadCalls = 0;
  const ctx = {
    mcp: {
      transform: async (cb: (d: MCPDraftLike) => void) => {
        cb(draft);
        return {};
      },
      reload: async () => {
        reloadCalls++;
        if (reloadFail) throw new Error('reload exploded');
      },
    },
    get reloadCalls() {
      return reloadCalls;
    },
    setReloadFail(v: boolean) {
      reloadFail = v;
    },
  };
  return ctx;
}

function managedLocal(cfg?: Partial<MCPServerConfigLike>): MCPServerConfigLike {
  return {
    type: 'local',
    command: ['/cache/versions/0.10.8/linux-x64/codebase-memory-mcp'],
    environment: { [CBM_MANAGED_MARKER_ENV]: '1' },
    disabled: false,
    codemode: true,
    ...cfg,
  };
}

function baseConfig(cacheDir: string, over: Partial<PluginConfig['codebaseMemory']> = {}): PluginConfig {
  return {
    codebaseMemory: {
      enabled: true,
      autoDownload: true,
      mcp: true,
      version: '0.10.8',
      cacheDir,
      ...over,
    },
  };
}

const roots: string[] = [];
function newRoot(): string {
  const r = tempRoot();
  roots.push(r);
  return r;
}

beforeEach(() => {
  resetProvisionSingleton();
});
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots.length = 0;
  resetProvisionSingleton();
});

describe('CBM-08 二进制已就绪：draft.set 参数与完整配置', () => {
  test('直接 set 完整 local server（command 数组、disabled=false、env 白名单+marker）', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir);
    const binary = resolveExpectedBinaryPath(
      // 直接用解析配置计算预期路径
      { version: '0.10.8', binaryPath: undefined, cacheDir } as never,
      cacheDir,
    );
    mkdirSync(join(cacheDir, 'versions', '0.10.8', getPlatformKey(resolveCbmPlatform('linux', 'x64'))), {
      recursive: true,
    });
    writeFileSync(binary, 'binary');
    const { draft, map } = makeFakeDraft();
    const ctx = makeFakeMcpCtx(draft);

    const res = await registerCbmMcp(ctx as never, cfg);

    expect(res.server).toBe(MCP_SERVER_NAME);
    expect(res.registered).toBe(true);
    expect(res.disabled).toBe(false);
    expect(res.installed).toBe(false);
    expect(res.skippedUnknown).toBe(false);
    expect(res.reloaded).toBe(true);
    expect(ctx.reloadCalls).toBe(1); // reload 最多一次

    const srv = map.get(MCP_SERVER_NAME);
    expect(srv).toBeDefined();
    expect(srv?.type).toBe('local');
    const local = srv as Extract<MCPServerConfigLike, { type: 'local' }>;
    expect(Array.isArray(local.command)).toBe(true);
    expect(local.command).toEqual([binary]);
    expect(local.disabled).toBe(false);
    expect(local.codemode).toBe(true);
    // 环境白名单：只含白名单键 + marker
    const envKeys = Object.keys(local.environment ?? {});
    for (const k of envKeys) expect(MCP_ENV_WHITELIST).toContain(k);
    expect(local.environment?.CBM_CACHE_DIR).toBe(cacheDir);
    expect(local.environment?.[CBM_MANAGED_MARKER_ENV]).toBe('1');
    expect(isCbmManaged(local)).toBe(true);
  });

  test('显式 binaryPath 优先于缓存推导', async () => {
    const cacheDir = newRoot();
    const binary = join(cacheDir, 'custom-bin', 'cbm');
    mkdirSync(join(cacheDir, 'custom-bin'), { recursive: true });
    writeFileSync(binary, 'binary');
    const cfg = baseConfig(cacheDir, { binaryPath: binary });
    const { draft } = makeFakeDraft();
    const ctx = makeFakeMcpCtx(draft);
    await registerCbmMcp(ctx as never, cfg);
    const srv = draft.get(MCP_SERVER_NAME) as Extract<MCPServerConfigLike, { type: 'local' }>;
    expect(srv.command[0]).toBe(binary);
  });
});

describe('CBM-08 二进制缺失：占位 + 安装成功后更新 + reload 一次', () => {
  function installOpts(cacheDir: string) {
    const platform = resolveCbmPlatform('linux', 'x64');
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: mockBinaryContent('linux') }]);
    const hash = sha256Hex(archive);
    const manifest = createCanonicalManifest(platform, hash, {
      url: 'https://example.invalid/cbm.tar.gz',
    });
    return {
      cacheRoot: cacheDir,
      platform,
      manifest,
      download: async (_u: string, dest: string) => writeFileSync(dest, archive),
      spawn: () => ({
        exited: Promise.resolve(0),
        stdout: async () => '',
        stderr: async () => '',
        kill: () => true,
        get exitCode() {
          return 0;
        },
      }),
      pid: 123,
      now: () => 1000,
      isPidAlive: () => true,
    };
  }

  test('占位 disabled → 安装成功更新 command/environment 且 disabled=false，reload 恰好一次', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir);
    const { draft, map } = makeFakeDraft();
    const ctx = makeFakeMcpCtx(draft);

    const res = await registerCbmMcp(ctx as never, cfg, installOpts(cacheDir) as never);

    expect(res.registered).toBe(true);
    expect(res.installed).toBe(true);
    expect(res.disabled).toBe(false);
    expect(res.mutated).toBe(true);
    expect(res.reloaded).toBe(true);
    expect(ctx.reloadCalls).toBe(1); // 占位 + 更新只 reload 一次

    const srv = map.get(MCP_SERVER_NAME) as Extract<MCPServerConfigLike, { type: 'local' }>;
    const platformKey = getPlatformKey(resolveCbmPlatform('linux', 'x64'));
    expect(srv.command[0]).toBe(
      join(cacheDir, 'versions', '0.10.8', platformKey, 'codebase-memory-mcp'),
    );
    expect(srv.disabled).toBe(false);
    expect(srv.environment?.CBM_CACHE_DIR).toBe(cacheDir);
    expect(srv.environment?.[CBM_MANAGED_MARKER_ENV]).toBe('1');
  });

  test('安装失败：保留 disabled 占位，fail-open 不抛异常，reload 一次', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir, { autoDownload: true });
    const platform = resolveCbmPlatform('linux', 'x64');
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'ok' }]);
    const wrongHash = sha256Hex(Buffer.from('different'));
    const manifest = createCanonicalManifest(platform, wrongHash, {
      url: 'https://example.invalid/cbm.tar.gz',
    });
    const { draft, map } = makeFakeDraft();
    const ctx = makeFakeMcpCtx(draft);

    let res!: ReturnType<typeof registerCbmMcp> extends Promise<infer T> ? T : never;
    await expect(
      (async () => {
        res = await registerCbmMcp(ctx as never, cfg, {
          cacheRoot: cacheDir,
          platform,
          manifest,
          download: async (_u, dest) => writeFileSync(dest, archive),
          spawn: () => ({
            exited: Promise.resolve(1),
            stdout: async () => '',
            stderr: async () => '',
            kill: () => true,
            get exitCode() {
              return 1;
            },
          }),
          pid: 9,
          now: () => 1,
          isPidAlive: () => true,
        } as never);
      })(),
    ).resolves.toBeUndefined();

    expect(res.registered).toBe(true);
    expect(res.installed).toBe(false);
    expect(res.disabled).toBe(true); // 保留占位
    const srv = map.get(MCP_SERVER_NAME) as Extract<MCPServerConfigLike, { type: 'local' }>;
    expect(srv.disabled).toBe(true);
    expect(ctx.reloadCalls).toBe(1);
  });

  test('不自动下载且二进制缺失：不注册（fail-open 跳过）', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir, { autoDownload: false });
    const { draft, map } = makeFakeDraft();
    const ctx = makeFakeMcpCtx(draft);
    const res = await registerCbmMcp(ctx as never, cfg);
    expect(res.registered).toBe(false);
    expect(res.installed).toBe(false);
    expect(res.mutated).toBe(false);
    expect(map.has(MCP_SERVER_NAME)).toBe(false);
    expect(ctx.reloadCalls).toBe(0);
  });
});

describe('CBM-08 禁用与同名保护', () => {
  test('mcp=false：移除 Oceanus 托管 server，保留用户配置与 CLI', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir, { mcp: false });
    const { draft, map } = makeFakeDraft({ [MCP_SERVER_NAME]: managedLocal() });
    const ctx = makeFakeMcpCtx(draft);
    const res = await registerCbmMcp(ctx as never, cfg);
    expect(res.registered).toBe(false);
    expect(res.disabled).toBe(false);
    expect(map.has(MCP_SERVER_NAME)).toBe(false);
    expect(ctx.reloadCalls).toBe(1);
  });

  test('mcp=false 且无现有 server：不注册、不 reload', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir, { mcp: false });
    const { draft, map } = makeFakeDraft();
    const ctx = makeFakeMcpCtx(draft);
    const res = await registerCbmMcp(ctx as never, cfg);
    expect(res.registered).toBe(false);
    expect(res.mutated).toBe(false);
    expect(map.has(MCP_SERVER_NAME)).toBe(false);
    expect(ctx.reloadCalls).toBe(0);
  });

  test('同名未知配置：跳过不覆盖、不删除、不 reload', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir);
    const userCfg: MCPServerConfigLike = {
      type: 'local',
      command: ['/usr/bin/other'],
      environment: { FOO: 'bar' },
    };
    const { draft, map } = makeFakeDraft({ [MCP_SERVER_NAME]: userCfg });
    const ctx = makeFakeMcpCtx(draft);
    const res = await registerCbmMcp(ctx as never, cfg);
    expect(res.skippedUnknown).toBe(true);
    expect(res.registered).toBe(false);
    expect(res.mutated).toBe(false);
    expect(map.get(MCP_SERVER_NAME)).toEqual(userCfg);
    expect(ctx.reloadCalls).toBe(0);
  });
});

describe('CBM-08 reload 隔离与 cleanup ownership', () => {
  test('reload 失败只影响 MCP，不抛异常（fail-open）', async () => {
    const cacheDir = newRoot();
    const cfg = baseConfig(cacheDir);
    const binary = resolveExpectedBinaryPath(
      { version: '0.10.8', binaryPath: undefined, cacheDir } as never,
      cacheDir,
    );
    mkdirSync(
      join(cacheDir, 'versions', '0.10.8', getPlatformKey(resolveCbmPlatform('linux', 'x64'))),
      { recursive: true },
    );
    writeFileSync(binary, 'binary');
    const { draft, map } = makeFakeDraft();
    const ctx = makeFakeMcpCtx(draft);
    ctx.setReloadFail(true);

    let res!: ReturnType<typeof registerCbmMcp> extends Promise<infer T> ? T : never;
    await expect(
      (async () => {
        res = await registerCbmMcp(ctx as never, cfg);
      })(),
    ).resolves.toBeUndefined();

    expect(res.reloaded).toBe(false);
    expect(res.mutated).toBe(true);
    // 即使 reload 失败，draft 里 server 仍然存在
    expect(map.has(MCP_SERVER_NAME)).toBe(true);
  });

  test('cleanup 只移除 Oceanus 托管 server，保留用户自有配置', async () => {
    const cacheDir = newRoot();
    const userCfg: MCPServerConfigLike = {
      type: 'local',
      command: ['/usr/bin/other'],
      environment: { FOO: 'bar' },
    };
    const { draft, map } = makeFakeDraft({
      [MCP_SERVER_NAME]: managedLocal(),
      'user-own-server': userCfg,
    });
    const ctx = makeFakeMcpCtx(draft);

    const removed = await removeCbmMcp(ctx as never);

    expect(removed).toBe(true);
    expect(map.has(MCP_SERVER_NAME)).toBe(false);
    // 用户自有 server（不同名）不受影响
    expect(map.get('user-own-server')).toEqual(userCfg);
    expect(ctx.reloadCalls).toBe(1);
  });

  test('cleanup 对同名未知配置不动手（不做移除）', async () => {
    const cacheDir = newRoot();
    const userCfg: MCPServerConfigLike = {
      type: 'local',
      command: ['/usr/bin/other'],
      environment: {},
    };
    const { draft, map } = makeFakeDraft({ [MCP_SERVER_NAME]: userCfg });
    const ctx = makeFakeMcpCtx(draft);
    const removed = await removeCbmMcp(ctx as never);
    expect(removed).toBe(false);
    expect(map.get(MCP_SERVER_NAME)).toEqual(userCfg);
    expect(ctx.reloadCalls).toBe(0);
  });
});

describe('CBM-08 环境白名单与构造辅助', () => {
  test('传入冲突 cacheRoot 时仍使用共享配置根', async () => {
    const root = newRoot();
    const other = newRoot();
    const cfg = baseConfig(root);
    const binary = resolveExpectedBinaryPath({ version: '0.10.8', cacheDir: root } as never, root);
    mkdirSync(join(root, 'versions', '0.10.8', getPlatformKey(resolveCbmPlatform('linux', 'x64'))), { recursive: true });
    writeFileSync(binary, 'binary');
    const { draft } = makeFakeDraft();
    await registerCbmMcp(makeFakeMcpCtx(draft) as never, cfg, { cacheRoot: other } as never);
    const srv = draft.get(MCP_SERVER_NAME) as Extract<MCPServerConfigLike, { type: 'local' }>;
    expect(srv.environment?.CBM_CACHE_DIR).toBe(root);
  });

  test('buildMcpEnvironment 只包含白名单键、CBM_CACHE_DIR 与 marker', () => {
    process.env.PROVIDER_SECRET_TOKEN = 'should-not-leak';
    process.env.HOME = '/home/user';
    try {
      const env = buildMcpEnvironment('/cache');
      expect(env.CBM_CACHE_DIR).toBe('/cache');
      expect(env[CBM_MANAGED_MARKER_ENV]).toBe('1');
      expect(env.PROVIDER_SECRET_TOKEN).toBeUndefined();
      for (const k of Object.keys(env)) expect(MCP_ENV_WHITELIST).toContain(k);
    } finally {
      delete process.env.PROVIDER_SECRET_TOKEN;
    }
  });

  test('buildLocalConfig 形状与 isCbmManaged 判定', () => {
    const cfg = baseConfig('/cache');
    const local = buildLocalConfig(
      getCodebaseMemoryConfig(cfg),
      '/cache/bin',
      false,
      '/cache',
    );
    expect(local.type).toBe('local');
    expect(local.command).toEqual(['/cache/bin']);
    expect(local.disabled).toBe(false);
    expect(isCbmManaged(local)).toBe(true);
    expect(isCbmManaged({ type: 'local', command: ['x'], environment: {} })).toBe(false);
    expect(isCbmManaged(undefined)).toBe(false);
  });
});
