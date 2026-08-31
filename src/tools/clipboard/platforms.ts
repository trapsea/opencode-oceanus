/**
 * 剪贴板图片读取平台策略表（clipboard-image-observer-workflow §3.1 / §3.2）。
 *
 * 设计原则：
 * - 不按 platform 猜测，按「环境变量就绪 + 工具存在于 PATH」逐级探测；
 * - 零第三方下载：只用系统自带工具（wl-paste / xclip / powershell.exe / osascript）；
 * - 任何分支不抛异常，fail-open：以 `{kind:'no-image'|'no-tool'}` 结构化结果返回；
 * - 全部依赖（spawn / env / 文件读取 / 存在性探测）可注入，便于 mock 单测。
 *
 * 探测顺序：
 * 1. `WAYLAND_DISPLAY` 存在且 `wl-paste` 可用 → `wl-paste -t image/png`（空则 `-t image/bmp`）
 * 2. `DISPLAY` 存在且 `xclip` 可用 → `xclip -selection clipboard -t image/png -o`
 * 3. WSL（/proc/version 含 microsoft 或 `WSL_DISTRO_NAME` 存在）且 `powershell.exe` 可用
 * 4. `process.platform === 'win32'` → powershell.exe
 * 5. `process.platform === 'darwin'` → osascript JXA（ObjC 桥读 NSPasteboard）
 *
 * 格式归一化：PNG 直接返回；BMP 用纯 JS 解码转 PNG（24/32 位无压缩 + BI_BITFIELDS），
 * 解码失败则原样返回 .bmp 并附注说明。运行时某分支失败自动落到下一分支（如 WSLg
 * 掉线后落到 powershell interop），全部失败才回 no-image / no-tool。
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// ─────────────────────────── 类型契约 ───────────────────────────

/** 可用的剪贴板读取策略（按探测顺序）；'none' 表示全部探测失败。 */
export type ClipboardStrategy =
  | 'wayland'
  | 'x11'
  | 'wsl-powershell'
  | 'win32-powershell'
  | 'darwin-osascript';

/** 二进制安全的 spawn 结果（stdout 保持原始字节，避免 UTF-8 解码破坏图片数据）。 */
export interface SpawnBinResult {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

/** spawn 抽象：参数数组模式、绝不启用 shell；二进制不存在时 reject（ENOENT）。 */
export type SpawnBinFn = (
  file: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<SpawnBinResult>;

/** 剪贴板读取结果：ok 携带字节与目标扩展名；其余为结构化失败（不抛异常）。 */
export type ClipboardReadResult =
  | {
      kind: 'ok';
      bytes: Uint8Array;
      ext: 'png' | 'bmp';
      strategy: ClipboardStrategy;
      /** 例如：BMP 无法转换、已保存原件的说明。 */
      note?: string;
    }
  | { kind: 'no-image'; message: string }
  | { kind: 'no-tool'; message: string };

// ─────────────────────────── 默认 spawn（跨 Bun / Node） ───────────────────────────

const DEFAULT_SPAWN_TIMEOUT_MS = 8000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 默认二进制 spawn：收集原始 stdout 字节，带超时兜底，spawn 失败（ENOENT 等）reject。 */
export function nodeSpawnBin(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<SpawnBinResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = nodeSpawn(file, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

// ─────────────────────────── 平台探测（纯函数） ───────────────────────────

export interface DetectOptions {
  platform?: NodeJS.Platform;
  /** WSL 判定结果（默认由 detectIsWsl 推导；纯函数测试直接注入）。 */
  isWsl?: boolean;
}

const hasValue = (v: string | undefined): boolean => typeof v === 'string' && v.length > 0;

/**
 * 按策略表顺序返回所有可用策略（前置条件满足 + 工具存在）。
 * 顺序失败时（如 WSLg 掉线）readClipboardImage 会沿链路继续尝试下一个。
 */
export function detectPlatformChain(
  env: Record<string, string | undefined>,
  existsFn: (bin: string) => boolean,
  opts: DetectOptions = {},
): ClipboardStrategy[] {
  const platform = opts.platform ?? process.platform;
  const chain: ClipboardStrategy[] = [];
  if (hasValue(env.WAYLAND_DISPLAY) && existsFn('wl-paste')) chain.push('wayland');
  if (hasValue(env.DISPLAY) && existsFn('xclip')) chain.push('x11');
  if (opts.isWsl === true && existsFn('powershell.exe')) chain.push('wsl-powershell');
  if (platform === 'win32' && existsFn('powershell.exe')) chain.push('win32-powershell');
  if (platform === 'darwin' && existsFn('osascript')) chain.push('darwin-osascript');
  return chain;
}

/** 策略表首选策略；全部不满足返回 'none'（fail-open 入口）。 */
export function detectPlatform(
  env: Record<string, string | undefined>,
  existsFn: (bin: string) => boolean,
  opts: DetectOptions = {},
): ClipboardStrategy | 'none' {
  return detectPlatformChain(env, existsFn, opts)[0] ?? 'none';
}

// ─────────────────────────── 各分支读取命令 ───────────────────────────

/**
 * Windows PowerShell 分支脚本（WSL interop 与 win32 共用）。
 * - `-NoProfile` 必加（避免 profile 拖慢/污染输出）；`-STA` 保证剪贴板可访问。
 * - 退出码：0 = 已输出 base64 PNG；3 = 剪贴板无图；4 = 取剪贴板失败（headless 等）。
 * - PNG 以 base64（纯 ASCII）写 stdout：不受 PowerShell 5.1 GBK 代码页影响，
 *   也免去 WSL↔Windows 路径映射（无需 wslpath / 临时文件）。
 */
const POWERSHELL_SCRIPT =
  'Add-Type -AssemblyName System.Windows.Forms;' +
  '$img=[Windows.Forms.Clipboard]::GetImage();' +
  'if($null -eq $img){exit 3}' +
  'try{$ms=New-Object System.IO.MemoryStream;' +
  '$img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);' +
  '[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()));exit 0}' +
  'catch{exit 4}';

/**
 * macOS 分支：osascript JXA + ObjC 桥读 NSPasteboard（不依赖 brew 的 pngpaste）。
 * 优先取 PNG 类型；缺失时取 TIFF 并用 NSBitmapImageRep 转 PNG。退出码语义同上。
 */
const OSASCRIPT_JXA = [
  'ObjC.import("AppKit");',
  'ObjC.import("stdlib");',
  'const pb=$.NSPasteboard.generalPasteboard;',
  'const png=pb.dataForType($.NSPasteboardTypePNG);',
  'if(png&&Number(png.length)>0){console.log(String(png.base64EncodedStringWithOptions(0)));$.exit(0);}',
  'const tiff=pb.dataForType($.NSPasteboardTypeTIFF);',
  'if(tiff&&Number(tiff.length)>0){',
  'const rep=$.NSBitmapImageRep.imageRepWithData(tiff);',
  'if(rep){const out=rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$());',
  'if(out&&Number(out.length)>0){console.log(String(out.base64EncodedStringWithOptions(0)));$.exit(0);}}',
  '}',
  '$.exit(3);',
].join('\n');

type StrategyOutcome =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'empty' }
  | { kind: 'failed'; error: string };

/** wl-paste / xclip 分支：先请求 image/png，空/失败再请求 image/bmp。 */
async function readWithMimes(
  spawnBin: SpawnBinFn,
  file: string,
  argsFor: (mime: string) => string[],
): Promise<StrategyOutcome> {
  for (const mime of ['image/png', 'image/bmp']) {
    let res: SpawnBinResult;
    try {
      res = await spawnBin(file, argsFor(mime));
    } catch (e) {
      return { kind: 'failed', error: `${file}: ${messageOf(e)}` };
    }
    if (res.code === 0 && res.stdout.length > 0) return { kind: 'bytes', bytes: res.stdout };
  }
  return { kind: 'empty' };
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

async function readBase64Tool(
  spawnBin: SpawnBinFn,
  file: string,
  args: string[],
  label: string,
): Promise<StrategyOutcome> {
  let res: SpawnBinResult;
  try {
    res = await spawnBin(file, args);
  } catch (e) {
    return { kind: 'failed', error: `${label}: ${messageOf(e)}` };
  }
  if (res.code === 3) return { kind: 'empty' };
  if (res.code !== 0) {
    return { kind: 'failed', error: `${label} 退出码 ${res.code}: ${res.stderr.slice(0, 200)}` };
  }
  const b64 = Buffer.from(res.stdout).toString('ascii').replace(/\s+/g, '');
  if (!b64) return { kind: 'empty' };
  if (!BASE64_RE.test(b64)) return { kind: 'failed', error: `${label} 输出不是合法 base64` };
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length === 0) return { kind: 'failed', error: `${label} base64 解码结果为空` };
  return { kind: 'bytes', bytes };
}

async function runStrategy(
  strategy: ClipboardStrategy,
  spawnBin: SpawnBinFn,
): Promise<StrategyOutcome> {
  switch (strategy) {
    case 'wayland':
      return readWithMimes(spawnBin, 'wl-paste', (mime) => ['-t', mime]);
    case 'x11':
      return readWithMimes(spawnBin, 'xclip', (mime) => [
        '-selection',
        'clipboard',
        '-t',
        mime,
        '-o',
      ]);
    case 'wsl-powershell':
    case 'win32-powershell':
      return readBase64Tool(
        spawnBin,
        'powershell.exe',
        ['-NoProfile', '-STA', '-Command', POWERSHELL_SCRIPT],
        'powershell',
      );
    case 'darwin-osascript':
      return readBase64Tool(
        spawnBin,
        'osascript',
        ['-l', 'JavaScript', '-e', OSASCRIPT_JXA],
        'osascript',
      );
  }
}

// ─────────────────────────── 图片分类与 BMP→PNG 转换 ───────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_MAGIC[i]) return false;
  return true;
}

export function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 54 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

type ClassifiedImage =
  | { kind: 'image'; bytes: Uint8Array; ext: 'png' | 'bmp'; note?: string }
  | { kind: 'unsupported'; message: string };

/** 按魔数分类：PNG 直通；BMP 尝试转 PNG（失败则原样 .bmp + 注明）；其余拒绝。 */
function classifyImage(bytes: Uint8Array): ClassifiedImage {
  if (bytes.length > 64 * 1024 * 1024) {
    return { kind: 'unsupported', message: `剪贴板图片过大（${bytes.length} 字节），已拒绝保存` };
  }
  if (isPng(bytes)) return { kind: 'image', bytes, ext: 'png' };
  if (isBmp(bytes)) {
    const png = convertBmpToPng(bytes);
    if (png) return { kind: 'image', bytes: png, ext: 'png' };
    return {
      kind: 'image',
      bytes,
      ext: 'bmp',
      note: '原始 BMP 无法自动转换为 PNG，已保存 BMP 原件（observer 的 read 通常也能读 BMP）',
    };
  }
  return { kind: 'unsupported', message: '剪贴板图片格式不受支持（仅支持 PNG/BMP）' };
}

const trailingZeros = (v: number): number => {
  let n = 0;
  while (n < 32 && ((v >>> n) & 1) === 0) n++;
  return n;
};
const popcount = (v: number): number => {
  let c = 0;
  let x = v >>> 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

interface ChannelMask {
  shift: number;
  bits: number;
}

/** 仅接受连续位掩码；不连续（异常布局）返回 null → 转换失败落回保存 BMP 原件。 */
function channelMask(mask: number): ChannelMask | null {
  const m = mask >>> 0;
  if (m === 0) return null;
  const shift = trailingZeros(m);
  const bits = popcount(m);
  const unit = bits >= 32 ? 0xffffffff : ((1 << bits) - 1) >>> 0;
  if (((unit << shift) >>> 0) !== m) return null;
  return { shift, bits };
}

function extractChannel(px: number, mask: ChannelMask): number {
  const unit = mask.bits >= 32 ? 0xffffffff : (1 << mask.bits) - 1;
  const v = (px >>> mask.shift) & unit;
  if (mask.bits >= 8) return v & 0xff;
  return Math.round((v * 255) / unit);
}

export interface BmpDecoded {
  width: number;
  height: number;
  channels: 3 | 4;
  /** 像素数据（自上而下逐行、行内 RGB(A) 序）。 */
  data: Uint8Array;
}

/**
 * 纯 JS BMP 解码：24/32 位、无压缩（BI_RGB）与 BI_BITFIELDS（连续掩码）。
 * 仅支持正/负高度（负 = top-down）；其余布局返回 null（调用方保存原件）。
 */
export function decodeBmp(bytes: Uint8Array): BmpDecoded | null {
  if (bytes.length < 54) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = dv.getUint32(10, true);
  const headerSize = dv.getUint32(14, true);
  if (headerSize < 40) return null;
  const width = dv.getInt32(18, true);
  const rawHeight = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  if (bpp !== 24 && bpp !== 32) return null;
  if (compression !== 0 && compression !== 3) return null;
  if (width <= 0 || rawHeight === 0) return null;
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  if (width > 20000 || height > 20000 || width * height > 50_000_000) return null;

  let redMask = 0x00ff0000;
  let greenMask = 0x0000ff00;
  let blueMask = 0x000000ff;
  let alphaMask = 0;
  if (compression === 3) {
    if (bpp !== 32) return null;
    // BI_BITFIELDS：V4/V5 头内含掩码（DIB 偏移 40/44/48/52），BITMAPINFOHEADER(40)
    // 则紧跟其后 —— 两种布局下文件偏移 54/58/62(/66) 等价。
    if (bytes.length < 66) return null;
    redMask = dv.getUint32(54, true) || redMask;
    greenMask = dv.getUint32(58, true) || greenMask;
    blueMask = dv.getUint32(62, true) || blueMask;
    if (headerSize >= 56 && bytes.length >= 70) alphaMask = dv.getUint32(66, true);
  }
  const red = channelMask(redMask);
  const green = channelMask(greenMask);
  const blue = channelMask(blueMask);
  const alpha = alphaMask ? channelMask(alphaMask) : null;
  if (!red || !green || !blue || (alphaMask && !alpha)) return null;

  const channels: 3 | 4 = bpp === 24 ? 3 : 4;
  const stride = (((width * bpp + 31) >> 5) << 2);
  if (dataOffset + stride * height > bytes.length) return null;

  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    let src = dataOffset + srcRow * stride;
    let dst = y * width * channels;
    for (let x = 0; x < width; x++) {
      if (bpp === 24) {
        // 无压缩 24 位固定 BGR 三元组
        data[dst] = bytes[src + 2];
        data[dst + 1] = bytes[src + 1];
        data[dst + 2] = bytes[src];
        src += 3;
      } else {
        const px = dv.getUint32(src, true);
        data[dst] = extractChannel(px, red);
        data[dst + 1] = extractChannel(px, green);
        data[dst + 2] = extractChannel(px, blue);
        data[dst + 3] = alpha ? extractChannel(px, alpha) : 255;
        src += 4;
      }
      dst += channels;
    }
  }
  return { width, height, channels, data };
}

// ─────────────────────────── PNG 编码（zlib + CRC32，零依赖） ───────────────────────────

const PNG_SIGNATURE = Buffer.from(PNG_MAGIC);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  out.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return out;
}

/** 纯 JS PNG 编码：8 位色深、无隔行，channels 3 → Truecolor(2)，4 → RGBA(6)。 */
export function encodePng(width: number, height: number, channels: 3 | 4, data: Uint8Array): Uint8Array {
  if (width <= 0 || height <= 0) throw new Error('PNG 尺寸必须为正');
  if (data.length !== width * height * channels) throw new Error('像素数据长度与尺寸不匹配');
  const colorType = channels === 4 ? 6 : 2;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    raw.set(data.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none
  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/** BMP → PNG；解码或编码失败返回 null（调用方落回保存 BMP 原件）。 */
export function convertBmpToPng(bytes: Uint8Array): Uint8Array | null {
  try {
    const decoded = decodeBmp(bytes);
    if (!decoded) return null;
    return encodePng(decoded.width, decoded.height, decoded.channels, decoded.data);
  } catch {
    return null;
  }
}

// ─────────────────────────── 读取入口 ───────────────────────────

export interface ReadClipboardDeps {
  /** 二进制 spawn 注入（默认 nodeSpawnBin）。 */
  spawnBin?: SpawnBinFn;
  /** 环境变量注入（默认 process.env）。 */
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** WSL 判定注入（默认：linux + WSL_DISTRO_NAME / /proc/version 含 microsoft）。 */
  isWsl?: () => Promise<boolean>;
  /** 文本文件读取注入（默认 node:fs/promises，用于 /proc/version）。 */
  readFileText?: (p: string) => Promise<string>;
  /** 二进制存在性探测注入（默认用 spawnBin 跑探针命令，spawn 失败即视为不可用）。 */
  exists?: (bin: string, spawnBin: SpawnBinFn) => Promise<boolean>;
}

const PROBE_ARGS: Record<string, string[]> = {
  'wl-paste': ['--version'],
  xclip: ['-version'],
  'powershell.exe': ['-NoProfile', '-Command', 'exit 0'],
  osascript: ['-l', 'JavaScript', '-e', '0'],
};

/** 默认存在性探测：探针命令能完成 spawn（退出码任意）即视为存在。 */
async function defaultExists(bin: string, spawnBin: SpawnBinFn): Promise<boolean> {
  try {
    await spawnBin(bin, PROBE_ARGS[bin] ?? ['--version'], { timeoutMs: 5000 });
    return true;
  } catch {
    // ENOENT / EACCES / 其它 spawn 失败一律视为不可用 → fail-open 落到下一策略
    return false;
  }
}

async function detectIsWsl(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  readFileText: (p: string) => Promise<string>,
): Promise<boolean> {
  if (platform !== 'linux') return false;
  if (hasValue(env.WSL_DISTRO_NAME)) return true;
  try {
    return /microsoft/i.test(await readFileText('/proc/version'));
  } catch {
    return false;
  }
}

const defaultReadFileText = (p: string): Promise<string> => readFile(p, 'utf8');

/**
 * 读取剪贴板图片（§3.1 平台策略表）。
 * 沿可用策略链依次尝试：任一分支拿到图片字节即分类返回（PNG 直通 / BMP 转 PNG）；
 * 全部失败时：有分支明确表示「剪贴板无图」→ no-image，否则 no-tool（fail-open）。
 */
export async function readClipboardImage(deps: ReadClipboardDeps = {}): Promise<ClipboardReadResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const spawnBin = deps.spawnBin ?? nodeSpawnBin;
  const exists = deps.exists ?? defaultExists;
  const isWsl = await (deps.isWsl ?? (() => detectIsWsl(env, platform, deps.readFileText ?? defaultReadFileText)))();

  // 只探测前置条件满足的二进制，避免无谓 spawn。
  const wanted: string[] = [];
  if (hasValue(env.WAYLAND_DISPLAY)) wanted.push('wl-paste');
  if (hasValue(env.DISPLAY)) wanted.push('xclip');
  if (isWsl || platform === 'win32') wanted.push('powershell.exe');
  if (platform === 'darwin') wanted.push('osascript');
  const probes = new Map<string, boolean>();
  for (const bin of [...new Set(wanted)]) {
    probes.set(bin, await exists(bin, spawnBin));
  }

  const chain = detectPlatformChain(env, (bin) => probes.get(bin) === true, { platform, isWsl });
  let sawEmpty = false;
  for (const strategy of chain) {
    const outcome = await runStrategy(strategy, spawnBin);
    if (outcome.kind === 'bytes' && outcome.bytes.length > 0) {
      const classified = classifyImage(outcome.bytes);
      if (classified.kind === 'image') {
        return classified.note
          ? { kind: 'ok', bytes: classified.bytes, ext: classified.ext, strategy, note: classified.note }
          : { kind: 'ok', bytes: classified.bytes, ext: classified.ext, strategy };
      }
      return { kind: 'no-image', message: classified.message };
    }
    if (outcome.kind === 'empty') sawEmpty = true;
    // failed → 继续尝试下一策略（如 WSLg 掉线后落到 powershell interop）
  }
  if (sawEmpty) return { kind: 'no-image', message: '剪贴板中没有图片' };
  return {
    kind: 'no-tool',
    message: '当前环境无法读取剪贴板（未找到可用的剪贴板工具），请让用户保存图片并告知路径',
  };
}
