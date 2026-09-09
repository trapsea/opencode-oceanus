import { describe, expect, test } from 'bun:test';
import {
  DAEMON_READY_TIMEOUT_MS,
  ensurePermanentDaemon,
  type DaemonSpawnFn,
  type DaemonSpawnProc,
} from './daemon';

/** 可控 fake spawn：注入退出码/输出/错误，记录调用与 kill。 */
function fakeSpawn(behavior?: {
  code?: number | null;
  output?: string;
  error?: string;
  neverExit?: boolean;
  throw?: Error;
}): { calls: Array<{ command: string[]; options: unknown }>; spawnFn: DaemonSpawnFn; kills: number } {
  const calls: Array<{ command: string[]; options: unknown }> = [];
  let kills = 0;
  const spawnFn: DaemonSpawnFn = (command, options) => {
    calls.push({ command, options });
    if (behavior?.throw) throw behavior.throw;
    let resolveExit!: (code: number | null) => void;
    const proc: DaemonSpawnProc = {
      exited: behavior?.neverExit
        ? new Promise<number | null>((resolve) => {
            resolveExit = resolve;
          })
        : Promise.resolve(behavior?.code ?? 0),
      // kill 模拟真实进程：SIGKILL 后 close 触发 exited resolve。
      kill: () => {
        kills += 1;
        resolveExit?.(null);
      },
      readOutput: () => behavior?.output ?? '',
      readError: () => behavior?.error,
    };
    return proc;
  };
  return { calls, spawnFn, get kills() { return kills; } };
}

describe('ensurePermanentDaemon', () => {
  test('exit 0 + started 文案 → ready/started，命令与 env 正确', async () => {
    const { calls, spawnFn } = fakeSpawn({ output: 'daemon: started (permanent, pid 42)' });
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: { CBM_CACHE_DIR: '/cache/root', HOME: '/root' },
      spawnFn,
    });
    expect(r.status).toBe('ready');
    expect(r.mode).toBe('started');
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toEqual(['/bin/cbm', 'daemon', 'start']);
    expect(calls[0].options).toMatchObject({
      windowsHide: true,
      env: { CBM_CACHE_DIR: '/cache/root', HOME: '/root' },
    });
  });

  test('幂等命中 permanent 文案 → ready/already-permanent', async () => {
    const { spawnFn } = fakeSpawn({ output: 'daemon: already active (permanent, pid 7)' });
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn,
    });
    expect(r.status).toBe('ready');
    expect(r.mode).toBe('already-permanent');
  });

  test('no-op 命中 session-managed 文案 → ready/already-session', async () => {
    const { spawnFn } = fakeSpawn({
      output: 'daemon: already active (session-managed, pid 9) — it stops with its last session',
    });
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn,
    });
    expect(r.status).toBe('ready');
    expect(r.mode).toBe('already-session');
  });

  test('exit 非 0 → failed 且 detail 带进程输出', async () => {
    const logs: string[] = [];
    const { spawnFn } = fakeSpawn({
      code: 1,
      output: 'codebase-memory-mcp: could not start for some reason',
    });
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn,
      log: (msg) => logs.push(msg),
    });
    expect(r.status).toBe('failed');
    expect(r.detail).toContain('could not start');
    expect(logs.some((m) => m.includes('fail-open'))).toBe(true);
  });

  test('spawn 抛异常 → failed fail-open 不上抛', async () => {
    const { spawnFn } = fakeSpawn({ throw: new Error('ENOENT') });
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn,
    });
    expect(r.status).toBe('failed');
    expect(r.detail).toBe('ENOENT');
  });

  test('spawn 异步 error（如 ENOENT close）→ failed', async () => {
    const { spawnFn } = fakeSpawn({ error: 'spawn ENOENT' });
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn,
    });
    expect(r.status).toBe('failed');
    expect(r.detail).toBe('spawn ENOENT');
  });

  test('超过 timeoutMs 未退出 → kill 并返回 timeout', async () => {
    const fs = fakeSpawn({ neverExit: true });
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn: fs.spawnFn,
      timeoutMs: 50,
    });
    expect(r.status).toBe('timeout');
    expect(fs.kills).toBe(1);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(50);
  });

  test('binaryPath 或 cacheRoot 缺失 → skipped 不 spawn', async () => {
    const logs: string[] = [];
    const { calls, spawnFn } = fakeSpawn();
    const r = await ensurePermanentDaemon({
      binaryPath: '',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn,
      log: (msg) => logs.push(msg),
    });
    expect(r.status).toBe('skipped');
    expect(calls).toHaveLength(0);
    expect(logs[0]).toContain('跳过');
  });

  test('默认 timeoutMs 为 DAEMON_READY_TIMEOUT_MS', () => {
    expect(DAEMON_READY_TIMEOUT_MS).toBe(15_000);
  });
});

describe('ensurePermanentDaemon 真实 spawn（defaultSpawn）', () => {
  test('/bin/true 对 daemon start 参数 exit 0 → ready（真实管道语义）', async () => {
    if (process.platform === 'win32') return; // /bin/true 仅 Unix
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/true',
      cacheRoot: '/cache/root',
      env: { CBM_CACHE_DIR: '/cache/root' },
      timeoutMs: 10_000,
    });
    expect(r.status).toBe('ready');
    expect(r.elapsedMs).toBeLessThan(10_000);
  });

  test('不存在的二进制 → failed 且快速返回（不挂起，ENOENT error 路径）', async () => {
    const t0 = Date.now();
    const r = await ensurePermanentDaemon({
      binaryPath: '/definitely/not/exists-cbm-xyz',
      cacheRoot: '/cache/root',
      env: { CBM_CACHE_DIR: '/cache/root' },
      timeoutMs: 15_000,
    });
    expect(r.status).toBe('failed');
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});
