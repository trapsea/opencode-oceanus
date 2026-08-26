import {
  CBM_BASELINE_VERSION,
  CBM_RELEASE_BASE_URL,
  CBM_RELEASE_TAG_PREFIX,
  MAX_MANIFEST_ARCHIVE_SIZE_BYTES,
  MAX_MANIFEST_BYTES,
  SHA256_HEX_PATTERN,
  getPlatformKey,
} from './constants';
import type {
  CbmPlatform,
  CbmReleaseManifest,
  ManifestValidationErrorCode,
} from './types';

/**
 * codebase-memory-mcp（CBM）内置 SHA-256 manifest 契约。
 *
 * 信任模型：SHA-256 必须随插件版本内置到 platform manifest，网络只提供归档，
 * 不能把未验证的远程 `checksums.txt` 当作唯一信任根。本模块负责：
 *   - 由 canonical 平台映射派生 archive / URL / binaryPath / uiBuiltIn；
 *   - 解析并校验注入/内置的 manifest：限制大小、校验 64 位小写十六进制
 *     sha256、URL 必须 HTTPS、拒绝同名冲突 digest、拒绝不安全的相对路径。
 *
 * 测试通过注入 manifest 与下载 URL，不访问真实网络。
 */

const REQUIRED_FIELDS = [
  'version',
  'platform',
  'archive',
  'url',
  'sha256',
  'binaryPath',
  'uiBuiltIn',
] as const;

/** 由 canonical 平台派生 GitHub release 下载 URL。 */
export function buildManifestUrl(platform: CbmPlatform): string {
  return `${CBM_RELEASE_BASE_URL}/${CBM_RELEASE_TAG_PREFIX}${CBM_BASELINE_VERSION}/${platform.archiveName}`;
}

/** 构造内置 canonical manifest。sha256 为随插件版本内置的校验和。 */
export function createCanonicalManifest(
  platform: CbmPlatform,
  sha256: string,
  overrides: Partial<CbmReleaseManifest> = {},
): CbmReleaseManifest {
  const version = overrides.version ?? CBM_BASELINE_VERSION;
  return {
    version,
    platform: getPlatformKey(platform),
    archive: platform.archiveName,
    url: `${CBM_RELEASE_BASE_URL}/${CBM_RELEASE_TAG_PREFIX}${version}/${platform.archiveName}`,
    sha256,
    binaryPath: platform.binaryName,
    uiBuiltIn: true,
    ...overrides,
  };
}

/** 解析选项。 */
export interface ParseManifestOptions {
  /** 原始字节大小上限，默认 {@link MAX_MANIFEST_BYTES}。 */
  maxBytes?: number;
  /** 受信任的内置 digest；同名归档的 sha256 与之冲突时拒绝。 */
  trusted?: { archive: string; sha256: string };
}

export type ParseManifestResult =
  | { ok: true; manifest: CbmReleaseManifest }
  | { ok: false; code: ManifestValidationErrorCode; message: string };

function fail(code: ManifestValidationErrorCode, message: string): ParseManifestResult {
  return { ok: false, code, message };
}

/** 校验二进制相对路径安全：拒绝绝对路径（含 Windows 盘符）与 `..` 越界。 */
export function isUnsafeRelativePath(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('~')) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  const segments = p.split(/[\\/]/);
  return segments.includes('..');
}

/** 解析并校验一份 manifest JSON 字符串。 */
export function parseManifest(
  raw: string,
  options: ParseManifestOptions = {},
): ParseManifestResult {
  const maxBytes = options.maxBytes ?? MAX_MANIFEST_BYTES;
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return fail('oversize', `manifest exceeds ${maxBytes} bytes`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail('invalid_json', 'manifest is not valid JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return fail('missing_field', 'manifest must be a JSON object');
  }
  const m = data as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (m[field] === undefined) {
      return fail('missing_field', `manifest missing required field: ${field}`);
    }
  }

  for (const field of ['version', 'platform', 'archive', 'url', 'sha256', 'binaryPath']) {
    if (typeof m[field] !== 'string' || (m[field] as string).length === 0) {
      return fail('missing_field', `manifest field must be a non-empty string: ${field}`);
    }
  }
  if (typeof m.uiBuiltIn !== 'boolean') {
    return fail('missing_field', 'manifest field must be boolean: uiBuiltIn');
  }

  const sha256 = m.sha256 as string;
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    return fail('invalid_sha256', 'sha256 must be 64 lowercase hex chars');
  }

  const url = m.url as string;
  if (!/^https:\/\//i.test(url)) {
    return fail('invalid_url', 'archive URL must be HTTPS');
  }

  const binaryPath = m.binaryPath as string;
  if (isUnsafeRelativePath(binaryPath)) {
    return fail('unsafe_path', `unsafe binary relative path: ${binaryPath}`);
  }

  const size = typeof m.size === 'number' ? m.size : undefined;
  if (size !== undefined && size > MAX_MANIFEST_ARCHIVE_SIZE_BYTES) {
    return fail('oversize', `archive size ${size} exceeds cap`);
  }

  if (options.trusted && m.archive === options.trusted.archive) {
    if (sha256 !== options.trusted.sha256) {
      return fail(
        'conflict_digest',
        `sha256 for ${m.archive} conflicts with trusted digest`,
      );
    }
  }

  const manifest: CbmReleaseManifest = {
    version: m.version as string,
    platform: m.platform as string,
    archive: m.archive as string,
    url,
    sha256,
    binaryPath,
    uiBuiltIn: m.uiBuiltIn as boolean,
  };
  if (size !== undefined) manifest.size = size;
  if (m.sigstore !== undefined && typeof m.sigstore === 'object' && m.sigstore !== null) {
    const s = m.sigstore as Record<string, unknown>;
    if (typeof s.bundleUrl === 'string' && typeof s.certificateUrl === 'string') {
      manifest.sigstore = {
        bundleUrl: s.bundleUrl,
        certificateUrl: s.certificateUrl,
      };
    }
  }
  return { ok: true, manifest };
}
