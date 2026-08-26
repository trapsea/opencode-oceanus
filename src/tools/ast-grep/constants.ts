import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getCachedBinaryPath } from './downloader';

type Platform = 'darwin' | 'linux' | 'win32' | 'unsupported';

/** 合法二进制的最小体积，用于过滤占位/stub 文件。 */
export const MIN_BINARY_SIZE = 10_000;

/** 默认进程超时：300 秒。 */
export const DEFAULT_TIMEOUT_MS = 300_000;
/** 默认输出字节上限：1 MB。 */
export const DEFAULT_MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
/** 默认最大返回匹配数。 */
export const DEFAULT_MAX_MATCHES = 500;

export const LANG_EXTENSIONS: Record<string, string[]> = {
  bash: ['.bash', '.sh', '.zsh', '.bats'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.h'],
  csharp: ['.cs'],
  css: ['.css'],
  elixir: ['.ex', '.exs'],
  go: ['.go'],
  haskell: ['.hs', '.lhs'],
  html: ['.html', '.htm'],
  java: ['.java'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  json: ['.json'],
  kotlin: ['.kt', '.kts'],
  lua: ['.lua'],
  nix: ['.nix'],
  php: ['.php'],
  python: ['.py', '.pyi'],
  ruby: ['.rb', '.rake'],
  rust: ['.rs'],
  scala: ['.scala', '.sc'],
  solidity: ['.sol'],
  swift: ['.swift'],
  typescript: ['.ts', '.cts', '.mts'],
  tsx: ['.tsx'],
  yaml: ['.yml', '.yaml'],
};

export interface EnvironmentCheckResult {
  cli: {
    available: boolean;
    path: string;
    error?: string;
  };
}

/**
 * 平台专属 @ast-grep/cli 包名。
 * 注意：这些包的二进制名是 `ast-grep`，而不是已弃用的 `sg` 包装器。
 */
function getPlatformPackageName(): string | null {
  const platform = process.platform as Platform;
  const arch = process.arch;
  const platformMap: Record<string, string> = {
    'darwin-arm64': '@ast-grep/cli-darwin-arm64',
    'darwin-x64': '@ast-grep/cli-darwin-x64',
    'linux-arm64': '@ast-grep/cli-linux-arm64-gnu',
    'linux-x64': '@ast-grep/cli-linux-x64-gnu',
    'win32-x64': '@ast-grep/cli-win32-x64-msvc',
    'win32-arm64': '@ast-grep/cli-win32-arm64-msvc',
    'win32-ia32': '@ast-grep/cli-win32-ia32-msvc',
  };
  return platformMap[`${platform}-${arch}`] ?? null;
}

function isValidBinary(filePath: string): boolean {
  try {
    return statSync(filePath).isFile() && statSync(filePath).size > MIN_BINARY_SIZE;
  } catch {
    return false;
  }
}

/** 版本探测函数：执行 `<filePath> --version` 并返回拼接输出；失败/无法运行返回 null。 */
export type VersionProbeFn = (filePath: string, timeoutMs: number) => string | null;

/** 默认版本探测：同步 spawn，带短超时；跨平台 spawn 错误安全返回 null。 */
const defaultProbe: VersionProbeFn = (filePath, timeoutMs) => {
  try {
    const res = spawnSync(filePath, ['--version'], {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (res.error) return null;
    return `${res.stdout ?? ''}${res.stderr ?? ''}`;
  } catch {
    return null;
  }
};

/** `--version` 验证使用的短超时，避免误判的伪二进制（如 GNU sg/newgrp）挂起。 */
export const VERSION_CHECK_TIMEOUT_MS = 5_000;

/**
 * 版本输出是否明确标识 ast-grep。
 * 用于拒绝 GNU `sg`（newgrp）、以及任何其它同名但非 ast-grep 的程序。
 */
export function isAstGrepVersionOutput(output: string): boolean {
  return /ast-grep/i.test(output);
}

export interface VersionCheckOptions {
  /** `--version` 超时（毫秒）。 */
  timeoutMs?: number;
  /** 可注入的版本探测函数，便于测试。 */
  probe?: VersionProbeFn;
}

/**
 * 轻量验证候选二进制确为 ast-grep：执行 `--version` 且输出须明确包含 `ast-grep`。
 * 任何失败（spawn 错误、超时、输出不含 ast-grep）都返回 false，绝不抛出。
 */
export function verifyAstGrepBinary(
  filePath: string,
  options: VersionCheckOptions = {},
): boolean {
  const { timeoutMs = VERSION_CHECK_TIMEOUT_MS, probe = defaultProbe } = options;
  const output = probe(filePath, timeoutMs);
  return output !== null && isAstGrepVersionOutput(output);
}

/** 生成候选判定函数：先过体积/文件校验，再执行 `--version` 验证。 */
function makeVerifier(options: VersionCheckOptions): (filePath: string) => boolean {
  const { timeoutMs = VERSION_CHECK_TIMEOUT_MS, probe = defaultProbe } = options;
  return (filePath) =>
    isValidBinary(filePath) &&
    verifyAstGrepBinary(filePath, { timeoutMs, probe });
}

const binaryNames = () =>
  process.platform === 'win32'
    ? ['ast-grep.exe', 'sg.exe']
    : ['ast-grep', 'sg'];

/** 在 PATH 上查找第一个通过体积与 `--version` 验证的可执行二进制。优先 ast-grep 名称。 */
function findOnPath(verify: (filePath: string) => boolean): string | null {
  const pathEnv = process.env.PATH ?? '';
  const pathExt = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const name of binaryNames()) {
      for (const ext of pathExt) {
        const candidate = join(dir, `${name}${ext}`);
        if (verify(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * 解析 ast-grep CLI 路径。优先级：
 *   1. `AST_GREP_BIN` 环境变量显式覆盖
 *   2. 缓存目录二进制
 *   3. `@ast-grep/cli` 包（优先 `ast-grep`，回退 `sg`）
 *   4. 平台专属包二进制
 *   5. PATH 上的 `ast-grep` / `sg`
 *
 * 每个候选在返回前都会执行轻量 `--version` 验证（见 `verifyAstGrepBinary`），
 * 以拒绝 GNU `sg`（newgrp）等同名但非 ast-grep 的程序；验证失败的候选会被
 * 跳过并继续搜索下一个，而不是过早返回。不自动下载、不改变安装策略。
 *
 * 返回值 `null` 表示完全未找到可用的 ast-grep。
 */
export function findSgCliPathSync(options: VersionCheckOptions = {}): string | null {
  const verify = makeVerifier(options);

  const override = process.env.AST_GREP_BIN;
  if (override && verify(override)) return override;

  const cachedPath = getCachedBinaryPath();
  if (cachedPath && verify(cachedPath)) return cachedPath;

  try {
    const require = createRequire(import.meta.url);
    const cliPkgPath = require.resolve('@ast-grep/cli/package.json');
    const cliDir = dirname(cliPkgPath);
    // 优先使用 ast-grep 二进制；sg 包装器在部分版本已弃用。
    for (const name of binaryNames()) {
      const candidate = join(cliDir, name);
      if (verify(candidate)) return candidate;
    }
  } catch {
    // @ast-grep/cli 未安装
  }

  const platformPkg = getPlatformPackageName();
  if (platformPkg) {
    try {
      const require = createRequire(import.meta.url);
      const pkgPath = require.resolve(`${platformPkg}/package.json`);
      const pkgDir = dirname(pkgPath);
      for (const name of binaryNames()) {
        const candidate = join(pkgDir, name);
        if (verify(candidate)) return candidate;
      }
    } catch {
      // 平台专属包未安装
    }
  }

  return findOnPath(verify);
}

// 已解析路径的单一事实来源，避免重复探测。
let resolvedCliPath: string | null = null;

export function getSgCliPath(): string {
  if (resolvedCliPath !== null) {
    return resolvedCliPath;
  }
  const syncPath = findSgCliPathSync();
  if (syncPath) {
    resolvedCliPath = syncPath;
    return syncPath;
  }
  return 'ast-grep';
}

export function setSgCliPath(path: string | null): void {
  resolvedCliPath = path;
}
