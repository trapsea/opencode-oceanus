import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { crossSpawn, type SpawnFn } from '../cbm/process';

/**
 * agent-browser 能力探测（browser-verify 能力层）。
 *
 * 三级探测顺序与 browser-verify skill 文案一致：PATH → 配置 binaryPath → npm global。
 * 每级以 `--version` 实际执行验证可用性（文件存在 ≠ 可执行）；可选 `doctor --json`
 * 健康检查失败不推翻 available，仅标记 doctorOk=false（fail-open）。
 *
 * 信任模型：探测只读不写、不安装；spawn 可注入，测试不触碰真实进程。
 */

/** 探测命中的来源。 */
export type AgentBrowserSource = 'path' | 'binary-path' | 'npm-global';

export interface AgentBrowserDetectResult {
  /** 三级探测是否命中（以 --version 实际执行成功为准）。 */
  available: boolean;
  /** 命中来源；available=false 时省略。 */
  source?: AgentBrowserSource;
  /** 实际可执行的二进制路径（npm-global 级尽力推导，供后续命令复用）。 */
  binaryPath?: string;
  /** `--version` 输出（trim 后）。 */
  version?: string;
  /** doctor 自检是否通过；未执行时省略。失败不推翻 available。 */
  doctorOk?: boolean;
  /** doctor 输出摘要（失败时保留供诊断）。 */
  doctorOutput?: string;
  /** 全部失败时的最后错误摘要。 */
  error?: string;
}

export interface AgentBrowserDetectDeps {
  /** 子进程执行器（默认 crossSpawn；测试注入 fake）。 */
  spawn?: SpawnFn;
  /** 配置显式指定的二进制绝对路径（探测第 2 级）。 */
  configuredBinaryPath?: string;
  /** 是否执行 doctor 健康检查（默认 false）。 */
  checkDoctor?: boolean;
  /** 平台（默认 process.platform，影响 npm global bin 路径推导）。 */
  platform?: NodeJS.Platform;
}

/** 执行 `<bin> --version`；成功返回 trim 后的版本串，失败返回 null。 */
async function runVersion(
  spawn: SpawnFn,
  bin: string,
): Promise<string | null> {
  try {
    const proc = spawn([bin, '--version']);
    const [code, stdout] = await Promise.all([proc.exited, proc.stdout()]);
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}

/** 执行 `npm prefix -g`，推导 npm global bin 中 agent-browser 的路径。 */
async function resolveNpmGlobalBin(
  spawn: SpawnFn,
  platform: NodeJS.Platform,
): Promise<string | null> {
  try {
    const proc = spawn(['npm', 'prefix', '-g']);
    const [code, stdout] = await Promise.all([proc.exited, proc.stdout()]);
    if (code !== 0) return null;
    const prefix = stdout.trim();
    if (!prefix) return null;
    return platform === 'win32'
      ? join(prefix, 'agent-browser.cmd')
      : join(prefix, 'bin', 'agent-browser');
  } catch {
    return null;
  }
}

/** 确认 npm global 中安装了 agent-browser（npm ls -g）。 */
async function npmGlobalHasAgentBrowser(
  spawn: SpawnFn,
): Promise<string | null> {
  try {
    const proc = spawn([
      'npm',
      'ls',
      '-g',
      'agent-browser',
      '--depth=0',
    ]);
    const [code, stdout] = await Promise.all([proc.exited, proc.stdout()]);
    if (code !== 0) return null;
    const match = /agent-browser@(\S+)/.exec(stdout);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** 可选 doctor 自检：失败不推翻 available，仅记录 doctorOk=false 与输出摘要。 */
async function runDoctor(
  spawn: SpawnFn,
  bin: string,
): Promise<{ doctorOk: boolean; doctorOutput?: string }> {
  try {
    const proc = spawn([bin, 'doctor', '--json']);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      proc.stdout(),
      proc.stderr(),
    ]);
    const output = (stdout || stderr).trim().slice(0, 500);
    return { doctorOk: code === 0, doctorOutput: output || undefined };
  } catch (error) {
    return {
      doctorOk: false,
      doctorOutput: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 三级探测 agent-browser：PATH → 配置 binaryPath → npm global（npm ls + prefix 推导）。
 * 命中且 checkDoctor 时追加 doctor 健康检查。全程只读，失败返回 available=false。
 */
export async function detectAgentBrowser(
  deps: AgentBrowserDetectDeps = {},
): Promise<AgentBrowserDetectResult> {
  const spawn = deps.spawn ?? crossSpawn;
  const platform = deps.platform ?? process.platform;
  const errors: string[] = [];

  // 1. PATH
  const pathVersion = await runVersion(spawn, 'agent-browser');
  if (pathVersion) {
    return finishDetect(spawn, 'agent-browser', {
      available: true,
      source: 'path',
      version: pathVersion,
    }, deps);
  }
  errors.push('PATH 无 agent-browser');

  // 2. 配置显式 binaryPath（文件存在才尝试执行）
  if (deps.configuredBinaryPath) {
    if (!existsSync(deps.configuredBinaryPath)) {
      errors.push(`binaryPath 不存在: ${deps.configuredBinaryPath}`);
    } else {
      const configuredVersion = await runVersion(spawn, deps.configuredBinaryPath);
      if (configuredVersion) {
        return finishDetect(spawn, deps.configuredBinaryPath, {
          available: true,
          source: 'binary-path',
          binaryPath: deps.configuredBinaryPath,
          version: configuredVersion,
        }, deps);
      }
      errors.push(`binaryPath 不可执行: ${deps.configuredBinaryPath}`);
    }
  }

  // 3. npm global：先确认包存在，再推导并验证实际 bin
  const npmVersion = await npmGlobalHasAgentBrowser(spawn);
  if (npmVersion) {
    const bin = await resolveNpmGlobalBin(spawn, platform);
    if (bin && existsSync(bin)) {
      const binVersion = await runVersion(spawn, bin);
      if (binVersion) {
        return finishDetect(spawn, bin, {
          available: true,
          source: 'npm-global',
          binaryPath: bin,
          version: binVersion,
        }, deps);
      }
      errors.push(`npm global bin 不可执行: ${bin}`);
    } else {
      errors.push('npm global 包存在但 bin 路径推导失败');
    }
  } else {
    errors.push('npm global 未安装 agent-browser');
  }

  return { available: false, error: errors.join('; ') };
}

/** 命中后按需追加 doctor 检查。 */
async function finishDetect(
  spawn: SpawnFn,
  bin: string,
  result: AgentBrowserDetectResult,
  deps: AgentBrowserDetectDeps,
): Promise<AgentBrowserDetectResult> {
  if (!deps.checkDoctor) return result;
  const doctor = await runDoctor(spawn, bin);
  return { ...result, ...doctor };
}
