import { describe, expect, test } from 'bun:test';
import { buildCbmSharedDeps, startDaemonPrewarm } from './wiring';
import type { CbmSharedDeps } from './wiring';
import type { prewarmDaemon } from './daemon';

/** 构造最小 shared deps 形状的测试替身（不发网络、不落盘）。 */
function fakeShared(overrides?: {
  enabled?: boolean;
  autoDownload?: boolean;
  binaryPath?: string;
  ensureInstalled?: (opts?: unknown) => Promise<string | null>;
}): { shared: CbmSharedDeps; installCalls: number } {
  const installCalls = { n: 0 };
  const cm = {
    enabled: overrides?.enabled ?? true,
    autoDownload: overrides?.autoDownload ?? true,
    binaryPath: overrides?.binaryPath,
    autoIndex: false,
    version: '0.10.8',
    cacheDir: undefined,
  } as unknown as CbmSharedDeps['cm'];
  const shared: CbmSharedDeps = {
    cm,
    cacheRoot: '/cache/root',
    installOptions: {},
    ensureInstalled: async () => {
      installCalls.n += 1;
      return overrides?.ensureInstalled ? overrides.ensureInstalled() : '/cache/root/versions/0.10.8/linux-x64/codebase-memory-mcp';
    },
    startBackground: async () => null,
    repair: async () => null,
    runDeps: {} as CbmSharedDeps['runDeps'],
    indexer: {} as CbmSharedDeps['indexer'],
    uiEnsureInstalled: async () => null,
  };
  return { shared, installCalls: installCalls.n };
}

/** 可观察的 fake prewarm。 */
function fakePrewarm() {
  const calls: Array<{ binaryPath: string; cacheRoot: string; env: Record<string, string> }> = [];
  const fn: typeof prewarmDaemon = (options) => {
    calls.push({ binaryPath: options.binaryPath, cacheRoot: options.cacheRoot, env: options.env });
    return true;
  };
  return { calls, fn };
}

describe('startDaemonPrewarm：门控与分支', () => {
  test('cm.enabled=false 时不做任何事', () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ enabled: false });
    startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn });
    expect(prewarm.calls).toHaveLength(0);
  });

  test('binaryPath 显式配置时直接预热且不触发 ensureInstalled', () => {
    const prewarm = fakePrewarm();
    const { shared, installCalls } = fakeShared({
      binaryPath: '/custom/cbm-binary',
      ensureInstalled: () => {
        throw new Error('不应触发安装');
      },
    });
    startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn });
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].binaryPath).toBe('/custom/cbm-binary');
    expect(prewarm.calls[0].env.CBM_CACHE_DIR).toBe('/cache/root');
    expect(installCalls).toBe(0);
  });

  test('autoDownload=false 且缓存无二进制时不预热、不下载', () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({
      autoDownload: false,
      ensureInstalled: () => {
        throw new Error('不应触发安装');
      },
    });
    startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => false });
    expect(prewarm.calls).toHaveLength(0);
  });

  test('autoDownload=false 但缓存二进制已存在时用缓存路径预热', () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ autoDownload: false });
    startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => true });
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].binaryPath).toContain('/cache/root/versions/');
  });

  test('autoDownload=true 时经 ensureInstalled 解析路径后预热', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ ensureInstalled: async () => '/resolved/bin' });
    startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn });
    // ensureInstalled 是异步链：等待微任务队列清空
    await new Promise((r) => setTimeout(r, 0));
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].binaryPath).toBe('/resolved/bin');
  });

  test('ensureInstalled 失败/null 时静默跳过（fail-open）', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ ensureInstalled: async () => null });
    expect(() => startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(prewarm.calls).toHaveLength(0);
  });
});

describe('startDaemonPrewarm 与 buildCbmSharedDeps 集成', () => {
  test('真实 shared deps（默认启用+自动下载）下不抛异常', () => {
    const shared = buildCbmSharedDeps(undefined);
    const prewarm = fakePrewarm();
    expect(() =>
      startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn }),
    ).not.toThrow();
  });
});
