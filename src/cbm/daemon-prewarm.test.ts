import { describe, expect, test } from 'bun:test';
import { startDaemonPrewarm } from './wiring';
import type { CbmSharedDeps } from './wiring';
import type { DaemonEnsureFn } from './wiring';
import type { DaemonWaitResult } from './daemon';

/** 构造最小 shared deps 形状的测试替身（不发网络、不落盘）。 */
function fakeShared(overrides?: {
  enabled?: boolean;
  autoDownload?: boolean;
  binaryPath?: string;
  ensureInstalled?: (opts?: unknown) => Promise<string | null>;
}): { shared: CbmSharedDeps; installCalls: () => number } {
  let installs = 0;
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
      installs += 1;
      return overrides?.ensureInstalled
        ? overrides.ensureInstalled()
        : '/cache/root/versions/0.10.8/linux-x64/codebase-memory-mcp';
    },
    startBackground: async () => null,
    repair: async () => null,
    runDeps: {} as CbmSharedDeps['runDeps'],
    indexer: {} as CbmSharedDeps['indexer'],
    uiEnsureInstalled: async () => null,
  };
  return { shared, installCalls: () => installs };
}

/** 可观察的 fake daemon 预热（async：await 后记录就绪）。 */
function fakePrewarm() {
  const calls: Array<{
    binaryPath: string;
    cacheRoot: string;
    env: Record<string, string>;
    upgradeSessionManaged?: boolean;
  }> = [];
  const fn: DaemonEnsureFn = async (options) => {
    calls.push({
      binaryPath: options.binaryPath,
      cacheRoot: options.cacheRoot,
      env: options.env,
      upgradeSessionManaged: options.upgradeSessionManaged,
    });
    const result: DaemonWaitResult = { status: 'ready', mode: 'started', elapsedMs: 1 };
    return result;
  };
  return { calls, fn };
}

describe('startDaemonPrewarm：门控与分支（async 等待语义）', () => {
  test('cm.enabled=false 时不做任何事', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ enabled: false });
    await startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn });
    expect(prewarm.calls).toHaveLength(0);
  });

  test('预热请求带 upgradeSessionManaged=true（session→permanent 升级开通）', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({});
    await startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => true });
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].upgradeSessionManaged).toBe(true);
  });

  test('binaryPath 显式配置时等待它就绪且不触发 ensureInstalled', async () => {
    const prewarm = fakePrewarm();
    const { shared, installCalls } = fakeShared({
      binaryPath: '/custom/cbm-binary',
      ensureInstalled: () => {
        throw new Error('不应触发安装');
      },
    });
    await startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn });
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].binaryPath).toBe('/custom/cbm-binary');
    expect(prewarm.calls[0].env.CBM_CACHE_DIR).toBe('/cache/root');
    expect(installCalls()).toBe(0);
  });

  test('autoDownload=false 且缓存无二进制时不等待、不下载', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({
      autoDownload: false,
      ensureInstalled: () => {
        throw new Error('不应触发安装');
      },
    });
    await startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => false });
    expect(prewarm.calls).toHaveLength(0);
  });

  test('autoDownload=false 但缓存二进制已存在时等待缓存路径就绪', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ autoDownload: false });
    await startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => true });
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].binaryPath).toContain('/cache/root/versions/');
  });

  test('autoDownload=true 且缓存二进制已存在：直接等待就绪（主竞态场景）', async () => {
    const prewarm = fakePrewarm();
    const { shared, installCalls } = fakeShared({
      ensureInstalled: () => {
        throw new Error('缓存已存在不应触发安装');
      },
    });
    await startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => true });
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].binaryPath).toContain('/cache/root/versions/');
    expect(installCalls()).toBe(0);
  });

  test('autoDownload=true 且缓存缺失：后台经 ensureInstalled 预热，不阻塞', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ ensureInstalled: async () => '/resolved/bin' });
    await startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => false });
    // fire-and-forget 分支：等待微任务队列清空后应已调用预热。
    await new Promise((r) => setTimeout(r, 0));
    expect(prewarm.calls).toHaveLength(1);
    expect(prewarm.calls[0].binaryPath).toBe('/resolved/bin');
  });

  test('autoDownload=true、缓存缺失且 ensureInstalled 失败/null：静默跳过（fail-open）', async () => {
    const prewarm = fakePrewarm();
    const { shared } = fakeShared({ ensureInstalled: async () => null });
    await expect(
      startDaemonPrewarm(shared, undefined, { prewarm: prewarm.fn, exists: () => false }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(prewarm.calls).toHaveLength(0);
  });

  test('预热返回非 ready 不抛异常（fail-open）', async () => {
    const prewarm: DaemonEnsureFn = async () => ({
      status: 'timeout',
      elapsedMs: 15_000,
      detail: 'timed out',
    });
    const { shared } = fakeShared({ binaryPath: '/custom/cbm-binary' });
    await expect(
      startDaemonPrewarm(shared, undefined, { prewarm }),
    ).resolves.toBeUndefined();
  });
});
