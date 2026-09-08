import { spawn as nodeSpawn } from 'node:child_process';

/**
 * CBM daemon 常驻预热。
 *
 * 背景（0.10.8 实测诊断）：CLI 短命进程模式下 daemon 以「最后客户端断开即
 * 退出」的生命周期高频启停（日志 139 start / 126 stop），且长期运行后会进入
 * 「空闲但不再接受新客户端」的坏状态——新客户端等待 30s 后报
 * `CBM daemon is active or starting but could not accept this client within
 * 30000 ms` 并 exit 1。
 *
 * `codebase-memory-mcp daemon start` 启动常驻（permanent）daemon：
 * - 跨空闲期与会话存活，CLI 调用从 connect-or-start 变为 connect-to-warm
 *   （实测 30s 失败 / 3.4s 冷启动 → 1.1s 常驻命中）；
 * - 幂等：permanent daemon 已存在时由 CBM cohort 锁仲裁，重复调用无害。
 *
 * 本函数 fire-and-forget：detached + stdio ignore + unref，绝不阻塞插件
 * setup，任何失败（二进制缺失、spawn 异常）一律 fail-open 静默降级。
 */

export interface DaemonSpawnProc {
  unref: () => void;
}

export interface DaemonSpawnFn {
  (command: string[], options: {
    detached: boolean;
    stdio: 'ignore';
    windowsHide: boolean;
    env: Record<string, string>;
  }): DaemonSpawnProc;
}

const defaultSpawn: DaemonSpawnFn = (command, options) => {
  const child = nodeSpawn(command[0]!, command.slice(1), options);
  // 二进制缺失等异步 spawn 失败以 error 事件到达；预热是 fire-and-forget
  // 优化，必须吞掉该事件避免进程级 uncaught exception（fail-open 语义）。
  child.on('error', () => {});
  return { unref: () => child.unref() };
};

export interface PrewarmDaemonOptions {
  /** CBM 二进制绝对路径。 */
  binaryPath: string;
  /** 与其余 CBM 调用一致的 cache 根（决定 daemon 单例指纹）。 */
  cacheRoot: string;
  /**
   * daemon 进程环境。由调用方构造（与 CLI/MCP 通道一致的白名单基础 +
   * `CBM_CACHE_DIR` 覆盖），避免常驻进程携带残缺环境。
   */
  env: Record<string, string>;
  /** 测试注入；默认 node child_process spawn。 */
  spawnFn?: DaemonSpawnFn;
  /** fail-open 日志；缺省静默。 */
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/**
 * 启动常驻 daemon 预热。同步返回，不抛异常。
 *
 * 返回 true 表示 spawn 已发出（不代表 daemon 就绪）；false 表示跳过
 * （参数缺失）或失败（已记录 fail-open 日志）。
 */
export function prewarmDaemon(options: PrewarmDaemonOptions): boolean {
  const { binaryPath, cacheRoot, env, spawnFn = defaultSpawn, log } = options;
  if (!binaryPath || !cacheRoot) {
    log?.('[oceanus] CBM daemon 预热跳过：binaryPath/cacheRoot 缺失', { failOpen: true });
    return false;
  }
  try {
    const proc = spawnFn([binaryPath, 'daemon', 'start'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    proc.unref();
    return true;
  } catch (e) {
    log?.('[oceanus] CBM daemon 预热失败(fail-open)', {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
