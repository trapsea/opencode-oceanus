import { describe, expect, test } from 'bun:test';
import {
  CBM_BUILTIN_MANIFEST_SHA256,
  CbmPlatformError,
  getPlatformKey,
  resolveCbmPlatform,
} from './constants';

/**
 * CBM-02：canonical 平台映射契约。
 *
 * 覆盖 macOS/Linux/Windows 与 arm64/x64（含 aarch64/amd64/x86_64 别名）映射、
 * Windows `.exe`/`.zip` 扩展名、拒绝不支持平台，以及 canonical 归档名（不依赖
 * 独立的 `-ui-` 归档）。
 */

describe('resolveCbmPlatform - OS/架构规范化', () => {
  test('macOS arm64：canonical 映射与归档名', () => {
    const p = resolveCbmPlatform('darwin', 'arm64');
    expect(p.os).toBe('darwin');
    expect(p.arch).toBe('arm64');
    expect(p.osToken).toBe('macos');
    expect(p.archToken).toBe('arm64');
    expect(p.binaryName).toBe('codebase-memory-mcp');
    expect(p.archiveExt).toBe('tar.gz');
    expect(p.archiveName).toBe('codebase-memory-mcp-macos-arm64.tar.gz');
  });

  test('macOS x64：amd64 token', () => {
    const p = resolveCbmPlatform('darwin', 'x64');
    expect(p.archToken).toBe('amd64');
    expect(p.archiveName).toBe('codebase-memory-mcp-macos-amd64.tar.gz');
  });

  test('Linux x64/arm64', () => {
    const x64 = resolveCbmPlatform('linux', 'x64');
    expect(x64.osToken).toBe('linux');
    expect(x64.archiveName).toBe('codebase-memory-mcp-linux-amd64.tar.gz');

    const arm = resolveCbmPlatform('linux', 'arm64');
    expect(arm.archiveName).toBe('codebase-memory-mcp-linux-arm64.tar.gz');
  });

  test('Windows：二进制带 .exe、归档用 .zip', () => {
    const win = resolveCbmPlatform('win32', 'x64');
    expect(win.osToken).toBe('windows');
    expect(win.binaryName).toBe('codebase-memory-mcp.exe');
    expect(win.archiveExt).toBe('zip');
    expect(win.archiveName).toBe('codebase-memory-mcp-windows-amd64.zip');
  });

  test('架构别名：aarch64->arm64、amd64/x86_64->x64', () => {
    expect(resolveCbmPlatform('linux', 'aarch64').arch).toBe('arm64');
    expect(resolveCbmPlatform('linux', 'amd64').arch).toBe('x64');
    expect(resolveCbmPlatform('linux', 'x86_64').arch).toBe('x64');
  });

  test('OS 别名：macos/osx->darwin、windows/win->win32', () => {
    expect(resolveCbmPlatform('macos', 'arm64').os).toBe('darwin');
    expect(resolveCbmPlatform('osx', 'arm64').os).toBe('darwin');
    expect(resolveCbmPlatform('windows', 'x64').os).toBe('win32');
    expect(resolveCbmPlatform('win', 'x64').os).toBe('win32');
  });

  test('不支持 OS：抛出 CbmPlatformError(unsupported_os)', () => {
    expect(() => resolveCbmPlatform('freebsd', 'x64')).toThrow(CbmPlatformError);
    try {
      resolveCbmPlatform('freebsd', 'x64');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CbmPlatformError);
      expect((e as CbmPlatformError).kind).toBe('unsupported_os');
    }
  });

  test('不支持架构：抛出 CbmPlatformError(unsupported_arch)', () => {
    try {
      resolveCbmPlatform('linux', 'ia32');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CbmPlatformError);
      expect((e as CbmPlatformError).kind).toBe('unsupported_arch');
    }
  });
});

describe('内置 v0.10.8 六平台 SHA-256 manifest', () => {
  const official = {
    'darwin-x64':
      '2b193085410af3801634a522f4b17dcd6699695e015a068393c87817c1d260d4',
    'darwin-arm64':
      '9bd840dfb3ec7eaef4f310382057adaa5b0e904df883104d03ffcf39836afd07',
    'linux-x64':
      'e5cba4cad6ca8254a85f45041fc8a831908d7d5cb64f98fc3f8eb70a58671793',
    'linux-arm64':
      '5697d986d9716c913163b4bff7b3a294287f3b843e993bc1ff71e78dcdc21781',
    'win32-x64':
      'b43ad982994c4d829670749e08d3b622a74bb20041fc0a7d02bef6113f81c34d',
    'win32-arm64':
      '254b26e819f00bab7f430c5f809d37d22b07bb3eb6427e290e5a27ba5b8e983e',
  };

  test('覆盖全部六平台且值与官方发布一致（64 位小写十六进制）', () => {
    const cases: Array<[string, string]> = [
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ];
    for (const [os, arch] of cases) {
      const key = getPlatformKey(resolveCbmPlatform(os, arch));
      const value = CBM_BUILTIN_MANIFEST_SHA256[key];
      expect(value).toBe(official[key]);
      expect(value).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('getPlatformKey', () => {
  test('返回 canonical <os>-<arch> 键', () => {
    const p = resolveCbmPlatform('linux', 'x64');
    expect(getPlatformKey(p)).toBe('linux-x64');
    expect(getPlatformKey(resolveCbmPlatform('darwin', 'arm64'))).toBe(
      'darwin-arm64',
    );
    expect(getPlatformKey(resolveCbmPlatform('win32', 'arm64'))).toBe(
      'win32-arm64',
    );
  });
});

describe('六平台 canonical 归档名', () => {
  const cases: Array<[string, string, string, string, string]> = [
    // [平台, 架构, osToken, archToken, archiveName]
    ['darwin', 'arm64', 'macos', 'arm64', 'codebase-memory-mcp-macos-arm64.tar.gz'],
    ['darwin', 'x64', 'macos', 'amd64', 'codebase-memory-mcp-macos-amd64.tar.gz'],
    ['linux', 'arm64', 'linux', 'arm64', 'codebase-memory-mcp-linux-arm64.tar.gz'],
    ['linux', 'x64', 'linux', 'amd64', 'codebase-memory-mcp-linux-amd64.tar.gz'],
    ['win32', 'arm64', 'windows', 'arm64', 'codebase-memory-mcp-windows-arm64.zip'],
    ['win32', 'x64', 'windows', 'amd64', 'codebase-memory-mcp-windows-amd64.zip'],
  ];

  for (const [platform, arch, osToken, archToken, archiveName] of cases) {
    test(`${osToken}-${archToken} -> ${archiveName}`, () => {
      const p = resolveCbmPlatform(platform, arch);
      expect(p.osToken).toBe(osToken);
      expect(p.archToken).toBe(archToken);
      expect(p.archiveName).toBe(archiveName);
      expect(p.archiveExt).toBe(archiveName.endsWith('.zip') ? 'zip' : 'tar.gz');
      expect(p.binaryName).toBe(
        osToken === 'windows' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp',
      );
    });
  }
});
