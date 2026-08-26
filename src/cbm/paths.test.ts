import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  getBinaryPath,
  getCacheRoot,
  getCurrentManifestPath,
  getDownloadPartialPath,
  getDownloadsDir,
  getInstallLockPath,
  getManifestPath,
  getManifestsDir,
  getRuntimeAssetsDir,
  getVersionPlatformDir,
  getVersionsDir,
} from './paths';

/**
 * CBM-02：缓存路径契约。
 *
 * 覆盖 macOS/Linux（$XDG_CACHE_HOME 或 ~/.cache）与 Windows
 * （%LOCALAPPDATA%）的缓存根，以及规范文档中定义的整体目录树：
 * versions/<version>/<platform>/、downloads/、manifests/、install.lock、
 * current.json。
 */

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe('getCacheRoot', () => {
  test('macOS/Linux：优先 $XDG_CACHE_HOME', () => {
    withEnv('XDG_CACHE_HOME', '/tmp/xdg', () => {
      expect(getCacheRoot('linux')).toBe(
        join('/tmp/xdg', 'opencode-oceanus', 'codebase-memory-mcp'),
      );
      expect(getCacheRoot('darwin')).toBe(
        join('/tmp/xdg', 'opencode-oceanus', 'codebase-memory-mcp'),
      );
    });
  });

  test('macOS/Linux：无 XDG_CACHE_HOME 时回退 ~/.cache', () => {
    withEnv('XDG_CACHE_HOME', undefined, () => {
      const root = getCacheRoot('linux');
      expect(root.endsWith(join('.cache', 'opencode-oceanus', 'codebase-memory-mcp'))).toBe(
        true,
      );
    });
  });

  test('Windows：优先 %LOCALAPPDATA%', () => {
    withEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local', () => {
      expect(getCacheRoot('win32')).toBe(
        join('C:\\Users\\me\\AppData\\Local', 'opencode-oceanus', 'codebase-memory-mcp'),
      );
    });
  });

  test('Windows：无 LOCALAPPDATA 时回退 %APPDATA%', () => {
    withEnv('LOCALAPPDATA', undefined, () => {
      withEnv('APPDATA', 'C:\\Users\\me\\AppData\\Roaming', () => {
        expect(getCacheRoot('win32')).toBe(
          join('C:\\Users\\me\\AppData\\Roaming', 'opencode-oceanus', 'codebase-memory-mcp'),
        );
      });
    });
  });

  test('Windows：两者都缺时回退 ~/AppData/Local', () => {
    withEnv('LOCALAPPDATA', undefined, () => {
      withEnv('APPDATA', undefined, () => {
        const root = getCacheRoot('win32');
        expect(
          root.endsWith(join('AppData', 'Local', 'opencode-oceanus', 'codebase-memory-mcp')),
        ).toBe(true);
      });
    });
  });
});

describe('缓存目录树', () => {
  test('结构符合规范：versions/downloads/manifests/lock/current', () => {
    withEnv('XDG_CACHE_HOME', '/tmp/xdg', () => {
      const root = getCacheRoot('linux');

      expect(getVersionsDir()).toBe(join(root, 'versions'));
      expect(getDownloadsDir()).toBe(join(root, 'downloads'));
      expect(getManifestsDir()).toBe(join(root, 'manifests'));
      expect(getInstallLockPath()).toBe(join(root, 'install.lock'));
      expect(getCurrentManifestPath()).toBe(join(root, 'current.json'));
    });
  });

  test('版本/平台隔离的二进制与 runtime-assets 路径', () => {
    withEnv('XDG_CACHE_HOME', '/tmp/xdg', () => {
      const vdir = getVersionPlatformDir('linux-x64', '0.10.8');
      expect(vdir).toBe(join(getVersionsDir(), '0.10.8', 'linux-x64'));

      expect(getBinaryPath('linux-x64', '0.10.8', 'codebase-memory-mcp')).toBe(
        join(vdir, 'codebase-memory-mcp'),
      );
      expect(getBinaryPath('win32-x64', '0.10.8', 'codebase-memory-mcp.exe')).toBe(
        join(getVersionPlatformDir('win32-x64', '0.10.8'), 'codebase-memory-mcp.exe'),
      );
      expect(getRuntimeAssetsDir('linux-x64', '0.10.8')).toBe(join(vdir, 'runtime-assets'));
    });
  });

  test('下载 partial 与 manifest 路径', () => {
    withEnv('XDG_CACHE_HOME', '/tmp/xdg', () => {
      expect(getDownloadPartialPath('codebase-memory-mcp-linux-x86_64.tar.gz')).toBe(
        join(getDownloadsDir(), 'codebase-memory-mcp-linux-x86_64.tar.gz.partial'),
      );
      expect(getManifestPath('linux-x64', '0.10.8')).toBe(
        join(getManifestsDir(), '0.10.8-linux-x64.json'),
      );
    });
  });
});
