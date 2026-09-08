import { describe, expect, test } from 'bun:test';
import { prewarmDaemon, type DaemonSpawnFn } from './daemon';

/** 记录调用参数并可注入行为的 fake spawn。 */
function fakeSpawn(behavior?: { throw?: Error }) {
  const calls: Array<{ command: string[]; options: unknown }> = [];
  const spawnFn: DaemonSpawnFn = (command, options) => {
    calls.push({ command, options });
    if (behavior?.throw) throw behavior.throw;
    return { unref: () => {} };
  };
  return { calls, spawnFn };
}

describe('prewarmDaemon', () => {
  test('以 daemon start 启动 detached 常驻进程并注入白名单 env', () => {
    const { calls, spawnFn } = fakeSpawn();
    const ok = prewarmDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: { CBM_CACHE_DIR: '/cache/root', HOME: '/root' },
      spawnFn,
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toEqual(['/bin/cbm', 'daemon', 'start']);
    expect(calls[0].options).toMatchObject({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { CBM_CACHE_DIR: '/cache/root', HOME: '/root' },
    });
  });

  test('spawn 抛异常时 fail-open 返回 false 不上抛', () => {
    const logs: string[] = [];
    const ok = prewarmDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: { CBM_CACHE_DIR: '/cache/root' },
      spawnFn: fakeSpawn({ throw: new Error('ENOENT') }).spawnFn,
      log: (msg) => logs.push(msg),
    });
    expect(ok).toBe(false);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('fail-open');
  });

  test('binaryPath 或 cacheRoot 缺失时跳过并记录', () => {
    const logs: string[] = [];
    const { calls, spawnFn } = fakeSpawn();
    const ok = prewarmDaemon({
      binaryPath: '',
      cacheRoot: '/cache/root',
      env: { CBM_CACHE_DIR: '/cache/root' },
      spawnFn,
      log: (msg) => logs.push(msg),
    });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(logs[0]).toContain('跳过');
  });
});
