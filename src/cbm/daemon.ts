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
  /**
   * upgradeSessionManaged 触发的 stop→start 升级序列是否完整执行（exit 0）。
   * 语义边界：序列执行完成即 true，不保证最终形态为 permanent——第二次
   * start 在极小窗口内仍可能撞上其他客户端抢先拉起的 session-managed
   * daemon（此时 mode=already-session 如实反映形态）。
   */
  upgraded?: boolean;
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
  /** 向进程 stdin 写数据（probe 用）；无 stdin 的实现可缺省。 */
  write?: (data: string) => void;
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
  /**
   * `daemon start` 以 no-op 命中 session-managed daemon 时，尝试 stop→start
   * 升级为 permanent（0.10.8 实测：session-managed daemon 随最后一个
   * committed client 断开退出，宿主重连会反复落入冷启动竞态）。stop 被
   * committed client 拒绝（exit 1）时不强杀，保持 already-session 返回。
   * 默认 false 保持旧语义。
   */
  upgradeSessionManaged?: boolean;
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
    // stdin pipe：probeDaemonAccept 需要向 stdio MCP server 写 initialize 请求。
    stdio: ['pipe', 'pipe', 'pipe'],
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
    write: (data) => {
      try {
        child.stdin?.write(data);
      } catch {
        // 进程已退出等场景忽略。
      }
    },
  };
};

/** 单条 daemon 子命令的执行结果（主流程与升级序列共用）。 */
interface CommandOutcome {
  code: number | null;
  output: string;
  spawnError?: string;
  timedOut: boolean;
}

/** 执行一条 daemon 子命令：前台等待退出，超时 SIGKILL，收集输出；spawn 抛出转 spawnError。 */
async function runDaemonCommand(
  spawnFn: DaemonSpawnFn,
  command: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<CommandOutcome> {
  let proc: DaemonSpawnProc;
  try {
    proc = spawnFn(command, { windowsHide: true, env });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { code: null, output: msg, spawnError: msg, timedOut: false };
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
  return { code, output: proc.readOutput(), spawnError: proc.readError(), timedOut };
}

/** 从 daemon 命令输出判定就绪形态。 */
function detectMode(output: string): DaemonReadyMode | undefined {
  return output.includes('already active (permanent')
    ? 'already-permanent'
    : output.includes('already active (session-managed')
      ? 'already-session'
      : output.includes('started (permanent')
        ? 'started'
        : undefined;
}

/**
 * 前台等待 permanent daemon 就绪。同步可等待语义，不抛异常。
 *
 * - 参数缺失 → `skipped`；
 * - spawn 抛出/异步 error（如 ENOENT）→ `failed`；
 * - 超过 timeoutMs 未退出 → kill 后 `timeout`；
 * - exit 非 0 → `failed`（detail 带进程输出）；
 * - exit 0 → `ready`（mode 由输出文案判定）；
 * - `upgradeSessionManaged` 且命中 already-session：执行 stop→start 升级序列，
 *   stop 被拒（committed client）时保持 already-session 返回（不强杀）。
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

  const first = await runDaemonCommand(spawnFn, [binaryPath, 'daemon', 'start'], env, timeoutMs);

  if (first.timedOut) {
    log?.('[oceanus] CBM daemon 预热超时(fail-open)', {
      timeoutMs,
      elapsedMs: elapsedMs(),
      output: first.output.slice(0, 300),
    });
    return {
      status: 'timeout',
      elapsedMs: elapsedMs(),
      detail: first.output.slice(0, 300) || `timed out after ${timeoutMs}ms`,
    };
  }
  if (first.spawnError) {
    log?.('[oceanus] CBM daemon 预热失败(fail-open)', {
      error: first.spawnError,
      elapsedMs: elapsedMs(),
    });
    return { status: 'failed', elapsedMs: elapsedMs(), detail: first.spawnError };
  }
  if (first.code !== 0) {
    const detail = first.output.trim() || `daemon start exited ${first.code}`;
    log?.('[oceanus] CBM daemon 预热失败(fail-open)', {
      exitCode: first.code,
      elapsedMs: elapsedMs(),
      output: first.output.slice(0, 300),
    });
    return { status: 'failed', elapsedMs: elapsedMs(), detail: detail.slice(0, 300) };
  }

  let mode = detectMode(first.output);

  // 升级序列：session-managed daemon 随最后一个 committed client 断开退出，
  // 是宿主重连反复落入冷启动竞态的根因。stop 被拒时保持现状（不强杀）。
  if (mode === 'already-session' && options.upgradeSessionManaged) {
    const stop = await runDaemonCommand(spawnFn, [binaryPath, 'daemon', 'stop'], env, timeoutMs);
    if (stop.timedOut || stop.spawnError || stop.code !== 0) {
      const reason = stop.timedOut
        ? `daemon stop timed out after ${timeoutMs}ms`
        : (stop.spawnError ?? (stop.output.trim() || `exit ${stop.code}`));
      log?.('[oceanus] CBM daemon session→permanent 升级跳过（stop 被拒或失败）', {
        reason: reason.slice(0, 200),
        elapsedMs: elapsedMs(),
      });
      return {
        status: 'ready',
        mode,
        elapsedMs: elapsedMs(),
        detail: `upgrade skipped: daemon stop rejected (${reason.slice(0, 120)})`,
      };
    }
    const second = await runDaemonCommand(spawnFn, [binaryPath, 'daemon', 'start'], env, timeoutMs);
    if (second.timedOut) {
      log?.('[oceanus] CBM daemon 升级 start 超时(fail-open)', {
        timeoutMs,
        elapsedMs: elapsedMs(),
      });
      return {
        status: 'timeout',
        elapsedMs: elapsedMs(),
        detail: second.output.slice(0, 300) || `timed out after ${timeoutMs}ms`,
      };
    }
    if (second.spawnError) {
      log?.('[oceanus] CBM daemon 升级 start 失败(fail-open)', {
        error: second.spawnError,
        elapsedMs: elapsedMs(),
      });
      return { status: 'failed', elapsedMs: elapsedMs(), detail: second.spawnError };
    }
    if (second.code !== 0) {
      const detail = second.output.trim() || `daemon start exited ${second.code}`;
      log?.('[oceanus] CBM daemon 升级 start 失败(fail-open)', {
        exitCode: second.code,
        elapsedMs: elapsedMs(),
        output: second.output.slice(0, 300),
      });
      return { status: 'failed', elapsedMs: elapsedMs(), detail: detail.slice(0, 300) };
    }
    mode = detectMode(second.output) ?? 'started';
    log?.('[oceanus] CBM daemon 已升级为 permanent', { mode, elapsedMs: elapsedMs() });
    return {
      status: 'ready',
      mode,
      upgraded: true,
      elapsedMs: elapsedMs(),
      detail: second.output.slice(0, 200),
    };
  }

  log?.('[oceanus] CBM daemon 预热就绪', { mode, elapsedMs: elapsedMs() });
  return { status: 'ready', mode, elapsedMs: elapsedMs(), detail: first.output.slice(0, 200) };
}

/** accept 探测默认上限：健康 daemon 下 initialize 秒回，坏死时尽快失败。 */
export const DAEMON_PROBE_TIMEOUT_MS = 4_000;

export interface DaemonProbeResult {
  ok: boolean;
  elapsedMs: number;
  detail?: string;
}

/**
 * accept 级健康探测：以 stdio MCP client 身份真实握手一次。
 *
 * 背景（0.10.8 实测诊断）：daemon 可能进入「活着但不完成新 client admission」
 * 的坏死状态（client 卡在 admission 轮询、initialize 永不响应，宿主表现为
 * 30s+ `MCP error -32001`）。`daemon start` 对该状态幂等 exit 0（already
 * active），无法反映健康度——必须用真实握手探测。
 *
 * 实现：spawn 裸二进制 → stdin 写 initialize → 轮询输出含 `"serverInfo"`
 * （initialize 响应特征）→ 成功即 kill 收尾；超时 kill 返回 false。fail-open，
 * 任何 spawn 错误返回 false（由调用方决定是否自愈）。
 */
export async function probeDaemonAccept(
  options: EnsurePermanentDaemonOptions & { probeTimeoutMs?: number },
): Promise<DaemonProbeResult> {
  const { binaryPath, cacheRoot, env, spawnFn = defaultSpawn, log } = options;
  const probeTimeoutMs = options.probeTimeoutMs ?? DAEMON_PROBE_TIMEOUT_MS;
  const startedAt = Date.now();
  if (!binaryPath || !cacheRoot) {
    return { ok: false, elapsedMs: 0, detail: 'missing binaryPath/cacheRoot' };
  }
  let proc: DaemonSpawnProc;
  try {
    proc = spawnFn([binaryPath], { windowsHide: true, env });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, elapsedMs: Date.now() - startedAt, detail: msg };
  }
  const finish = (ok: boolean, detail?: string): DaemonProbeResult => {
    proc.kill();
    return { ok, elapsedMs: Date.now() - startedAt, detail };
  };
  try {
    proc.write?.(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'oceanus-daemon-probe', version: '1' },
        },
      })}\n`,
    );
  } catch {
    // write 失败不阻塞：继续等输出/超时。
  }
  const deadline = Date.now() + probeTimeoutMs;
  for (;;) {
    const output = proc.readOutput();
    if (output.includes('"serverInfo"')) {
      log?.('[oceanus] CBM daemon accept 探测通过', { elapsedMs: Date.now() - startedAt });
      return finish(true);
    }
    const spawnError = proc.readError();
    if (spawnError) return finish(false, spawnError);
    if (Date.now() >= deadline) {
      const d = `probe timed out after ${probeTimeoutMs}ms (daemon not accepting)`;
      log?.('[oceanus] CBM daemon accept 探测超时', { probeTimeoutMs, output: output.slice(0, 200) });
      return finish(false, d);
    }
    // 进程意外退出且无响应特征：等待其 exited resolve 或直接按输出判断。
    const winner = await Promise.race([
      proc.exited.then((c) => c as number | null),
      new Promise<'tick'>((r) => setTimeout(() => r('tick'), 100)),
    ]);
    if (winner !== 'tick') {
      const finalOutput = proc.readOutput();
      if (finalOutput.includes('"serverInfo"')) return finish(true);
      return finish(false, `probe process exited with ${winner}; no initialize response`);
    }
  }
}

export interface DaemonHealOptions extends EnsurePermanentDaemonOptions {
  /** 第一步探测结果（避免重复探测）；缺省内部先探测一次。 */
  probeFailedDetail?: string;
  /** 进程终止注入（测试用）；缺省 process.kill(pid, 'SIGKILL')。 */
  killProcess?: (pid: number) => void;
}

export interface DaemonHealResult {
  /** 自愈后 daemon 是否可 accept（最终探测通过）。 */
  ok: boolean;
  /** 采取的动作序列（诊断用）。 */
  actions: string[];
  detail?: string;
}

/**
 * 坏死 daemon 自愈：探测失败 → `daemon stop`（被拒则解析 pid 后 SIGKILL）→
 * `daemon start` 重建 permanent → 再探测。
 *
 * SIGKILL 的安全边界：仅在「accept 探测失败」双确认后执行——此时 daemon 对
 * 新连接已经坏死（新 client 无法完成 admission），kill 不会让事情更糟；已
 * committed 的旧 client 会断连并由宿主重连到健康 daemon。索引数据在磁盘，
 * daemon 仅持内存态。任何失败均 fail-open 返回，不抛异常。
 */
export async function healUnacceptableDaemon(options: DaemonHealOptions): Promise<DaemonHealResult> {
  const { binaryPath, cacheRoot, env, spawnFn = defaultSpawn, log } = options;
  const timeoutMs = options.timeoutMs ?? DAEMON_READY_TIMEOUT_MS;
  const killProcess =
    options.killProcess ??
    ((pid: number) => {
      process.kill(pid, 'SIGKILL');
    });
  const actions: string[] = [];
  const run = (cmd: string[]) => runDaemonCommand(spawnFn, cmd, env, timeoutMs);

  if (options.probeFailedDetail === undefined) {
    const probe = await probeDaemonAccept({ ...options });
    if (probe.ok) return { ok: true, actions: ['probe-ok-no-heal-needed'] };
    actions.push(`probe-failed:${(probe.detail ?? '').slice(0, 80)}`);
  } else {
    actions.push(`probe-failed:${options.probeFailedDetail.slice(0, 80)}`);
  }

  const stop = await run([binaryPath, 'daemon', 'stop']);
  if (stop.timedOut || stop.spawnError || stop.code !== 0) {
    // stop 被拒（committed client 占用）：解析 daemon status 输出中的 pid 后强杀。
    actions.push('stop-rejected');
    const status = await run([binaryPath, 'daemon', 'status']);
    const pidMatch = /pid:\s*(\d+)/.exec(status.output);
    if (!pidMatch) {
      log?.('[oceanus] CBM daemon 坏死自愈失败：无法解析 daemon pid', {
        statusOutput: status.output.slice(0, 200),
      });
      return { ok: false, actions, detail: 'cannot resolve daemon pid from status output' };
    }
    const pid = Number(pidMatch[1]);
    try {
      killProcess(pid);
      actions.push(`killed-pid-${pid}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, actions, detail: `kill ${pid} failed: ${msg}` };
    }
    // 等 socket 释放，避免新 daemon start 撞上残留 anchor。
    await new Promise((r) => setTimeout(r, 1_000));
  } else {
    actions.push('stop-ok');
  }

  const start = await run([binaryPath, 'daemon', 'start']);
  if (start.timedOut || start.spawnError || start.code !== 0) {
    log?.('[oceanus] CBM daemon 坏死自愈：重建 start 失败(fail-open)', {
      output: start.output.slice(0, 200),
    });
    return { ok: false, actions, detail: `rebuild start failed: ${start.output.slice(0, 120)}` };
  }
  actions.push('rebuild-started');
  const probe = await probeDaemonAccept({ ...options });
  if (probe.ok) {
    actions.push('probe-ok-after-heal');
    log?.('[oceanus] CBM daemon 坏死自愈完成（accept 恢复）', { actions });
  } else {
    actions.push('probe-still-failing');
    log?.('[oceanus] CBM daemon 坏死自愈后仍不可 accept(fail-open)', {
      detail: probe.detail,
      actions,
    });
  }
  return { ok: probe.ok, actions, detail: probe.detail };
}
