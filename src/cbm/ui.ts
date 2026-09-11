import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions as NodeSpawnOptions,
} from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_UI_HOST, DEFAULT_UI_PORT } from './constants';
import { getCacheRoot } from './paths';
import { ensureInstalled as defaultEnsureInstalled, type ProvisionOptions } from './provision';
import { type SpawnOptions, type SpawnProc } from './process';

/**
 * codebase-memory-mcp（CBM）Web UI 按需进程管理（CBM-07）。
 *
 * 使用已安装 canonical 二进制以 `--ui=true --port=<port>` 启动 UI，默认
 * `127.0.0.1:9749`；默认不启动。负责：端口冲突诊断、owner marker/PID 记录、
 * 只停止自己持有的进程、重复启动复用、异常退出状态回收，以及可选的 `open`
 * （非阻塞，失败不影响命令成功）。
 *
 * 复用 CBM-03/05 的 process/provision 抽象：`ensureInstalled` 与 UI 进程
 * `spawn` 均可注入，测试 mock spawn，不启动真实浏览器、不访问网络。
 * 进程参数数组、`shell: false`，绝不启用 shell 解析。
 */

export type UiErrorCode = 'not_installed' | 'port_in_use' | 'spawn_failed';

export class CbmUiError extends Error {
  constructor(
    public readonly code: UiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CbmUiError';
  }
}

/** 本插件写入 owner marker 的固定归属标识，用于避免误杀用户手动进程。 */
export const UI_OWNER = 'opencode-oceanus';

/** UI 进程状态。 */
export interface UiStatus {
  running: boolean;
  pid: number | null;
  host: string;
  port: number;
  url: string | null;
  startedAt: number | null;
  owner: string | null;
}

/** spawn 返回类型：在 {@link SpawnProc} 之上补充可记录的 pid。 */
export interface UiSpawnProc extends SpawnProc {
  pid: number;
}

export type UiSpawnFn = (command: string[], options?: SpawnOptions) => UiSpawnProc;

export interface UiOptions {
  /** 缓存根目录（兼作 owner marker 存放处），默认 {@link getCacheRoot}。 */
  cacheRoot?: string;
  host?: string;
  port?: number;
  /** 传给 ensureInstalled 的额外 provision 选项（download/manifest/spawn 等）。 */
  provision?: ProvisionOptions;
  /** UI 进程 spawn 注入。 */
  spawn?: UiSpawnFn;
  /** 安装注入。 */
  ensureInstalled?: (opts: ProvisionOptions) => Promise<string | null>;
  isPidAlive?: (pid: number) => boolean;
  killPid?: (pid: number) => void;
  /** 可选：拿到 URL 后的 open 行为（非阻塞）。 */
  open?: (url: string) => void;
  /** 启动宽限期：在此窗口内退出视为启动失败。 */
  startGraceMs?: number;
  now?: () => number;
}

interface UiMarker {
  owner: string;
  pid: number;
  host: string;
  port: number;
  url: string;
  startedAt: number;
}

interface UiIo {
  cacheRoot: string;
  host: string;
  port: number;
  provision: ProvisionOptions;
  spawn: UiSpawnFn;
  ensureInstalled: (opts: ProvisionOptions) => Promise<string | null>;
  isPidAlive: (pid: number) => boolean;
  killPid: (pid: number) => void;
  open: ((url: string) => void) | null;
  startGraceMs: number;
  now: () => number;
}

const DEFAULT_START_GRACE_MS = 1500;

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function defaultKillPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* 已退出或不存在 */
  }
}

function buildIo(options: UiOptions): UiIo {
  const cacheRoot = options.cacheRoot ?? getCacheRoot();
  const host = options.host ?? DEFAULT_UI_HOST;
  const port = options.port ?? DEFAULT_UI_PORT;
  return {
    cacheRoot,
    host,
    port,
    provision: options.provision ?? {},
    spawn: options.spawn ?? uiCrossSpawn,
    ensureInstalled: options.ensureInstalled ?? defaultEnsureInstalled,
    isPidAlive: options.isPidAlive ?? defaultIsPidAlive,
    killPid: options.killPid ?? defaultKillPid,
    open: options.open ?? null,
    startGraceMs: options.startGraceMs ?? DEFAULT_START_GRACE_MS,
    now: options.now ?? Date.now,
  };
}

/** 端口冲突诊断：启动窗口内退出且 stderr 命中 bind 占用。 */
const PORT_CONFLICT_PATTERN = /address already in use|EADDRINUSE|already in use|in use/i;
function isPortConflict(stderr: string): boolean {
  return PORT_CONFLICT_PATTERN.test(stderr);
}

function uiUrl(host: string, port: number): string {
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${h}:${port}`;
}

/* ------------------------------------------------------------------ */
/* owner marker（记录我们持有的 PID，只停自己、避免误杀用户进程）         */
/* ------------------------------------------------------------------ */

function markerPath(io: UiIo): string {
  return join(io.cacheRoot, 'ui.json');
}

function readMarker(io: UiIo): UiMarker | null {
  try {
    const p = markerPath(io);
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, 'utf8')) as Partial<UiMarker>;
    if (
      typeof data.pid !== 'number' ||
      typeof data.host !== 'string' ||
      typeof data.port !== 'number' ||
      typeof data.url !== 'string'
    ) {
      return null;
    }
    return {
      owner: data.owner ?? UI_OWNER,
      pid: data.pid,
      host: data.host,
      port: data.port,
      url: data.url,
      startedAt: data.startedAt ?? 0,
    };
  } catch {
    return null;
  }
}

function writeMarker(io: UiIo, marker: UiMarker): void {
  const p = markerPath(io);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(marker, null, 2));
  renameSync(tmp, p);
}

function removeMarker(io: UiIo): void {
  rmSync(markerPath(io), { force: true });
  rmSync(`${markerPath(io)}.tmp`, { force: true });
}

function statusFromMarker(marker: UiMarker): UiStatus {
  return {
    running: true,
    pid: marker.pid,
    host: marker.host,
    port: marker.port,
    url: marker.url,
    startedAt: marker.startedAt,
    owner: marker.owner,
  };
}

function idleStatus(io: UiIo): UiStatus {
  return {
    running: false,
    pid: null,
    host: io.host,
    port: io.port,
    url: null,
    startedAt: null,
    owner: null,
  };
}

/** 从 marker 推导状态；非本插件持有不回收；PID 已死则回收（异常退出回收）。 */
function statusFromMarkerFile(io: UiIo): UiStatus {
  const marker = readMarker(io);
  if (!marker) return idleStatus(io);
  if (marker.owner !== UI_OWNER) return idleStatus(io);
  if (!io.isPidAlive(marker.pid)) {
    removeMarker(io);
    return idleStatus(io);
  }
  return statusFromMarker(marker);
}

/* ------------------------------------------------------------------ */
/* UI 进程 spawn（跨 Bun/Node，参数数组 + shell:false）                  */
/* ------------------------------------------------------------------ */

function collectStream(stream: NodeJS.ReadableStream | null): () => Promise<string> {
  if (!stream) return () => Promise.resolve('');
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return () =>
    new Promise<string>((resolve, reject) => {
      if (!stream.readable) {
        resolve(Buffer.concat(chunks).toString('utf-8'));
        return;
      }
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    });
}

export function uiCrossSpawn(command: string[], options: SpawnOptions = {}): UiSpawnProc {
  const [file, ...args] = command;
  const spawnOptions: NodeSpawnOptions = {
    stdio: [
      options.stdin ?? 'ignore',
      options.stdout ?? 'pipe',
      options.stderr ?? 'pipe',
    ],
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv | undefined,
    shell: false,
    // Windows 上隐藏子进程控制台窗口（Node 默认 false 会闪弹 cmd 窗口）。
    windowsHide: true,
  };
  const child: ChildProcess = nodeSpawn(file, args, spawnOptions);
  return {
    pid: child.pid ?? 0,
    stdout: collectStream(child.stdout),
    stderr: collectStream(child.stderr),
    exited: new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    }),
    kill: (signal) => child.kill(signal as NodeJS.Signals),
    get exitCode() {
      return child.exitCode;
    },
  };
}

/** 子进程环境变量白名单：不继承 provider token，仅注入 CBM_CACHE_DIR 等。 */
const UI_ENV_WHITELIST: readonly string[] = [
  'CBM_CACHE_DIR',
  'NO_COLOR',
  'TERM',
  'HOME',
  'USER',
  'USERNAME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PATH',
  'XDG_CACHE_HOME',
  'LOCALAPPDATA',
  'APPDATA',
];

function buildUiEnv(cacheRoot: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of UI_ENV_WHITELIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CBM_CACHE_DIR = cacheRoot;
  return env;
}

/** 在启动宽限窗口内等待：持续存活视为启动成功；提前退出则返回退出信息。 */
async function waitForStart(
  io: UiIo,
  proc: UiSpawnProc,
): Promise<{ kind: 'running' } | { kind: 'exited'; code: number; stderr: string }> {
  const exitedP = proc.exited.then(
    async (code) => {
      let stderr = '';
      try {
        stderr = await proc.stderr();
      } catch {
        /* 忽略读取错误 */
      }
      return { kind: 'exited' as const, code, stderr };
    },
    (err: unknown) => ({
      kind: 'exited' as const,
      code: -1,
      stderr: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    }),
  );
  const timeoutP = new Promise<null>((resolve) => {
    const t = setTimeout(() => resolve(null), io.startGraceMs);
    if (typeof t.unref === 'function') t.unref();
  });
  const result = await Promise.race([exitedP, timeoutP]);
  if (result === null) return { kind: 'running' };
  return result;
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                             */
/* ------------------------------------------------------------------ */

/**
 * 按需启动 UI。已在运行则复用；返回最终 {@link UiStatus}。
 * 失败抛 {@link CbmUiError}（not_installed / port_in_use / spawn_failed）。
 */
export async function startUi(options: UiOptions = {}): Promise<UiStatus> {
  const io = buildIo(options);

  const existing = statusFromMarkerFile(io);
  if (existing.running) return existing;

  const bin = await io.ensureInstalled({
    ...io.provision,
    cacheRoot: io.provision.cacheRoot ?? io.cacheRoot,
  });
  if (!bin) {
    throw new CbmUiError('not_installed', 'CBM binary not installed; cannot start UI');
  }

  const url = uiUrl(io.host, io.port);
  const command = [bin, '--ui=true', `--port=${io.port}`];

  let proc: UiSpawnProc;
  try {
    proc = io.spawn(command, {
      stdout: 'ignore',
      stderr: 'pipe',
      env: buildUiEnv(io.cacheRoot),
    });
  } catch (e) {
    throw new CbmUiError('spawn_failed', `failed to spawn UI: ${(e as Error).message}`);
  }

  const outcome = await waitForStart(io, proc);
  if (outcome.kind === 'exited') {
    if (isPortConflict(outcome.stderr)) {
      throw new CbmUiError(
        'port_in_use',
        `UI port ${io.port} is already in use: ${outcome.stderr}`,
      );
    }
    throw new CbmUiError(
      'spawn_failed',
      `UI exited during startup (code ${outcome.code}): ${outcome.stderr}`,
    );
  }

  const marker: UiMarker = {
    owner: UI_OWNER,
    pid: proc.pid,
    host: io.host,
    port: io.port,
    url,
    startedAt: io.now(),
  };
  writeMarker(io, marker);

  if (io.open) {
    try {
      io.open(url);
    } catch {
      /* open 非阻塞：失败不影响启动成功 */
    }
  }

  return statusFromMarker(marker);
}

/** 只停止本插件持有的 UI 进程（owner 匹配且 PID 存活时 kill），并移除 marker。 */
export function stopUi(options: UiOptions = {}): UiStatus {
  const io = buildIo(options);
  const marker = readMarker(io);
  if (!marker) return idleStatus(io);
  if (marker.owner !== UI_OWNER) return idleStatus(io);
  if (io.isPidAlive(marker.pid)) {
    io.killPid(marker.pid);
  }
  removeMarker(io);
  return idleStatus(io);
}

/** 查询 UI 状态；若记录中的 PID 已退出则回收 marker（异常退出回收）。 */
export function getUiStatus(options: UiOptions = {}): UiStatus {
  return statusFromMarkerFile(buildIo(options));
}
