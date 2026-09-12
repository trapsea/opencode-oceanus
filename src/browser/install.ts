import { crossSpawn, type SpawnFn } from '../cbm/process';
import { detectAgentBrowser, type AgentBrowserDetectResult } from './detect';

/**
 * agent-browser 安装（agent-browser skill 能力层）。
 *
 * 确认门 fail-closed：没有 confirm 回调或 confirm 返回 false 一律拒绝安装
 * （Chrome for Testing 体积大、Linux 还需系统依赖，必须显式授权；
 * 插件配置 agentBrowser.autoInstall=true 视为用户显式授权，由调用方传入恒真 confirm）。
 *
 * 安装两段：npm install -g agent-browser[@version] → agent-browser install [--with-deps]。
 * 失败码与 CBM ProvisionErrorCode 同风格（结构化、可记日志、可降级）。
 */

export type BrowserInstallErrorCode =
  | 'user_declined'
  | 'npm_install_failed'
  | 'chrome_install_failed'
  | 'doctor_failed';

export class BrowserInstallError extends Error {
  constructor(
    public readonly code: BrowserInstallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserInstallError';
  }
}

export interface AgentBrowserInstallOptions {
  /** npm 安装时锁定的版本（缺省 latest）。 */
  version?: string;
  /** Linux 追加 --with-deps 安装浏览器系统依赖。 */
  withDeps?: boolean;
  /** 安装完成后执行 doctor 自检（默认 false）。 */
  runDoctor?: boolean;
  /**
   * 确认门：返回 true 才执行安装。未提供或返回 false 一律 user_declined。
   * 调用方负责把「config autoInstall=true」翻译成恒真 confirm。
   */
  confirm?: () => boolean | Promise<boolean>;
}

export interface AgentBrowserInstallDeps {
  /** 子进程执行器（默认 crossSpawn；测试注入 fake）。 */
  spawn?: SpawnFn;
}

export interface AgentBrowserInstallResult {
  /** 安装完成后重跑 --version 的结果（尽力而为，失败不推翻安装成功）。 */
  detect: AgentBrowserDetectResult;
}

/** 执行命令并要求退出码 0，否则抛带 stderr/stdout 摘要的错误。 */
async function runStrict(
  spawn: SpawnFn,
  command: string[],
  code: BrowserInstallErrorCode,
  what: string,
): Promise<string> {
  let proc;
  try {
    proc = spawn(command);
  } catch (error) {
    throw new BrowserInstallError(
      code,
      `${what} spawn 失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout(),
    proc.stderr(),
  ]);
  if (exitCode !== 0) {
    const output = (stderr || stdout).trim().slice(0, 500);
    throw new BrowserInstallError(code, `${what} 失败（exit ${exitCode}）: ${output}`);
  }
  return stdout.trim();
}

/**
 * 经确认门安装 agent-browser：
 * 1. 确认门（fail-closed）→ 2. npm install -g → 3. agent-browser install（Chrome）
 * → 4. 可选 doctor → 5. 重跑探测返回安装后状态。
 */
export async function installAgentBrowser(
  options: AgentBrowserInstallOptions = {},
  deps: AgentBrowserInstallDeps = {},
): Promise<AgentBrowserInstallResult> {
  const spawn = deps.spawn ?? crossSpawn;

  // 1. 确认门：fail-closed，缺省拒绝。
  const confirmed = options.confirm ? await options.confirm() : false;
  if (!confirmed) {
    throw new BrowserInstallError(
      'user_declined',
      '未获得安装确认（confirm 未提供或返回 false），拒绝安装 agent-browser',
    );
  }

  // 2. npm 安装 CLI 本体。
  const pkg = options.version
    ? `agent-browser@${options.version}`
    : 'agent-browser';
  await runStrict(
    spawn,
    ['npm', 'install', '-g', pkg],
    'npm_install_failed',
    `npm install -g ${pkg}`,
  );

  // 3. Chrome for Testing 下载（Linux 可选 --with-deps）。
  const installArgs = ['agent-browser', 'install'];
  if (options.withDeps) installArgs.push('--with-deps');
  await runStrict(
    spawn,
    installArgs,
    'chrome_install_failed',
    'agent-browser install',
  );

  // 4. 可选 doctor 自检：失败抛 doctor_failed（安装本身已成功，调用方可选择忽略）。
  if (options.runDoctor) {
    await runStrict(spawn, ['agent-browser', 'doctor', '--json'], 'doctor_failed', 'agent-browser doctor');
  }

  // 5. 安装后状态（detect 不反向依赖本模块，静态引用即可）。
  const detect = await detectAgentBrowser({ spawn });
  return { detect };
}
