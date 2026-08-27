import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ProvisionOptions } from './provision';
import type { SpawnOptions } from './process';
import {
  CbmUiError,
  UI_OWNER,
  getUiStatus,
  startUi,
  stopUi,
  type UiSpawnFn,
} from './ui';

/**
 * CBM-07：使用已安装 canonical 二进制的按需 Web UI 生命周期。
 *
 * 覆盖：默认不启动、启动成功（--ui=true --port）、端口冲突诊断、未安装、
 * 重复启动复用、异常退出状态回收、stop 只停自己持有的 PID、open 非阻塞可选。
 * 全程 mock spawn，不启动真实浏览器、不访问网络。
 */

const roots: string[] = [];
function newRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'cbm-ui-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots.length = 0;
});

function markerPath(root: string): string {
  return join(root, 'ui.json');
}
function writeMarker(root: string, m: unknown): void {
  writeFileSync(markerPath(root), JSON.stringify(m));
}
function baseMarker(pid: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner: UI_OWNER,
    pid,
    host: '127.0.0.1',
    port: 9749,
    url: `http://127.0.0.1:${9749}`,
    startedAt: 1,
    ...extra,
  };
}

interface SpawnCall {
  cmd: string[];
  options?: SpawnOptions;
}
interface FakeSpawn {
  spawn: UiSpawnFn;
  calls: SpawnCall[];
  killed: () => boolean;
}
/** exit=null → 进程保持存活（永不退出）；否则在 spawn 后立即按 code 退出。 */
function fakeSpawn(opts: {
  pid?: number;
  exit?: { code: number; stderr?: string } | null;
} = {}): FakeSpawn {
  const calls: SpawnCall[] = [];
  let killed = false;
  const spawn: UiSpawnFn = (cmd, options) => {
    calls.push({ cmd, options });
    const exit = opts.exit;
    const exited = exit ? Promise.resolve(exit.code) : new Promise<number>(() => {});
    return {
      pid: opts.pid ?? 4242,
      stdout: async () => '',
      stderr: async () => exit?.stderr ?? '',
      exited,
      kill: () => {
        killed = true;
        return true;
      },
      get exitCode() {
        return exit?.code ?? null;
      },
    };
  };
  return { spawn, calls, killed: () => killed };
}

function fakeEnsure(bin: string | null) {
  return async (_opts: ProvisionOptions): Promise<string | null> => bin;
}

describe('CBM-07 默认不启动', () => {
  test('冲突 ensureInstalled cacheRoot 不覆盖 UI 共享根', async () => {
    const root = newRoot();
    const seen: string[] = [];
    const { spawn } = fakeSpawn({ pid: 778 });
    await startUi({ cacheRoot: root, spawn, ensureInstalled: async (opts) => { seen.push(opts.cacheRoot ?? ''); return '/bin'; }, startGraceMs: 10 });
    expect(seen).toEqual([root]);
  });
  test('无 marker 时 status 为空闲，不 spawn 任何进程', () => {
    const root = newRoot();
    const { spawn, calls } = fakeSpawn();
    const st = getUiStatus({ cacheRoot: root, spawn });
    expect(st.running).toBe(false);
    expect(st.pid).toBeNull();
    expect(st.url).toBeNull();
    expect(calls.length).toBe(0);
  });
});

describe('CBM-07 启动成功', () => {
  test('用 installed 二进制以 --ui=true --port 启动并记录 owner marker/PID', async () => {
    const root = newRoot();
    const { spawn, calls } = fakeSpawn({ pid: 777 });
    let openedUrl: string | null = null;
    const st = await startUi({
      cacheRoot: root,
      spawn,
      ensureInstalled: fakeEnsure('/fake/bin'),
      isPidAlive: () => true,
      startGraceMs: 10,
      open: (u) => {
        openedUrl = u;
      },
    });

    expect(st.running).toBe(true);
    expect(st.pid).toBe(777);
    expect(st.host).toBe('127.0.0.1');
    expect(st.port).toBe(9749);
    expect(st.url).toBe('http://127.0.0.1:9749');
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toEqual(['/fake/bin', '--ui=true', '--port=9749']);
    // open 拿到 URL
    expect(openedUrl).toBe('http://127.0.0.1:9749');
    // owner marker 已写盘
    const marker = JSON.parse(readFileSync(markerPath(root), 'utf8')) as Record<string, unknown>;
    expect(marker.pid).toBe(777);
    expect(marker.owner).toBe(UI_OWNER);
    expect(marker.port).toBe(9749);
  });

  test('自定义端口：--port 与 URL 使用配置值', async () => {
    const root = newRoot();
    const { spawn, calls } = fakeSpawn({ pid: 3 });
    const st = await startUi({
      cacheRoot: root,
      port: 9999,
      spawn,
      ensureInstalled: fakeEnsure('/bin'),
      startGraceMs: 10,
    });
    expect(calls[0].cmd).toEqual(['/bin', '--ui=true', '--port=9999']);
    expect(st.port).toBe(9999);
    expect(st.url).toBe('http://127.0.0.1:9999');
  });
});

describe('CBM-07 端口冲突', () => {
  test('进程快速退出且 stderr 为 EADDRINUSE：抛 port_in_use、不写 marker、不 open', async () => {
    const root = newRoot();
    const { spawn, calls } = fakeSpawn({
      pid: 555,
      exit: { code: 1, stderr: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:9749' },
    });
    let opened = false;
    let err: CbmUiError | undefined;
    try {
      await startUi({
        cacheRoot: root,
        spawn,
        ensureInstalled: fakeEnsure('/bin'),
        startGraceMs: 10,
        open: () => {
          opened = true;
        },
      });
    } catch (e) {
      err = e as CbmUiError;
    }
    expect(err).toBeInstanceOf(CbmUiError);
    expect(err?.code).toBe('port_in_use');
    expect(opened).toBe(false);
    expect(existsSync(markerPath(root))).toBe(false);
    expect(calls.length).toBe(1);
  });

  test('进程快速退出且非端口占用：抛 spawn_failed', async () => {
    const root = newRoot();
    const { spawn } = fakeSpawn({ pid: 5, exit: { code: 2, stderr: 'boom' } });
    let err: CbmUiError | undefined;
    try {
      await startUi({
        cacheRoot: root,
        spawn,
        ensureInstalled: fakeEnsure('/bin'),
        startGraceMs: 10,
      });
    } catch (e) {
      err = e as CbmUiError;
    }
    expect(err).toBeInstanceOf(CbmUiError);
    expect(err?.code).toBe('spawn_failed');
    expect(existsSync(markerPath(root))).toBe(false);
  });
});

describe('CBM-07 未安装', () => {
  test('ensureInstalled 返回 null：抛 not_installed、不 spawn', async () => {
    const root = newRoot();
    const { spawn, calls } = fakeSpawn();
    let err: CbmUiError | undefined;
    try {
      await startUi({
        cacheRoot: root,
        spawn,
        ensureInstalled: fakeEnsure(null),
        startGraceMs: 10,
      });
    } catch (e) {
      err = e as CbmUiError;
    }
    expect(err).toBeInstanceOf(CbmUiError);
    expect(err?.code).toBe('not_installed');
    expect(calls.length).toBe(0);
  });
});

describe('CBM-07 重复启动复用', () => {
  test('已在运行：再次 start 复用现有 PID，不重复 spawn', async () => {
    const root = newRoot();
    const { spawn, calls } = fakeSpawn({ pid: 888 });
    const first = await startUi({
      cacheRoot: root,
      spawn,
      ensureInstalled: fakeEnsure('/bin'),
      isPidAlive: () => true,
      startGraceMs: 10,
    });
    expect(calls.length).toBe(1);

    const second = await startUi({
      cacheRoot: root,
      spawn,
      ensureInstalled: fakeEnsure('/bin'),
      isPidAlive: () => true,
      startGraceMs: 10,
    });
    expect(calls.length).toBe(1); // 未重复 spawn
    expect(second.running).toBe(true);
    expect(second.pid).toBe(888);
    expect(second.url).toBe(first.url);
  });
});

describe('CBM-07 异常退出状态回收', () => {
  test('status 发现 marker PID 已死：回收 marker 并报告空闲', () => {
    const root = newRoot();
    writeMarker(root, baseMarker(999));
    const st = getUiStatus({ cacheRoot: root, isPidAlive: () => false });
    expect(st.running).toBe(false);
    expect(existsSync(markerPath(root))).toBe(false);
  });

  test('start 前发现陈旧 marker：回收后重新启动', async () => {
    const root = newRoot();
    writeMarker(root, baseMarker(999));
    const { spawn, calls } = fakeSpawn({ pid: 1001 });
    const st = await startUi({
      cacheRoot: root,
      spawn,
      ensureInstalled: fakeEnsure('/bin'),
      isPidAlive: (pid) => pid === 1001,
      startGraceMs: 10,
    });
    expect(calls.length).toBe(1);
    expect(st.pid).toBe(1001);
    expect(st.running).toBe(true);
  });
});

describe('CBM-07 stop 只停自己持有的进程', () => {
  test('owner 是本插件且 PID 存活：kill 并移除 marker', () => {
    const root = newRoot();
    writeMarker(root, baseMarker(123));
    const killed: number[] = [];
    const st = stopUi({
      cacheRoot: root,
      isPidAlive: () => true,
      killPid: (p) => killed.push(p),
    });
    expect(killed).toEqual([123]);
    expect(st.running).toBe(false);
    expect(existsSync(markerPath(root))).toBe(false);
  });

  test('owner 非本插件：不 kill、不移除 marker', () => {
    const root = newRoot();
    writeMarker(root, baseMarker(456, { owner: 'someone-else' }));
    const killed: number[] = [];
    const st = stopUi({
      cacheRoot: root,
      isPidAlive: () => true,
      killPid: (p) => killed.push(p),
    });
    expect(killed).toEqual([]);
    expect(st.running).toBe(false);
    expect(existsSync(markerPath(root))).toBe(true); // 不删除他人的 marker
  });

  test('无 marker：不 kill', () => {
    const root = newRoot();
    const killed: number[] = [];
    const st = stopUi({
      cacheRoot: root,
      isPidAlive: () => true,
      killPid: (p) => killed.push(p),
    });
    expect(killed).toEqual([]);
    expect(st.running).toBe(false);
  });

  test('owner 是本插件但 PID 已死：不 kill、回收 marker', () => {
    const root = newRoot();
    writeMarker(root, baseMarker(123));
    const killed: number[] = [];
    const st = stopUi({
      cacheRoot: root,
      isPidAlive: () => false,
      killPid: (p) => killed.push(p),
    });
    expect(killed).toEqual([]);
    expect(existsSync(markerPath(root))).toBe(false);
    expect(st.running).toBe(false);
  });
});

describe('CBM-07 open 可选且非阻塞', () => {
  test('open 抛异常不影响启动成功', async () => {
    const root = newRoot();
    const { spawn } = fakeSpawn({ pid: 1 });
    const st = await startUi({
      cacheRoot: root,
      spawn,
      ensureInstalled: fakeEnsure('/bin'),
      startGraceMs: 10,
      open: () => {
        throw new Error('browser boom');
      },
    });
    expect(st.running).toBe(true);
  });
});
