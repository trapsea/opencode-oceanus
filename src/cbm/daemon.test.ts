import { describe, expect, test } from 'bun:test';
import {
  DAEMON_READY_TIMEOUT_MS,
  ensurePermanentDaemon,
  healUnacceptableDaemon,
  probeDaemonAccept,
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

/** 序列式 fake spawn：按调用次序返回不同行为；耗尽后复用最后一个。 */
function sequenceSpawn(steps: Array<{ code?: number | null; output?: string; error?: string }>): {
  calls: Array<{ command: string[] }>;
  spawnFn: DaemonSpawnFn;
} {
  const calls: Array<{ command: string[] }> = [];
  let i = 0;
  const spawnFn: DaemonSpawnFn = (command) => {
    calls.push({ command });
    const step = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    const proc: DaemonSpawnProc = {
      exited: Promise.resolve(step.code ?? 0),
      kill: () => {},
      readOutput: () => step.output ?? '',
      readError: () => step.error,
    };
    return proc;
  };
  return { calls, spawnFn };
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

  test('characterization：不传 upgradeSessionManaged 时 already-session 不升级（现状基线）', async () => {
    const { calls, spawnFn } = sequenceSpawn([
      { output: 'daemon: already active (session-managed, pid 9)', code: 0 },
    ]);
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      spawnFn,
    });
    expect(r.status).toBe('ready');
    expect(r.mode).toBe('already-session');
    expect(r.upgraded).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test('upgradeSessionManaged：already-session → stop 成功 → start 建立 permanent', async () => {
    const { calls, spawnFn } = sequenceSpawn([
      { output: 'daemon: already active (session-managed, pid 9)', code: 0 },
      { output: 'daemon: stopped', code: 0 },
      { output: 'daemon: started (permanent, pid 10)', code: 0 },
    ]);
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      upgradeSessionManaged: true,
      spawnFn,
    });
    expect(r.status).toBe('ready');
    expect(r.mode).toBe('started');
    expect(r.upgraded).toBe(true);
    expect(calls.map((c) => c.command)).toEqual([
      ['/bin/cbm', 'daemon', 'start'],
      ['/bin/cbm', 'daemon', 'stop'],
      ['/bin/cbm', 'daemon', 'start'],
    ]);
  });

  test('upgradeSessionManaged：stop 被拒（committed client）→ 保持 already-session 不升级', async () => {
    const { calls, spawnFn } = sequenceSpawn([
      { output: 'daemon: already active (session-managed, pid 9)', code: 0 },
      { output: '2 committed client(s) still use it.', code: 1 },
    ]);
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      upgradeSessionManaged: true,
      spawnFn,
    });
    expect(r.status).toBe('ready');
    expect(r.mode).toBe('already-session');
    expect(r.upgraded).toBeFalsy();
    expect(calls).toHaveLength(2);
    expect(r.detail).toContain('upgrade skipped');
  });

  test('upgradeSessionManaged：stop 成功但再 start 非 0 → failed（fail-open）', async () => {
    const { spawnFn } = sequenceSpawn([
      { output: 'daemon: already active (session-managed, pid 9)', code: 0 },
      { output: 'daemon: stopped', code: 0 },
      { output: 'could not start after stop', code: 1 },
    ]);
    const r = await ensurePermanentDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/cache/root',
      env: {},
      upgradeSessionManaged: true,
      spawnFn,
    });
    expect(r.status).toBe('failed');
    expect(r.detail).toContain('could not start after stop');
  });

  test('upgradeSessionManaged：started/already-permanent 形态不触发升级序列', async () => {
    for (const output of [
      'daemon: started (permanent, pid 42)',
      'daemon: already active (permanent, pid 7)',
    ]) {
      const { calls, spawnFn } = sequenceSpawn([{ output, code: 0 }]);
      const r = await ensurePermanentDaemon({
        binaryPath: '/bin/cbm',
        cacheRoot: '/cache/root',
        env: {},
        upgradeSessionManaged: true,
        spawnFn,
      });
      expect(r.status).toBe('ready');
      expect(r.upgraded).toBeFalsy();
      expect(calls).toHaveLength(1);
    }
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

/** probe/heal 可控 fake：daemon 子命令按序返回；裸二进制 probe 按 probeOk 行为。 */
function healthSpawn(steps: {
  stop?: { code: number; output: string };
  start?: { code: number; output: string };
  status?: string;
  probeOk: boolean;
  probeDelayMs?: number;
}): { calls: Array<{ command: string[] }>; spawnFn: DaemonSpawnFn; killedPids: number[] } {
  const calls: Array<{ command: string[] }> = [];
  const killedPids: number[] = [];
  const spawnFn: DaemonSpawnFn = (command) => {
    calls.push({ command });
    if (command.length === 1) {
      // 裸二进制 = probe 的 stdio client。
      let output = '';
      const proc: DaemonSpawnProc = {
        exited: new Promise((resolve) => setTimeout(() => resolve(0), 10_000)),
        kill: () => {},
        readOutput: () => output,
        readError: () => undefined,
        write: (data) => {
          if (steps.probeOk) {
            setTimeout(
              () => (output += JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'cbm' } } })),
              steps.probeDelayMs ?? 0,
            );
          }
          void data;
        },
      };
      return proc;
    }
    if (command[1] === 'daemon' && command[2] === 'stop') {
      const s = steps.stop ?? { code: 0, output: 'daemon: stopped' };
      return {
        exited: Promise.resolve(s.code),
        kill: () => {},
        readOutput: () => s.output,
        readError: () => undefined,
      };
    }
    if (command[1] === 'daemon' && command[2] === 'status') {
      return {
        exited: Promise.resolve(0),
        kill: () => {},
        readOutput: () => steps.status ?? 'daemon: active (permanent)\n  pid: 99999',
        readError: () => undefined,
      };
    }
    const s = steps.start ?? { code: 0, output: 'daemon: started (permanent, pid 1)' };
    return {
      exited: Promise.resolve(s.code),
      kill: () => {},
      readOutput: () => s.output,
      readError: () => undefined,
    };
  };
  void killedPids;
  return { calls, spawnFn, killedPids };
}

describe('probeDaemonAccept', () => {
  test('健康 daemon：initialize 响应含 serverInfo → ok', async () => {
    const { spawnFn } = healthSpawn({ probeOk: true });
    const r = await probeDaemonAccept({ binaryPath: '/bin/cbm', cacheRoot: '/c', env: {}, spawnFn, probeTimeoutMs: 2_000 });
    expect(r.ok).toBe(true);
  });

  test('坏死 daemon：无响应 → 超时 false', async () => {
    const { spawnFn } = healthSpawn({ probeOk: false });
    const r = await probeDaemonAccept({ binaryPath: '/bin/cbm', cacheRoot: '/c', env: {}, spawnFn, probeTimeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('not accepting');
  });
});

describe('healUnacceptableDaemon', () => {
  test('stop 成功 → 重建 → probe 通过', async () => {
    // start 第一次是坏 daemon 时代的幂等（heal 不调 start 前置）；heal 内：stop → start → probe
    const hs = healthSpawn({ stop: { code: 0, output: 'daemon: stopped' }, probeOk: true });
    const r = await healUnacceptableDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/c',
      env: {},
      spawnFn: hs.spawnFn,
      probeFailedDetail: 'probe timed out',
      timeoutMs: 1_000,
    });
    expect(r.ok).toBe(true);
    expect(r.actions).toEqual(['probe-failed:probe timed out', 'stop-ok', 'rebuild-started', 'probe-ok-after-heal']);
    expect(hs.calls.filter((c) => c.command.length > 1).map((c) => c.command.slice(1))).toEqual([['daemon', 'stop'], ['daemon', 'start']]);
  });

  test('stop 被拒 → status 解析 pid → SIGKILL → 重建 → probe 通过', async () => {
    const hs = healthSpawn({
      stop: { code: 1, output: '1 committed client(s) still use it.' },
      status: 'daemon: active (permanent)\n  pid: 424242',
      probeOk: true,
    });
    const killed: number[] = [];
    const r = await healUnacceptableDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/c',
      env: {},
      spawnFn: hs.spawnFn,
      probeFailedDetail: 'probe timed out',
      timeoutMs: 1_000,
      killProcess: (pid) => killed.push(pid),
    });
    expect(r.ok).toBe(true);
    expect(killed).toEqual([424242]);
    expect(r.actions).toEqual([
      'probe-failed:probe timed out',
      'stop-rejected',
      'killed-pid-424242',
      'rebuild-started',
      'probe-ok-after-heal',
    ]);
    expect(hs.calls.filter((c) => c.command.length > 1).map((c) => c.command.slice(1))).toEqual([['daemon', 'stop'], ['daemon', 'status'], ['daemon', 'start']]);
  });

  test('stop 被拒且 status 无 pid → ok:false fail-open', async () => {
    const hs = healthSpawn({
      stop: { code: 1, output: 'committed clients' },
      status: 'daemon: not running',
      probeOk: true,
    });
    const r = await healUnacceptableDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/c',
      env: {},
      spawnFn: hs.spawnFn,
      probeFailedDetail: 'probe timed out',
      timeoutMs: 1_000,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('cannot resolve daemon pid');
  });

  test('未传 probeFailedDetail 且 probe 健康 → 无需自愈', async () => {
    const hs = healthSpawn({ probeOk: true });
    const r = await healUnacceptableDaemon({
      binaryPath: '/bin/cbm',
      cacheRoot: '/c',
      env: {},
      spawnFn: hs.spawnFn,
      probeTimeoutMs: 2_000,
    });
    expect(r.ok).toBe(true);
    expect(r.actions).toEqual(['probe-ok-no-heal-needed']);
  });
});
