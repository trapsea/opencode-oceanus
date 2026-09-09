import { spawn as nodeSpawn } from 'node:child_process';

/**
 * CBM permanent daemon 前台等待式预热。
 *
 * 背景（0.10.8 实测诊断）：宿主重启后若 daemon 已退出，宿主 spawn 的 stdio
 * MCP server 与插件预热的 `daemon start` 会并行竞争拉起 daemon。旧实现
 * fire-and-forget（detached + stdio ignore + unref）不等待 daemon 就绪，MCP
 * reload 紧随其后，宿主 spawn 的首个 stdio MCP server 落在 daemon 冷启动窗口
 * 内：connect-or-start 等不到 accept 即退出（`Connection closed` ~2.4s），或对
 * 半启动 daemon 等满 30s（`Request timed out`）；且首个 stdio server 会抢先以
 * session-managed 模式拉起 daemon，使 `daemon start` 的 permanent 意图退化为
 * no-op，service 停止后 daemon 随最后客户端退出，下次冷启动重演。
 *
 * 0.10.8 实测语义：
 * - 无 daemon 时 `daemon start` 前台阻塞到 permanent daemon 就绪后打印
 *   `daemon: started (permanent, pid N)` 并 exit 0（返回即 accept-ready）；
 * - permanent 已存在：幂等打印 `daemon: already active (permanent, pid N)`
 *   exit 0；
 * - session-managed 已存在：no-op 打印 `already active (session-managed…)`
 *   exit 0（不升级为 permanent）。
 *
 * 因此本函数前台 spawn `daemon start` 并等待退出（exit 0 = daemon 已可服务）。
 * 调用方必须在宿主 MCP reload（spawn stdio server）之前 await 本函数，使所有
 * stdio 连接变为 connect-to-warm，消除首个连接失败。
 *
 * 任何失败/超时均 fail-open：返回结构化结果，绝不抛异常、绝不阻塞其它能力。
 */

/** daemon 就绪等待默认上限：冷启动实测 3-4s；慢机器/加载索引库预留余量。 */
export const DAEMON_READY_TIMEOUT_MS = 15_000;

/** 就绪形态：冷启动新建 / 幂等命中 permanent / no-op 命中 session-managed。 */
export type DaemonReadyMode = 'started' | 'already-permanent' | 'already-session';

export type DaemonWaitStatus = 'ready' | 'skipped' | 'timeout' | 'failed';

export interface DaemonWaitResult {
  status: DaemonWaitStatus;
  /** status=ready 时的 daemon 形态。 */
  mode?: DaemonReadyMode;
  elapsedMs: number;
  /** 可读详情：进程输出摘录或错误消息。 */
  detail?: string;
}

/** spawn 结果句柄：等待退出、超时 kill、读取已收集输出。 */
export interface DaemonSpawnProc {
  /** 进程退出（或 spawn error）时 resolve；超时 kill 后为 close code/null。 */
  exited: Promise<number | null>;
  kill: () => void;
  /** 进程 stdout+stderr 已收集文本（进程结束后可读）。 */
  readOutput: () => string;
  /** spawn 阶段错误（如 ENOENT）。 */
  readError: () => string | undefined;
}

export interface DaemonSpawnFn {
  (command: string[], options: { windowsHide: boolean; env: Record<string, string> }): DaemonSpawnProc;
}

export interface EnsurePermanentDaemonOptions {
  /** CBM 二进制绝对路径。 */
  binaryPath: string;
  /** 与其余 CBM 调用一致的 cache 根（daemon 单例 cache fingerprint 来源）。 */
  cacheRoot: string;
  /**
   * daemon 进程环境。由调用方构造（与 CLI/MCP 通道一致的白名单基础 +
   * `CBM_CACHE_DIR` 覆盖），避免常驻进程携带残缺环境。
   */
  env: Record<string, string>;
  /** 就绪等待上限；超时 kill 子进程并返回 timeout。默认 15s。 */
  timeoutMs?: number;
  /** 测试注入；默认 node child_process spawn。 */
  spawnFn?: DaemonSpawnFn;
  /** fail-open 日志；缺省静默。 */
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

const defaultSpawn: DaemonSpawnFn = (command, options) => {
  const child = nodeSpawn(command[0]!, command.slice(1), {
    windowsHide: true,
    env: options.env,
    // 前台执行：收集输出用于就绪形态判定与诊断，不 detached、不 unref。
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError: string | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', (err) => {
      spawnError = err.message;
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });
  const chunks: Buffer[] = [];
  child.stdout?.on('data', (d: Buffer) => chunks.push(d));
  child.stderr?.on('data', (d: Buffer) => chunks.push(d));
  return {
    exited,
    kill: () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 已退出等场景忽略。
      }
    },
    readOutput: () => Buffer.concat(chunks).toString('utf8'),
    readError: () => spawnError,
  };
};

/**
 * 前台等待 permanent daemon 就绪。同步可等待语义，不抛异常。
 *
 * - 参数缺失 → `skipped`；
 * - spawn 抛出/异步 error（如 ENOENT）→ `failed`；
 * - 超过 timeoutMs 未退出 → kill 后 `timeout`；
 * - exit 非 0 → `failed`（detail 带进程输出）；
 * - exit 0 → `ready`（mode 由输出文案判定）。
 */
export async function ensurePermanentDaemon(
  options: EnsurePermanentDaemonOptions,
): Promise<DaemonWaitResult> {
  const { binaryPath, cacheRoot, env, spawnFn = defaultSpawn, log } = options;
  const timeoutMs = options.timeoutMs ?? DAEMON_READY_TIMEOUT_MS;
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;

  if (!binaryPath || !cacheRoot) {
    log?.('[oceanus] CBM daemon 预热跳过：binaryPath/cacheRoot 缺失', { failOpen: true });
    return { status: 'skipped', elapsedMs: 0, detail: 'missing binaryPath/cacheRoot' };
  }

  let proc: DaemonSpawnProc;
  try {
    proc = spawnFn([binaryPath, 'daemon', 'start'], { windowsHide: true, env });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log?.('[oceanus] CBM daemon 预热 spawn 失败(fail-open)', {
      error: msg,
      elapsedMs: elapsedMs(),
    });
    return { status: 'failed', elapsedMs: elapsedMs(), detail: msg };
  }

  let timedOut = false;
  // 就绪等待必须不被「子进程已退出但 stdio 管道仍被常驻 daemon 持有」卡死：
  // 若 `close`（进程退出 + 流关闭）永不触发，race 的 timeout 分支保证返回。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<number | null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      resolve(null);
    }, timeoutMs);
  });
  const code = await Promise.race([proc.exited, timeoutP]);
  if (timer) clearTimeout(timer);
  const output = proc.readOutput();
  const spawnError = proc.readError();

  if (timedOut) {
    log?.('[oceanus] CBM daemon 预热超时(fail-open)', {
      timeoutMs,
      elapsedMs: elapsedMs(),
      output: output.slice(0, 300),
    });
    return {
      status: 'timeout',
      elapsedMs: elapsedMs(),
      detail: output.slice(0, 300) || `timed out after ${timeoutMs}ms`,
    };
  }
  if (spawnError) {
    log?.('[oceanus] CBM daemon 预热失败(fail-open)', {
      error: spawnError,
      elapsedMs: elapsedMs(),
    });
    return { status: 'failed', elapsedMs: elapsedMs(), detail: spawnError };
  }
  if (code !== 0) {
    const detail = output.trim() || `daemon start exited ${code}`;
    log?.('[oceanus] CBM daemon 预热失败(fail-open)', {
      exitCode: code,
      elapsedMs: elapsedMs(),
      output: output.slice(0, 300),
    });
    return { status: 'failed', elapsedMs: elapsedMs(), detail: detail.slice(0, 300) };
  }

  const mode: DaemonReadyMode | undefined = output.includes('already active (permanent')
    ? 'already-permanent'
    : output.includes('already active (session-managed')
      ? 'already-session'
      : output.includes('started (permanent')
        ? 'started'
        : undefined;
  log?.('[oceanus] CBM daemon 预热就绪', { mode, elapsedMs: elapsedMs() });
  return { status: 'ready', mode, elapsedMs: elapsedMs(), detail: output.slice(0, 200) };
}
