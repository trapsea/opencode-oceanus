import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 二进制缓存路径解析。
 *
 * 本核心刻意**不**自动下载二进制：下载行为与网络、平台、权限强耦合，
 * 应交给上层（Wave 2 的工具接线或宿主运行时）按需实现。这里只负责
 * 给出缓存路径，并在缺失时提供清晰的诊断信息（见 cli.ts 的
 * `buildCliMissingMessage`）。
 */

export function getCacheDir(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA;
    const base = localAppData || join(homedir(), 'AppData', 'Local');
    return join(base, 'opencode-oceanus', 'ast-grep', 'bin');
  }
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache || join(homedir(), '.cache');
  return join(base, 'opencode-oceanus', 'ast-grep', 'bin');
}

export function getBinaryName(): string {
  return process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep';
}

export function getCachedBinaryPath(): string | null {
  const binaryPath = join(getCacheDir(), getBinaryName());
  return existsSync(binaryPath) ? binaryPath : null;
}
