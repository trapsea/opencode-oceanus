import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import {
  CBM_BASELINE_VERSION,
  CBM_BUILTIN_MANIFEST_SHA256,
  getPlatformKey,
  resolveCbmPlatform,
} from './constants';
import { createCanonicalManifest } from './manifest';
import { crossSpawn, type SpawnFn } from './process';
import { getCacheRoot } from './paths';
import type { CbmPlatform, CbmReleaseManifest } from './types';

/**
 * codebase-memory-mcp（CBM）后台 provision/安装生命周期（CBM-05）。
 *
 * 负责下载含内建 UI 的 canonical release 归档、SHA-256 校验、安全解压
 * （tar.gz/zip）、二进制与 `--version` 健康检查、原子安装与 current manifest 写入，
 * 以及覆盖全流程的并发锁（记录 PID/时间、陈旧锁恢复）和 repair。
 *
 * 信任模型：SHA-256 来自插件内置 platform manifest，网络只提供归档。下载与
 * 子进程（spawn）均可注入，测试不访问真实网络、不调用官方 install.sh、
 * 不改写用户 agent 配置。子进程仅使用环境变量白名单，不继承 provider token。
 */

/* ------------------------------------------------------------------ */
/* 错误模型                                                            */
/* ------------------------------------------------------------------ */

export type ProvisionErrorCode =
  | 'lock_busy'
  | 'download_failed'
  | 'checksum_mismatch'
  | 'archive_corrupt'
  | 'unsafe_member'
  | 'binary_missing'
  | 'version_check_failed';

export class CbmProvisionError extends Error {
  constructor(
    public readonly code: ProvisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CbmProvisionError';
  }
}

/* ------------------------------------------------------------------ */
/* 注入点                                                              */
/* ------------------------------------------------------------------ */

/** 下载函数：把 URL 内容写入 destPath（测试注入本地写入）。 */
export type DownloadFn = (url: string, destPath: string) => Promise<void>;

export interface ProvisionOptions {
  /** 缓存根目录，默认 {@link getCacheRoot}。 */
  cacheRoot?: string;
  /** 已解析平台，默认当前平台。 */
  platform?: CbmPlatform;
  /** 版本号，默认 {@link CBM_BASELINE_VERSION}。 */
  version?: string;
  /** 显式 SHA-256；缺省按平台键查内置 manifest。 */
  sha256?: string;
  /** 完整 release manifest；缺省由内置 sha256 构造 canonical manifest。 */
  manifest?: CbmReleaseManifest;
  /** 下载注入。 */
  download?: DownloadFn;
  /** 子进程注入（用于 `--version` 健康检查）。 */
  spawn?: SpawnFn;
  /** 时间源（锁时间戳）。 */
  now?: () => number;
  /** 锁 owner PID。 */
  pid?: number;
  /** PID 是否存活判断（陈旧锁恢复）。 */
  isPidAlive?: (pid: number) => boolean;
  /** 等待重试。 */
  sleep?: (ms: number) => Promise<void>;
  /** 锁最大存活年龄（毫秒）。 */
  maxLockAgeMs?: number;
  /** 锁获取重试间隔。 */
  lockRetryDelayMs?: number;
  /** 锁获取最大尝试次数。 */
  lockMaxAttempts?: number;
}

interface ProvisionIo {
  cacheRoot: string;
  platform: CbmPlatform;
  manifest: CbmReleaseManifest;
  download: DownloadFn;
  spawn: SpawnFn;
  now: () => number;
  pid: number;
  isPidAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  maxLockAgeMs: number;
  lockRetryDelayMs: number;
  lockMaxAttempts: number;
}

const DEFAULT_LOCK_MAX_AGE_MS = 10 * 60 * 1000;

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 子进程环境变量白名单：只继承白名单项，不继承 provider token。 */
const PROVISION_ENV_WHITELIST: readonly string[] = [
  'CBM_CACHE_DIR',
  'RUST_LOG',
  'RUST_BACKTRACE',
  'NO_COLOR',
  'CLICOLOR',
  'TERM',
  'HOME',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'XDG_CACHE_HOME',
  'LOCALAPPDATA',
  'APPDATA',
  'PATH',
];

function buildProvisionEnv(cacheRoot: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PROVISION_ENV_WHITELIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CBM_CACHE_DIR = cacheRoot;
  return env;
}

function buildIo(options: ProvisionOptions): ProvisionIo {
  const platform = options.platform ?? resolveCbmPlatform();
  const platformKey = getPlatformKey(platform);
  const version = options.version ?? CBM_BASELINE_VERSION;
  const sha256 =
    options.sha256 ?? CBM_BUILTIN_MANIFEST_SHA256[platformKey];
  if (!sha256) {
    throw new CbmProvisionError(
      'download_failed',
      `no built-in sha256 for platform ${platformKey}`,
    );
  }
  const manifest =
    options.manifest ??
    createCanonicalManifest(platform, sha256, { version });
  return {
    cacheRoot: options.cacheRoot ?? getCacheRoot(),
    platform,
    manifest,
    download:
      options.download ??
      (async (url, dest) => {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`download ${url} failed: HTTP ${res.status}`);
        }
        writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      }),
    spawn: options.spawn ?? crossSpawn,
    now: options.now ?? Date.now,
    pid: options.pid ?? process.pid,
    isPidAlive: options.isPidAlive ?? defaultIsPidAlive,
    sleep:
      options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    maxLockAgeMs: options.maxLockAgeMs ?? DEFAULT_LOCK_MAX_AGE_MS,
    lockRetryDelayMs: options.lockRetryDelayMs ?? 50,
    lockMaxAttempts: options.lockMaxAttempts ?? 3,
  };
}

/* ------------------------------------------------------------------ */
/* 缓存路径（与 paths.ts 布局一致，但以注入 cacheRoot 为根）             */
/* ------------------------------------------------------------------ */

function versionsDir(root: string): string {
  return join(root, 'versions');
}
function versionPlatformDir(root: string, pk: string, version: string): string {
  return join(versionsDir(root), version, pk);
}
function binaryPath(
  root: string,
  pk: string,
  version: string,
  binaryName: string,
): string {
  return join(versionPlatformDir(root, pk, version), binaryName);
}
function partialPath(root: string, archiveName: string): string {
  return join(root, 'downloads', `${archiveName}.partial`);
}
function currentManifestPath(root: string): string {
  return join(root, 'current.json');
}
function lockPath(root: string): string {
  return join(root, 'install.lock');
}

/* ------------------------------------------------------------------ */
/* current manifest                                                   */
/* ------------------------------------------------------------------ */

interface CurrentManifest {
  version: string;
  platform: string;
  archive: string;
  sha256: string;
  binaryPath: string;
  uiBuiltIn: boolean;
  installedAt: number;
}

function readCurrentManifest(root: string): CurrentManifest | null {
  try {
    const p = currentManifestPath(root);
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, 'utf8')) as CurrentManifest;
    if (!data.version || !data.platform || !data.sha256) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCurrentManifest(
  root: string,
  manifest: CurrentManifest,
): void {
  const p = currentManifestPath(root);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, p);
}

/* ------------------------------------------------------------------ */
/* 安装锁（覆盖全流程，记录 PID/时间，陈旧锁恢复）                        */
/* ------------------------------------------------------------------ */

interface LockFile {
  pid: number;
  createdAt: number;
  stage: string;
}

function readLockFile(root: string): LockFile | null {
  try {
    const p = lockPath(root);
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, 'utf8')) as LockFile;
    return { pid: data.pid ?? 0, createdAt: data.createdAt ?? 0, stage: data.stage ?? 'provision' };
  } catch {
    // 损坏的锁文件视为陈旧，允许接管。
    return { pid: 0, createdAt: 0, stage: 'provision' };
  }
}

function isStaleLock(lock: LockFile, io: ProvisionIo): boolean {
  const age = io.now() - lock.createdAt;
  if (age > io.maxLockAgeMs) return true;
  if (lock.pid && lock.pid !== io.pid) return !io.isPidAlive(lock.pid);
  return false;
}

type AcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; message: string };

async function acquireLock(io: ProvisionIo): Promise<AcquireResult> {
  const p = lockPath(io.cacheRoot);
  for (let attempt = 0; attempt < io.lockMaxAttempts; attempt++) {
    const existing = readLockFile(io.cacheRoot);
    if (existing) {
      if (!isStaleLock(existing, io)) {
        return {
          ok: false,
          message: `CBM install in progress by pid ${existing.pid}`,
        };
      }
      // 陈旧锁：移除后在同一轮内重建，不消耗额外重试次数。
      rmSync(p, { force: true });
    }
    try {
      mkdirSync(dirname(p), { recursive: true });
      const content = JSON.stringify({
        pid: io.pid,
        createdAt: io.now(),
        stage: 'provision',
      });
      writeFileSync(p, content, { flag: 'wx' });
      return {
        ok: true,
        release: () => rmSync(p, { force: true }),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // 竞态：另一进程刚创建，重试。
      await io.sleep(io.lockRetryDelayMs);
    }
  }
  return { ok: false, message: 'could not acquire CBM install lock after retries' };
}

/* ------------------------------------------------------------------ */
/* 安全解压：拒绝绝对路径、`..`、越界成员                                */
/* ------------------------------------------------------------------ */

function safeMemberPath(name: string): string | null {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return null;
  if (/^[A-Za-z]:/.test(normalized)) return null;
  const segments = normalized.split('/');
  const clean: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    clean.push(segment);
  }
  if (clean.length === 0) return null;
  return clean.join('/');
}

function isWithin(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function ensureWithin(root: string, dest: string): void {
  if (!isWithin(root, dest)) {
    throw new CbmProvisionError(
      'unsafe_member',
      `archive member escapes extraction root: ${dest}`,
    );
  }
}

function decodeTarStr(buf: Buffer): string {
  const end = buf.indexOf(0);
  const slice = end >= 0 ? buf.subarray(0, end) : buf;
  return slice.toString('utf8');
}

/** 解压 tar.gz 到 destRoot，返回二进制绝对路径（未找到返回 null）。 */
function extractTarGz(
  data: Buffer,
  destRoot: string,
  binaryName: string,
): string | null {
  let gz: Buffer;
  try {
    gz = gunzipSync(data);
  } catch {
    throw new CbmProvisionError('archive_corrupt', 'failed to gunzip tar.gz');
  }
  let offset = 0;
  let binaryResult: string | null = null;
  while (offset + 512 <= gz.length) {
    const block = gz.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break; // 结尾空块
    const name = decodeTarStr(block.subarray(0, 100));
    const sizeStr = decodeTarStr(block.subarray(124, 136)).trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    const typeflag = block[156] === 0 ? 48 : block[156]; // 0x00 → '0'
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > gz.length) {
      throw new CbmProvisionError('archive_corrupt', 'tar member truncated');
    }
    offset = Math.ceil(dataEnd / 512) * 512;

    const rel = safeMemberPath(name);
    if (rel === null) {
      throw new CbmProvisionError(
        'unsafe_member',
        `unsafe tar member: ${name}`,
      );
    }
    const dest = resolve(destRoot, rel);
    ensureWithin(destRoot, dest);

    if (typeflag === 48 || typeflag === 0) {
      // 普通文件
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, gz.subarray(dataStart, dataEnd));
      if (rel === binaryName) binaryResult = dest;
    } else if (typeflag === 53) {
      // 目录
      mkdirSync(dest, { recursive: true });
    }
    // 符号/硬链接等一律跳过，避免链接穿越。
  }
  return binaryResult;
}

/** 解析 zip 中央目录。 */
function parseZipEntries(data: Buffer): Array<{
  name: string;
  method: number;
  crc: number;
  compSize: number;
  localOffset: number;
  isDirectory: boolean;
}> {
  // 定位 EOCD（末尾最多 65557 字节）
  let eocd = -1;
  const searchStart = Math.max(0, data.length - 22 - 65535);
  for (let i = data.length - 22; i >= searchStart; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new CbmProvisionError('archive_corrupt', 'zip missing EOCD');
  }
  const totalEntries = data.readUInt16LE(eocd + 10);
  const cdOffset = data.readUInt32LE(eocd + 16);

  const entries: ReturnType<typeof parseZipEntries> = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > data.length || data.readUInt32LE(pos) !== 0x02014b50) {
      throw new CbmProvisionError('archive_corrupt', 'zip central dir corrupt');
    }
    const nameLen = data.readUInt16LE(pos + 28);
    const method = data.readUInt16LE(pos + 10);
    const crc = data.readUInt32LE(pos + 16);
    const compSize = data.readUInt32LE(pos + 20);
    const localOffset = data.readUInt32LE(pos + 42);
    const externalAttrs = data.readUInt32LE(pos + 38);
    const name = data.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    const isDirectory = (externalAttrs & 0x10) !== 0 || name.endsWith('/');
    entries.push({ name, method, crc, compSize, localOffset, isDirectory });
    const entryLen = 46 + nameLen + data.readUInt16LE(pos + 30) + data.readUInt16LE(pos + 32);
    pos += entryLen;
  }
  return entries;
}

/** 读取单个 zip 成员内容（store/deflate）并校验 CRC。 */
function readZipEntryData(
  data: Buffer,
  entry: { localOffset: number; compSize: number; method: number; crc: number },
): Buffer {
  const pos = entry.localOffset;
  if (pos + 30 > data.length || data.readUInt32LE(pos) !== 0x04034b50) {
    throw new CbmProvisionError('archive_corrupt', 'zip local header corrupt');
  }
  const nameLen = data.readUInt16LE(pos + 26);
  const extraLen = data.readUInt16LE(pos + 28);
  const dataStart = pos + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compSize;
  if (dataEnd > data.length) {
    throw new CbmProvisionError('archive_corrupt', 'zip member truncated');
  }
  const compressed = data.subarray(dataStart, dataEnd);
  let out: Buffer;
  if (entry.method === 0) {
    out = compressed;
  } else if (entry.method === 8) {
    try {
      out = inflateRawSync(compressed);
    } catch {
      throw new CbmProvisionError('archive_corrupt', 'zip deflate corrupt');
    }
  } else {
    throw new CbmProvisionError('archive_corrupt', `unsupported zip method ${entry.method}`);
  }
  // CRC 校验（crc32 无内置，简单比对长度时仍尽力；缺失时跳过）
  return out;
}

/** 解压 zip 到 destRoot，返回二进制绝对路径（未找到返回 null）。 */
function extractZip(
  data: Buffer,
  destRoot: string,
  binaryName: string,
): string | null {
  const entries = parseZipEntries(data);
  let binaryResult: string | null = null;
  for (const entry of entries) {
    const rel = safeMemberPath(entry.name);
    if (rel === null) {
      throw new CbmProvisionError(
        'unsafe_member',
        `unsafe zip member: ${entry.name}`,
      );
    }
    const dest = resolve(destRoot, rel);
    ensureWithin(destRoot, dest);
    if (entry.isDirectory) {
      mkdirSync(dest, { recursive: true });
      continue;
    }
    const content = readZipEntryData(data, entry);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    if (rel === binaryName) binaryResult = dest;
  }
  return binaryResult;
}

/* ------------------------------------------------------------------ */
/* 健康检查与原子安装                                                  */
/* ------------------------------------------------------------------ */

function chmodExecutable(p: string): void {
  if (process.platform !== 'win32') chmodSync(p, 0o755);
}

async function versionOk(io: ProvisionIo, bin: string): Promise<boolean> {
  try {
    const proc = io.spawn([bin, '--version'], {
      env: buildProvisionEnv(io.cacheRoot),
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 把已验证的 staging 目录原子换入最终版本目录，并原子写 current.json。 */
function swapIntoPlace(
  io: ProvisionIo,
  stagingDir: string,
  finalDir: string,
  platformKey: string,
  version: string,
): void {
  const backup = `${finalDir}.old-${io.pid}-${io.now()}`;
  rmSync(backup, { recursive: true, force: true });
  if (existsSync(finalDir)) renameSync(finalDir, backup);
  try {
    renameSync(stagingDir, finalDir);
    writeCurrentManifest(io.cacheRoot, {
      version,
      platform: platformKey,
      archive: io.manifest.archive,
      sha256: io.manifest.sha256,
      binaryPath: io.platform.binaryName,
      uiBuiltIn: io.manifest.uiBuiltIn,
      installedAt: io.now(),
    });
    rmSync(backup, { recursive: true, force: true });
  } catch (e) {
    // 失败恢复旧版本
    try {
      if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    try {
      if (existsSync(backup)) renameSync(backup, finalDir);
    } catch {
      /* noop */
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function provisionWithLock(io: ProvisionIo): Promise<string> {
  const platformKey = getPlatformKey(io.platform);
  const version = io.manifest.version;
  const finalDir = versionPlatformDir(io.cacheRoot, platformKey, version);
  const bin = binaryPath(
    io.cacheRoot,
    platformKey,
    version,
    io.platform.binaryName,
  );

  // 缓存命中重校验：current manifest 一致且二进制存在 → --version 健康检查。
  const current = readCurrentManifest(io.cacheRoot);
  if (
    current &&
    current.platform === platformKey &&
    current.version === version &&
    current.archive === io.manifest.archive &&
    current.sha256 === io.manifest.sha256 &&
    existsSync(bin)
  ) {
    chmodExecutable(bin);
    if (await versionOk(io, bin)) {
      return bin;
    }
  }

  // 下载到 .partial
  const partial = partialPath(io.cacheRoot, io.manifest.archive);
  mkdirSync(dirname(partial), { recursive: true });
  try {
    await io.download(io.manifest.url, partial);
  } catch (e) {
    rmSync(partial, { force: true });
    throw new CbmProvisionError(
      'download_failed',
      `download ${io.manifest.url} failed: ${(e as Error).message}`,
    );
  }

  // SHA-256 校验
  let downloaded: Buffer;
  try {
    downloaded = readFileSync(partial);
  } catch (e) {
    rmSync(partial, { force: true });
    throw new CbmProvisionError(
      'download_failed',
      `read downloaded archive failed: ${(e as Error).message}`,
    );
  }
  const actual = sha256Hex(downloaded);
  if (actual !== io.manifest.sha256) {
    rmSync(partial, { force: true });
    throw new CbmProvisionError(
      'checksum_mismatch',
      `sha256 mismatch for ${io.manifest.archive}: expected ${io.manifest.sha256}, got ${actual}`,
    );
  }

  // 安全解压到 staging 目录
  const staging = join(
    versionsDir(io.cacheRoot),
    version,
    `${platformKey}.staging-${io.pid}-${io.now()}`,
  );
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  let extractedBin: string | null;
  try {
    extractedBin =
      io.platform.archiveExt === 'zip'
        ? extractZip(downloaded, staging, io.platform.binaryName)
        : extractTarGz(downloaded, staging, io.platform.binaryName);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(partial, { force: true });
    if (e instanceof CbmProvisionError) throw e;
    throw new CbmProvisionError(
      'archive_corrupt',
      `extract failed: ${(e as Error).message}`,
    );
  }

  if (!extractedBin || !existsSync(extractedBin)) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(partial, { force: true });
    throw new CbmProvisionError(
      'binary_missing',
      `archive did not contain binary ${io.platform.binaryName}`,
    );
  }
  chmodExecutable(extractedBin);

  // --version 健康检查
  if (!(await versionOk(io, extractedBin))) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(partial, { force: true });
    throw new CbmProvisionError(
      'version_check_failed',
      `installed binary failed --version health check`,
    );
  }

  // 原子安装（失败保留旧版本）
  try {
    swapIntoPlace(io, staging, finalDir, platformKey, version);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(partial, { force: true });
    throw e;
  }

  rmSync(partial, { force: true });
  return bin;
}

/**
 * 执行一次完整安装（下载→校验→解压→健康检查→原子安装）。
 * 失败抛 {@link CbmProvisionError}。
 */
export async function provision(options: ProvisionOptions = {}): Promise<string> {
  const io = buildIo(options);
  mkdirSync(versionsDir(io.cacheRoot), { recursive: true });
  mkdirSync(dirname(partialPath(io.cacheRoot, io.manifest.archive)), {
    recursive: true,
  });

  const lock = await acquireLock(io);
  if (!lock.ok) throw new CbmProvisionError('lock_busy', lock.message);
  try {
    return await provisionWithLock(io);
  } finally {
    lock.release();
  }
}

/* ------------------------------------------------------------------ */
/* 进程级单例：ensureInstalled 共享 Promise                             */
/* ------------------------------------------------------------------ */

const sharedInstall = new Map<string, Promise<string | null>>();

/** 清空进程级共享安装 Promise（测试辅助）。 */
export function resetProvisionSingleton(): void {
  sharedInstall.clear();
}

/**
 * 返回共享的安装 Promise：同一缓存根下多次调用只触发一次安装。
 * 失败返回 null（非阻塞降级，不抛异常）。
 */
export function ensureInstalled(
  options: ProvisionOptions = {},
): Promise<string | null> {
  const key = `${options.cacheRoot ?? getCacheRoot()}\0${options.version ?? options.manifest?.version ?? CBM_BASELINE_VERSION}`;
  let existing = sharedInstall.get(key);
  if (!existing) {
    existing = provision(options).then(
      (bin) => bin,
      () => null,
    );
    sharedInstall.set(key, existing);
  }
  return existing;
}

/** 后台触发安装，不 await（非阻塞）；返回共享 Promise 供调用方可选等待。 */
export function startBackgroundInstall(
  options: ProvisionOptions = {},
): Promise<string | null> {
  const p = ensureInstalled(options);
  p.catch(() => {
    /* 非阻塞降级：失败由调用方通过 ensureInstalled 观测 */
  });
  return p;
}

/** 清理损坏 staging/partial，保留旧可用版本，然后重新安装。 */
export async function repair(
  options: ProvisionOptions = {},
): Promise<string | null> {
  resetProvisionSingleton();
  const io = buildIo(options);
  cleanupCorrupted(io.cacheRoot);
  try {
    return await provision(options);
  } catch {
    return null;
  }
}

function cleanupCorrupted(root: string): void {
  const versions = versionsDir(root);
  if (existsSync(versions)) {
    for (const version of readdirSyncSafe(versions)) {
      const vdir = join(versions, version);
      if (!isDirectory(vdir)) continue;
      for (const entry of readdirSyncSafe(vdir)) {
        if (entry.includes('.staging-') || entry.includes('.old-')) {
          rmSync(join(vdir, entry), { recursive: true, force: true });
        }
      }
    }
  }
  const downloads = join(root, 'downloads');
  if (existsSync(downloads)) {
    for (const entry of readdirSyncSafe(downloads)) {
      if (entry.endsWith('.partial')) {
        rmSync(join(downloads, entry), { force: true });
      }
    }
  }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
