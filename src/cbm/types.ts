/**
 * codebase-memory-mcp（CBM）核心的共享类型定义。
 *
 * 本模块刻意不依赖 `@opencode-ai/plugin`，只暴露纯 TS 类型与常量，
 * 供原生 v2 Tool wiring / MCP 注入 / 自动安装（provision）直接消费。
 */

/** CBM 支持的 canonical Node 平台（process.platform）。 */
export type CbmOs = 'darwin' | 'linux' | 'win32';

/** CBM 支持的 canonical Node 架构（process.arch）。 */
export type CbmArch = 'arm64' | 'x64';

/** 归档文件名中使用的 OS token（复用官方安装脚本的命名规则）。 */
export type CbmOsToken = 'macos' | 'linux' | 'windows';

/** 归档文件名中使用的架构 token。 */
export type CbmArchToken = 'arm64' | 'amd64';

/** 归一化后的 CBM 平台记录。 */
export interface CbmPlatform {
  /** canonical OS（darwin/linux/win32）。 */
  os: CbmOs;
  /** canonical 架构（arm64/x64）。 */
  arch: CbmArch;
  /** 归档 OS token。 */
  osToken: CbmOsToken;
  /** 归档架构 token。 */
  archToken: CbmArchToken;
  /** 归档内二进制文件名（Windows 带 `.exe`）。 */
  binaryName: string;
  /** 归档扩展名：`tar.gz`（Unix）或 `zip`（Windows）。 */
  archiveExt: 'tar.gz' | 'zip';
  /** canonical 归档文件名。0.10.x 的 UI 内建于该唯一归档，不强制 `-ui-` 后缀。 */
  archiveName: string;
}

/** 可选的官方 Sigstore/SLSA 验证引用（不作为信任根，仅作可验证依据）。 */
export interface CbmSigstoreRef {
  /** Sigstore bundle 下载地址。 */
  bundleUrl: string;
  /** Sigstore 证书下载地址。 */
  certificateUrl: string;
}

/**
 * 内置 release manifest。SHA-256 必须随插件版本内置，网络只提供归档；
 * manifest 本身只记录归档元数据，不能充当运行时信任根。
 */
export interface CbmReleaseManifest {
  /** 版本号（不含 `v` 前缀），如 `0.10.8`。 */
  version: string;
  /** canonical 平台键，如 `linux-x64`。 */
  platform: string;
  /** canonical 归档文件名。 */
  archive: string;
  /** 官方 GitHub release 下载地址（必须 HTTPS）。 */
  url: string;
  /** 归档 SHA-256（64 位小写十六进制）。 */
  sha256: string;
  /** 归档内二进制相对路径（不含绝对/`..`）。 */
  binaryPath: string;
  /** 0.10.x 的 UI 内建于该归档。 */
  uiBuiltIn: boolean;
  /** 归档字节大小（可选，用于超限防护）。 */
  size?: number;
  /** 可选的官方 Sigstore/SLSA 验证引用。 */
  sigstore?: CbmSigstoreRef;
}

/** manifest 解析失败的错误码。 */
export type ManifestValidationErrorCode =
  | 'missing_field'
  | 'invalid_sha256'
  | 'oversize'
  | 'conflict_digest'
  | 'invalid_url'
  | 'invalid_json'
  | 'unsafe_path';
