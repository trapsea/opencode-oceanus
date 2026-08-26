import { homedir } from 'node:os';
import { join } from 'node:path';
import { CBM_CACHE_ROOT_NAME } from './constants';

/**
 * codebase-memory-mcp（CBM）缓存路径契约。
 *
 * 缓存按版本和平台隔离，目录树（与设计规格一致）：
 *
 *   <cache>/
 *   ├── versions/<version>/<platform>/codebase-memory-mcp
 *   ├── versions/<version>/<platform>/runtime-assets/...
 *   ├── downloads/<archive>.partial
 *   ├── manifests/<version>-<platform>.json
 *   ├── install.lock
 *   └── current.json
 *
 * 根目录：
 *   - macOS/Linux：$XDG_CACHE_HOME/opencode-oceanus/codebase-memory-mcp/，
 *     否则 ~/.cache/opencode-oceanus/codebase-memory-mcp/；
 *   - Windows：%LOCALAPPDATA%/opencode-oceanus/codebase-memory-mcp/。
 */

/**
 * 缓存根目录。`platform` 参数默认为当前平台，便于测试注入 Windows 分支。
 */
export function getCacheRoot(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA;
    const base = localAppData || join(homedir(), 'AppData', 'Local');
    return join(base, 'opencode-oceanus', CBM_CACHE_ROOT_NAME);
  }
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache || join(homedir(), '.cache');
  return join(base, 'opencode-oceanus', CBM_CACHE_ROOT_NAME);
}

/** versions/ 目录。 */
export function getVersionsDir(): string {
  return join(getCacheRoot(), 'versions');
}

/** 某个版本+平台的目录：versions/<version>/<platform>。 */
export function getVersionPlatformDir(platformKey: string, version: string): string {
  return join(getVersionsDir(), version, platformKey);
}

/** 已安装二进制路径：versions/<version>/<platform>/<binaryName>。 */
export function getBinaryPath(
  platformKey: string,
  version: string,
  binaryName: string,
): string {
  return join(getVersionPlatformDir(platformKey, version), binaryName);
}

/** runtime-assets 目录（随二进制安装的运行时资源）。 */
export function getRuntimeAssetsDir(platformKey: string, version: string): string {
  return join(getVersionPlatformDir(platformKey, version), 'runtime-assets');
}

/** downloads/ 目录。 */
export function getDownloadsDir(): string {
  return join(getCacheRoot(), 'downloads');
}

/** 下载中的 partial 文件路径：downloads/<archive>.partial。 */
export function getDownloadPartialPath(archiveName: string): string {
  return join(getDownloadsDir(), `${archiveName}.partial`);
}

/** manifests/ 目录。 */
export function getManifestsDir(): string {
  return join(getCacheRoot(), 'manifests');
}

/** 平台 manifest 路径：manifests/<version>-<platform>.json。 */
export function getManifestPath(platformKey: string, version: string): string {
  return join(getManifestsDir(), `${version}-${platformKey}.json`);
}

/** 安装锁路径。 */
export function getInstallLockPath(): string {
  return join(getCacheRoot(), 'install.lock');
}

/** current.json：当前有效版本/平台 manifest 的引用。 */
export function getCurrentManifestPath(): string {
  return join(getCacheRoot(), 'current.json');
}
