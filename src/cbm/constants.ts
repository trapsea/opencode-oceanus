import type {
  CbmArch,
  CbmArchToken,
  CbmOs,
  CbmOsToken,
  CbmPlatform,
} from './types';

/**
 * codebase-memory-mcp（CBM）平台常量与映射契约。
 *
 * canonical 归档命名复用官方安装脚本的平台规则：
 *   - OS token：macos / linux / windows
 *   - 架构 token：arm64 / amd64（Node 内部仍用 darwin/linux/win32、arm64/x64；
 *     同时接受 aarch64、x86_64 作为 normalize 输入别名）
 *   - 0.10.x 的 UI 内建于每个平台唯一归档，不强制独立 `-ui-` 归档。
 *
 * 这里只定义纯函数映射，不做任何网络或文件 IO，便于跨平台注入测试。
 */

/** 基线版本号（不含 `v` 前缀）。计划基线为官方当前支持的 v0.10.8。 */
export const CBM_BASELINE_VERSION = '0.10.8';

/** GitHub release tag 前缀。 */
export const CBM_RELEASE_TAG_PREFIX = 'v';

/** 官方 GitHub release 下载基址。 */
export const CBM_RELEASE_BASE_URL =
  'https://github.com/DeusData/codebase-memory-mcp/releases/download';

/** 二进制基础名（Windows 追加 `.exe`）。 */
export const CBM_BINARY_NAME = 'codebase-memory-mcp';

/** 缓存根目录名（位于 opencode-oceanus 缓存之下）。 */
export const CBM_CACHE_ROOT_NAME = 'codebase-memory-mcp';

/** manifest 解析的原始字节大小上限。 */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/** 归档字节大小上限（防伪超大归档）。 */
export const MAX_MANIFEST_ARCHIVE_SIZE_BYTES = 512 * 1024 * 1024;

/** SHA-256 的规范格式：64 位小写十六进制。 */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** UI 默认监听地址与端口。 */
export const DEFAULT_UI_HOST = '127.0.0.1';
export const DEFAULT_UI_PORT = 9749;

/**
 * 内置 v0.10.8 六平台 SHA-256（canonical 官方发布值）。
 * 键为 {@link getPlatformKey} 输出的平台键（如 `linux-x64`）。
 * SHA-256 必须随插件版本内置；网络只提供归档，不能替换校验信任根。
 */
export const CBM_BUILTIN_MANIFEST_SHA256: Record<string, string> = {
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

const OS_TOKEN_MAP: Record<CbmOs, CbmOsToken> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'windows',
};

const ARCH_TOKEN_MAP: Record<CbmArch, CbmArchToken> = {
  arm64: 'arm64',
  x64: 'amd64',
};

const ARCHIVE_EXT_MAP: Record<CbmOs, 'tar.gz' | 'zip'> = {
  darwin: 'tar.gz',
  linux: 'tar.gz',
  win32: 'zip',
};

/** 平台归一化失败时的错误类型。 */
export class CbmPlatformError extends Error {
  constructor(
    public readonly kind: 'unsupported_os' | 'unsupported_arch',
    value: string,
  ) {
    super(`unsupported CBM platform: ${kind}=${value}`);
    this.name = 'CbmPlatformError';
  }
}

/** 把任意 OS 输入归一化为 canonical CbmOs，未知则抛错。 */
function normalizeOs(input: string): CbmOs {
  switch (input) {
    case 'darwin':
    case 'macos':
    case 'osx':
      return 'darwin';
    case 'linux':
      return 'linux';
    case 'win32':
    case 'windows':
    case 'win':
    case 'cygwin':
    case 'mingw':
      return 'win32';
    default:
      throw new CbmPlatformError('unsupported_os', input);
  }
}

/** 把任意架构输入归一化为 canonical CbmArch，未知则抛错。 */
function normalizeArch(input: string): CbmArch {
  switch (input) {
    case 'x64':
    case 'amd64':
    case 'x86_64':
      return 'x64';
    case 'arm64':
    case 'aarch64':
      return 'arm64';
    default:
      throw new CbmPlatformError('unsupported_arch', input);
  }
}

/**
 * 解析 canonical CBM 平台。默认读取当前 `process.platform`/`process.arch`，
 * 支持显式注入以覆盖 macOS/Linux/Windows 与 arm64/x64 的全部夹具。
 */
export function resolveCbmPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): CbmPlatform {
  const os = normalizeOs(platform);
  const normArch = normalizeArch(arch);
  const osToken = OS_TOKEN_MAP[os];
  const archToken = ARCH_TOKEN_MAP[normArch];
  const archiveExt = ARCHIVE_EXT_MAP[os];
  const binaryName = os === 'win32' ? `${CBM_BINARY_NAME}.exe` : CBM_BINARY_NAME;
  return {
    os,
    arch: normArch,
    osToken,
    archToken,
    binaryName,
    archiveExt,
    archiveName: `${CBM_BINARY_NAME}-${osToken}-${archToken}.${archiveExt}`,
  };
}

/** canonical 平台键，如 `linux-x64`，用于缓存目录隔离与 manifest 命名。 */
export function getPlatformKey(platform: Pick<CbmPlatform, 'os' | 'arch'>): string {
  return `${platform.os}-${platform.arch}`;
}
