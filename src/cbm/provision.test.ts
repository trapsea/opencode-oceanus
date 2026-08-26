import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildTarGz,
  buildZip,
  mockBinaryContent,
} from '../../test-fixtures/cbm/archives';
import {
  CbmProvisionError,
  ensureInstalled,
  provision,
  repair,
  resetProvisionSingleton,
  startBackgroundInstall,
} from './provision';
import { createCanonicalManifest, buildManifestUrl } from './manifest';
import { getPlatformKey, resolveCbmPlatform } from './constants';
import { getCurrentManifestPath } from './paths';
import type { SpawnFn } from './process';

/**
 * CBM-05：含内建 UI canonical release 的后台 provision 生命周期。
 *
 * 覆盖：成功安装（tar.gz/zip 夹具）、checksum 错误、缓存命中重校验、
 * 并发/陈旧锁、路径穿越、--version 健康检查失败保留旧版本、
 * ensureInstalled 共享 Promise、repair。所有下载/进程均注入，不访问真实网络。
 */

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cbm-provision-'));
}

interface FakeSpawnResult {
  spawn: SpawnFn;
  calls: string[][];
}

function fakeSpawn(
  options: { failVersion?: boolean; failFirstVersionCalls?: number } = {},
): FakeSpawnResult {
  const calls: string[][] = [];
  let versionCalls = 0;
  const failFirst = options.failFirstVersionCalls ?? 0;
  const failVersion = options.failVersion ?? false;
  const spawn: SpawnFn = (cmd, _opts) => {
    calls.push(cmd);
    const isVersion = cmd.length >= 2 && cmd[1] === '--version';
    let failed = false;
    if (isVersion) {
      versionCalls++;
      if (failVersion || versionCalls <= failFirst) failed = true;
    }
    return {
      stdout: async () => '',
      stderr: async () => (failed ? 'bad version\n' : ''),
      exited: Promise.resolve(failed ? 1 : 0),
      kill: () => true,
      get exitCode() {
        return failed ? 1 : 0;
      },
    };
  };
  return { spawn, calls };
}

function readCurrent(root: string): Record<string, unknown> | null {
  const p = getCurrentManifestPath();
  // paths.ts 用全局缓存根；测试直接用 cacheRoot 手工读取。
  const actual = join(root, 'current.json');
  if (!existsSync(actual)) return null;
  return JSON.parse(readFileSync(actual, 'utf8')) as Record<string, unknown>;
}

/** 以注入 cacheRoot 为根构造版本目录下二进制路径（测试不依赖全局缓存根）。 */
function vbin(
  root: string,
  platformKey: string,
  version: string,
  name: string,
): string {
  return join(root, 'versions', version, platformKey, name);
}

const roots: string[] = [];

function newRoot(): string {
  const r = tempRoot();
  roots.push(r);
  return r;
}

beforeEach(() => {
  resetProvisionSingleton();
});
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots.length = 0;
  resetProvisionSingleton();
});

describe('CBM-05 成功安装（tar.gz 与 zip 夹具）', () => {
  test('linux-x64 tar.gz：下载→校验→解压→原子安装→current manifest', async () => {
    const root = newRoot();
    const archive = buildTarGz([
      { name: 'codebase-memory-mcp', content: mockBinaryContent('linux') },
      { name: 'runtime-assets/', type: 'dir' },
      { name: 'runtime-assets/lang.graph', content: 'graph' },
    ]);
    const hash = sha256Hex(archive);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, hash, {
      url: 'https://example.invalid/cbm-linux-amd64.tar.gz',
    });
    let downloads = 0;
    const { spawn, calls } = fakeSpawn();

    const bin = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => {
        downloads++;
        writeFileSync(dest, archive);
      },
      spawn,
      pid: 111,
      now: () => 1000,
      isPidAlive: () => true,
    });

    const platformKey = getPlatformKey(platform);
    expect(bin).toBe(vbin(root, platformKey, '0.10.8', 'codebase-memory-mcp'));
    expect(existsSync(bin)).toBe(true);
    // Unix 可执行位
    expect(statSync(bin).mode & 0o111).not.toBe(0);
    // runtime-assets 也被解压
    expect(
      existsSync(
        join(root, 'versions', '0.10.8', platformKey, 'runtime-assets', 'lang.graph'),
      ),
    ).toBe(true);
    expect(downloads).toBe(1);
    // --version 健康检查执行过一次
    expect(calls.some((c) => c[1] === '--version')).toBe(true);

    const current = readCurrent(root);
    expect(current).not.toBeNull();
    expect(current?.version).toBe('0.10.8');
    expect(current?.platform).toBe('linux-x64');
    expect(current?.archive).toBe(manifest.archive);
    expect(current?.sha256).toBe(hash);
    expect(current?.uiBuiltIn).toBe(true);
    // partial 已清理
    expect(readdirSync(join(root, 'downloads'))).toEqual([]);
  });

  test('win32-x64 zip：.exe 二进制与 .zip 解压', async () => {
    const root = newRoot();
    const archive = buildZip([
      { name: 'codebase-memory-mcp.exe', content: mockBinaryContent('win') },
    ]);
    const hash = sha256Hex(archive);
    const platform = resolveCbmPlatform('win32', 'x64');
    const manifest = createCanonicalManifest(platform, hash, {
      url: 'https://example.invalid/cbm-windows-amd64.zip',
    });
    const { spawn } = fakeSpawn();

    const bin = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => writeFileSync(dest, archive),
      spawn,
      pid: 222,
      now: () => 2000,
      isPidAlive: () => true,
    });

    expect(bin.endsWith('codebase-memory-mcp.exe')).toBe(true);
    expect(existsSync(bin)).toBe(true);
    const current = readCurrent(root);
    expect(current?.archive).toBe('codebase-memory-mcp-windows-amd64.zip');
  });
});

describe('CBM-05 checksum 错误', () => {
  test('下载内容 SHA-256 不匹配：抛 checksum_mismatch、清理 partial、不写 current', async () => {
    const root = newRoot();
    const good = buildTarGz([{ name: 'codebase-memory-mcp', content: 'good' }]);
    const wrongHash = sha256Hex(Buffer.from('different-content'));
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, wrongHash, {
      url: 'https://example.invalid/cbm.tar.gz',
    });
    const { spawn } = fakeSpawn();

    let threw: CbmProvisionError | undefined;
    try {
      await provision({
        cacheRoot: root,
        platform,
        manifest,
        download: async (_u, dest) => writeFileSync(dest, good),
        spawn,
        pid: 1,
        now: () => 0,
        isPidAlive: () => true,
      });
    } catch (e) {
      threw = e as CbmProvisionError;
    }

    expect(threw).toBeInstanceOf(CbmProvisionError);
    expect(threw?.code).toBe('checksum_mismatch');
    // partial 被清理
    expect(readdirSync(join(root, 'downloads'))).toEqual([]);
    // 未写入 current.json / 版本目录
    expect(existsSync(join(root, 'current.json'))).toBe(false);
    expect(existsSync(join(root, 'versions', '0.10.8', 'linux-x64'))).toBe(false);
  });
});

describe('CBM-05 缓存命中重校验', () => {
  test('已有有效当前版本：复用，不重新下载，但重新执行 --version 健康检查', async () => {
    const root = newRoot();
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'v1' }]);
    const hash = sha256Hex(archive);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, hash, {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    const first = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => writeFileSync(dest, archive),
      spawn: fakeSpawn().spawn,
      pid: 3,
      now: () => 1000,
      isPidAlive: () => true,
    });

    // 第二次调用（新 session / 新 io）：禁止下载，但必须重校验版本
    let downloads = 0;
    const { spawn, calls } = fakeSpawn();
    const second = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async () => {
        downloads++;
        throw new Error('should not re-download');
      },
      spawn,
      pid: 4,
      now: () => 2000,
      isPidAlive: () => true,
    });

    expect(second).toBe(first);
    expect(downloads).toBe(0);
    expect(calls.some((c) => c[1] === '--version')).toBe(true);
    expect(readCurrent(root)?.installedAt).toBe(1000); // 未重装
  });

  test('当前版本损坏（--version 失败）时进入重新安装', async () => {
    const root = newRoot();
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'v1' }]);
    const hash = sha256Hex(archive);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, hash, {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => writeFileSync(dest, archive),
      spawn: fakeSpawn().spawn,
      pid: 5,
      now: () => 1000,
      isPidAlive: () => true,
    });

    // 再次调用，下载必须发生（因为缓存校验失败）
    let downloads = 0;
    const second = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => {
        downloads++;
        writeFileSync(dest, archive);
      },
      // 首个 --version（缓存重校验）失败 → 触发重装；后续（新二进制）成功
      spawn: fakeSpawn({ failFirstVersionCalls: 1 }).spawn,
      pid: 6,
      now: () => 2000,
      isPidAlive: () => true,
    });
    expect(downloads).toBe(1);
    expect(second).toBeTruthy();
  });
});

describe('CBM-05 并发 / 陈旧锁', () => {
  function lockPath(root: string): string {
    return join(root, 'install.lock');
  }

  test('锁被存活进程持有（新鲜）：lock_busy、不下载', async () => {
    const root = newRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      lockPath(root),
      JSON.stringify({ pid: 9999, createdAt: Date.now(), stage: 'provision' }),
    );
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'x' }]);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, sha256Hex(archive), {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    let downloads = 0;
    let threw: CbmProvisionError | undefined;
    try {
      await provision({
        cacheRoot: root,
        platform,
        manifest,
        download: async () => {
          downloads++;
        },
        spawn: fakeSpawn().spawn,
        pid: 100,
        now: () => Date.now(),
        isPidAlive: () => true, // 9999 存活
        lockMaxAttempts: 1,
      });
    } catch (e) {
      threw = e as CbmProvisionError;
    }
    expect(threw).toBeInstanceOf(CbmProvisionError);
    expect(threw?.code).toBe('lock_busy');
    expect(downloads).toBe(0);
  });

  test('陈旧锁（超龄）被接管并成功安装', async () => {
    const root = newRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(lockPath(root), JSON.stringify({ pid: 9999, createdAt: 1, stage: 'provision' }));
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'x' }]);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, sha256Hex(archive), {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    let downloads = 0;
    const bin = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => {
        downloads++;
        writeFileSync(dest, archive);
      },
      spawn: fakeSpawn().spawn,
      pid: 101,
      now: () => 1_000_000,
      isPidAlive: () => true, // 虽存活但 age 超 maxLockAgeMs
      maxLockAgeMs: 1000,
      lockMaxAttempts: 1,
    });
    expect(downloads).toBe(1);
    expect(existsSync(bin)).toBe(true);
    // 锁已释放
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test('陈旧锁（持有者进程已死）被接管并成功安装', async () => {
    const root = newRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(lockPath(root), JSON.stringify({ pid: 9999, createdAt: Date.now(), stage: 'provision' }));
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'x' }]);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, sha256Hex(archive), {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    let downloads = 0;
    const bin = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => {
        downloads++;
        writeFileSync(dest, archive);
      },
      spawn: fakeSpawn().spawn,
      pid: 102,
      now: () => Date.now(),
      isPidAlive: () => false, // 持有者已死
      lockMaxAttempts: 1,
    });
    expect(downloads).toBe(1);
    expect(existsSync(bin)).toBe(true);
  });
});

describe('CBM-05 路径穿越', () => {
  test('tar.gz 含 ../ 成员：抛 unsafe_member、不外泄', async () => {
    const root = newRoot();
    const archive = buildTarGz([
      { name: '../evil', content: 'pwn' },
      { name: 'codebase-memory-mcp', content: 'ok' },
    ]);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, sha256Hex(archive), {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    let threw: CbmProvisionError | undefined;
    try {
      await provision({
        cacheRoot: root,
        platform,
        manifest,
        download: async (_u, dest) => writeFileSync(dest, archive),
        spawn: fakeSpawn().spawn,
        pid: 7,
        now: () => 0,
        isPidAlive: () => true,
      });
    } catch (e) {
      threw = e as CbmProvisionError;
    }
    expect(threw).toBeInstanceOf(CbmProvisionError);
    expect(threw?.code).toBe('unsafe_member');
  });

  test('zip 含绝对路径成员：抛 unsafe_member', async () => {
    const root = newRoot();
    const archive = buildZip([
      { name: '/etc/evil', content: 'pwn' },
      { name: 'codebase-memory-mcp.exe', content: 'ok' },
    ]);
    const platform = resolveCbmPlatform('win32', 'x64');
    const manifest = createCanonicalManifest(platform, sha256Hex(archive), {
      url: 'https://example.invalid/cbm.zip',
    });

    let threw: CbmProvisionError | undefined;
    try {
      await provision({
        cacheRoot: root,
        platform,
        manifest,
        download: async (_u, dest) => writeFileSync(dest, archive),
        spawn: fakeSpawn().spawn,
        pid: 8,
        now: () => 0,
        isPidAlive: () => true,
      });
    } catch (e) {
      threw = e as CbmProvisionError;
    }
    expect(threw).toBeInstanceOf(CbmProvisionError);
    expect(threw?.code).toBe('unsafe_member');
  });
});

describe('CBM-05 --version 健康检查失败保留旧版本', () => {
  test('重新安装时版本检查失败：抛 version_check_failed、旧版本与 current 保留', async () => {
    const root = newRoot();
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'v1' }]);
    const hash = sha256Hex(archive);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, hash, {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    const oldBin = await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => writeFileSync(dest, archive),
      spawn: fakeSpawn().spawn,
      pid: 9,
      now: () => 1000,
      isPidAlive: () => true,
    });
    const oldInstalledAt = readCurrent(root)?.installedAt;

    // 第二次安装：版本检查失败
    let threw: CbmProvisionError | undefined;
    try {
      await provision({
        cacheRoot: root,
        platform,
        manifest,
        download: async (_u, dest) => writeFileSync(dest, archive),
        spawn: fakeSpawn({ failVersion: true }).spawn,
        pid: 10,
        now: () => 2000,
        isPidAlive: () => true,
      });
    } catch (e) {
      threw = e as CbmProvisionError;
    }

    expect(threw).toBeInstanceOf(CbmProvisionError);
    expect(threw?.code).toBe('version_check_failed');
    // 旧版本保留
    expect(existsSync(oldBin)).toBe(true);
    // current manifest 未变
    expect(readCurrent(root)?.installedAt).toBe(oldInstalledAt);
    // 无 staging 残留
    const vdir = join(root, 'versions', '0.10.8');
    if (existsSync(vdir)) {
      for (const entry of readdirSync(vdir)) {
        expect(entry).not.toContain('.staging-');
        expect(entry).not.toContain('.old-');
      }
    }
  });
});

describe('CBM-05 ensureInstalled 共享 Promise / 后台不阻塞', () => {
  test('并发 ensureInstalled 只触发一次下载', async () => {
    const root = newRoot();
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'shared' }]);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, sha256Hex(archive), {
      url: 'https://example.invalid/cbm.tar.gz',
    });
    let downloads = 0;
    const opts = {
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u: string, dest: string) => {
        downloads++;
        writeFileSync(dest, archive);
      },
      spawn: fakeSpawn().spawn,
      pid: 11,
      now: () => 1000,
      isPidAlive: () => true,
    };

    const p1 = ensureInstalled(opts);
    const p2 = ensureInstalled(opts);
    const [b1, b2] = await Promise.all([p1, p2]);
    expect(b1).toBe(b2);
    expect(b1).toBeTruthy();
    expect(downloads).toBe(1);
  });

  test('startBackgroundInstall 返回 promise 但不阻塞调用方', async () => {
    const root = newRoot();
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'bg' }]);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, sha256Hex(archive), {
      url: 'https://example.invalid/cbm.tar.gz',
    });
    let downloads = 0;
    const p = startBackgroundInstall({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u: string, dest: string) => {
        downloads++;
        writeFileSync(dest, archive);
      },
      spawn: fakeSpawn().spawn,
      pid: 12,
      now: () => 1000,
      isPidAlive: () => true,
    });
    // 不 await，立即断言同步返回（promise 仍 pending）
    expect(typeof p.then).toBe('function');
    const bin = await p;
    expect(bin).toBeTruthy();
    expect(downloads).toBe(1);
  });

  test('安装失败时 ensureInstalled 返回 null（非阻塞降级）', async () => {
    const root = newRoot();
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'x' }]);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, 'f'.repeat(64), {
      url: 'https://example.invalid/cbm.tar.gz',
    });
    const result = await ensureInstalled({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u: string, dest: string) => writeFileSync(dest, archive),
      spawn: fakeSpawn().spawn,
      pid: 13,
      now: () => 0,
      isPidAlive: () => true,
    });
    expect(result).toBeNull();
  });
});

describe('CBM-05 repair', () => {
  test('repair 清理损坏 staging/partial，保留旧可用版本并恢复', async () => {
    const root = newRoot();
    const archive = buildTarGz([{ name: 'codebase-memory-mcp', content: 'good' }]);
    const hash = sha256Hex(archive);
    const platform = resolveCbmPlatform('linux', 'x64');
    const manifest = createCanonicalManifest(platform, hash, {
      url: 'https://example.invalid/cbm.tar.gz',
    });

    await provision({
      cacheRoot: root,
      platform,
      manifest,
      download: async (_u, dest) => writeFileSync(dest, archive),
      spawn: fakeSpawn().spawn,
      pid: 14,
      now: () => 1000,
      isPidAlive: () => true,
    });
    const oldBin = join(root, 'versions', '0.10.8', 'linux-x64', 'codebase-memory-mcp');

    // 制造损坏的 staging 与 partial
    const vdir = join(root, 'versions', '0.10.8');
    mkdirSync(join(vdir, 'linux-x64.staging-999-1'), { recursive: true });
    mkdirSync(join(root, 'downloads'), { recursive: true });
    writeFileSync(join(root, 'downloads', 'junk.tar.gz.partial'), 'partial');

    const result = await repair({
      cacheRoot: root,
      platform,
      manifest,
      download: async () => {
        throw new Error('cache hit, no download expected during repair');
      },
      spawn: fakeSpawn().spawn,
      pid: 15,
      now: () => 2000,
      isPidAlive: () => true,
    });

    // 旧版本仍可用，repair 命中缓存
    expect(existsSync(oldBin)).toBe(true);
    expect(result).toBe(oldBin);
    // staging / partial 被清理
    expect(existsSync(join(vdir, 'linux-x64.staging-999-1'))).toBe(false);
    expect(existsSync(join(root, 'downloads', 'junk.tar.gz.partial'))).toBe(false);
  });
});

describe('CBM-05 内置六平台 manifest 与官方下载 URL', () => {
  test('六平台 URL 均来自官方 release 基址', () => {
    const cases: Array<[string, string]> = [
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ];
    for (const [os, arch] of cases) {
      const url = buildManifestUrl(resolveCbmPlatform(os, arch));
      expect(url.startsWith('https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.10.8/')).toBe(true);
    }
  });
});
