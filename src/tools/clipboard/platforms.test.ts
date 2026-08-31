import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import {
  convertBmpToPng,
  decodeBmp,
  detectPlatform,
  detectPlatformChain,
  encodePng,
  isBmp,
  isPng,
  readClipboardImage,
  type SpawnBinFn,
  type SpawnBinResult,
} from './platforms';

/**
 * 剪贴板平台策略表单测（设计文档验收 #4）：
 * wl-paste / xclip / powershell.exe（WSL 与 win32）/ osascript 各分支均以
 * mock env + mock spawn 驱动，不访问真实剪贴板、不依赖系统工具存在。
 */

const PNG_FIXTURE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([1, 2, 3, 4, 5, 6]),
]);

// ─────────────────────────── mock spawn ───────────────────────────

type ArgsMatcher = string[] | ((args: string[]) => boolean);

interface SpawnRule {
  file: string;
  args?: ArgsMatcher;
  stdout?: Uint8Array | string;
  code?: number;
  error?: Error;
}

const matches = (m: ArgsMatcher | undefined, args: string[]): boolean =>
  m === undefined
    ? true
    : typeof m === 'function'
      ? m(args)
      : JSON.stringify(m) === JSON.stringify(args);

/** 按 (file, args) 规则表响应的 fake spawn；未命中规则返回 code 1 + 空 stdout。 */
function spawnFn(rules: SpawnRule[], calls?: { file: string; args: string[] }[]): SpawnBinFn {
  return async (file, args) => {
    calls?.push({ file, args });
    const rule = rules.find((r) => r.file === file && matches(r.args, args));
    if (!rule) return { code: 1, stdout: new Uint8Array(0), stderr: `no rule: ${file} ${JSON.stringify(args)}` };
    if (rule.error) throw rule.error;
    const stdout =
      typeof rule.stdout === 'string' ? Buffer.from(rule.stdout, 'ascii') : (rule.stdout ?? new Uint8Array(0));
    return { code: rule.code ?? 0, stdout, stderr: '' } satisfies SpawnBinResult;
  };
}

const enoent = (): Error => Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });

// ─────────────────────────── BMP fixture ───────────────────────────

interface BmpOpts {
  width: number;
  height: number;
  bpp: 24 | 32;
  topDown?: boolean;
  compression?: 0 | 1 | 3;
  masks?: [number, number, number];
  alphaMask?: number;
  /** 每像素写入的 32 位值（bpp 32 时用）。 */
  pixel?: number;
  truncatePixels?: boolean;
}

/**
 * 构造最小 BMP：BITMAPINFOHEADER(40)（BI_BITFIELDS 时按需扩展掩码布局）。
 * bpp 24 用 R/G/B 通道字节交替；bpp 32 写 pixel 值。
 */
function makeBmp(o: BmpOpts): Buffer {
  const compression = o.compression ?? 0;
  const masks = compression === 3;
  // V3 风格（headerSize 56，alpha 掩码含在头内 DIB 偏移 52）或 INFOHEADER(40)+紧跟 3 掩码
  const headerSize = masks ? (o.alphaMask ? 56 : 40) : 40;
  const extra = masks && !o.alphaMask ? 12 : 0;
  const dataOffset = 14 + headerSize + extra;
  const stride = ((o.width * o.bpp + 31) >> 5) << 2;
  const pixelBytes = stride * o.height;
  const buf = Buffer.alloc(dataOffset + (o.truncatePixels ? Math.floor(pixelBytes / 2) : pixelBytes));
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(dataOffset, 10);
  buf.writeUInt32LE(headerSize, 14);
  buf.writeInt32LE(o.width, 18);
  buf.writeInt32LE(o.topDown ? -o.height : o.height, 22);
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(o.bpp, 28);
  buf.writeUInt32LE(compression, 30);
  buf.writeUInt32LE(pixelBytes, 34);
  if (masks) {
    const [r, g, b] = o.masks ?? [0x00ff0000, 0x0000ff00, 0x000000ff];
    buf.writeUInt32LE(r, 54);
    buf.writeUInt32LE(g, 58);
    buf.writeUInt32LE(b, 62);
    if (o.alphaMask) buf.writeUInt32LE(o.alphaMask, 66);
  }
  const height = o.height;
  for (let row = 0; row < height; row++) {
    const base = dataOffset + row * stride;
    for (let x = 0; x < o.width; x++) {
      if (o.bpp === 24) {
        buf[base + x * 3] = (x * 40 + row * 10) & 0xff; // B
        buf[base + x * 3 + 1] = (x * 50 + row * 20) & 0xff; // G
        buf[base + x * 3 + 2] = (x * 60 + row * 30) & 0xff; // R
      } else {
        buf.writeUInt32LE(o.pixel ?? 0xff102030, base + x * 4);
      }
    }
  }
  return buf;
}

// ─────────────────────────── PNG 解析辅助 ───────────────────────────

function parsePngChunks(png: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  expect(isPng(png)).toBe(true);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let off = 8;
  while (off + 12 <= png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    chunks.push({ type, data: png.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return chunks;
}

// ─────────────────────────── 探测（纯函数） ───────────────────────────

describe('detectPlatform / detectPlatformChain', () => {
  const allExist = () => true;
  const noneExist = () => false;

  test('WAYLAND_DISPLAY + wl-paste → wayland（优先级最高）', () => {
    expect(
      detectPlatform({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, allExist, { platform: 'linux', isWsl: false }),
    ).toBe('wayland');
  });

  test('wl-paste 缺失但 DISPLAY + xclip 就绪 → x11', () => {
    expect(
      detectPlatform({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, (b) => b === 'xclip', {
        platform: 'linux',
        isWsl: false,
      }),
    ).toBe('x11');
  });

  test('WSL + powershell.exe → wsl-powershell（在 x11 之后）', () => {
    const chain = detectPlatformChain({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, allExist, {
      platform: 'linux',
      isWsl: true,
    });
    expect(chain).toEqual(['wayland', 'x11', 'wsl-powershell']);
    expect(detectPlatform({}, allExist, { platform: 'linux', isWsl: true })).toBe('wsl-powershell');
  });

  test('win32 → win32-powershell；darwin → darwin-osascript', () => {
    expect(detectPlatform({}, allExist, { platform: 'win32' })).toBe('win32-powershell');
    expect(detectPlatform({}, allExist, { platform: 'darwin' })).toBe('darwin-osascript');
  });

  test('环境变量缺失或工具不存在 → none（fail-open）', () => {
    expect(detectPlatform({}, noneExist, { platform: 'linux', isWsl: false })).toBe('none');
    expect(detectPlatform({ WAYLAND_DISPLAY: 'wayland-0' }, noneExist, { platform: 'linux', isWsl: false })).toBe('none');
    // win32/darwin 分支同样要求工具存在
    expect(detectPlatform({}, noneExist, { platform: 'win32' })).toBe('none');
    expect(detectPlatform({}, noneExist, { platform: 'darwin' })).toBe('none');
  });
});

// ─────────────────────────── BMP 解码 / PNG 编码 ───────────────────────────

describe('BMP→PNG 纯 JS 转换', () => {
  test('24 位无压缩 bottom-up 解码（含行填充）', () => {
    // width 3 → 每行 9 字节 + 3 字节填充 = 12；像素 B=x*40+row*10, G=x*50+row*20, R=x*60+row*30
    const bmp = makeBmp({ width: 3, height: 2, bpp: 24 });
    const decoded = decodeBmp(bmp);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(3);
    expect(decoded!.height).toBe(2);
    expect(decoded!.channels).toBe(3);
    // bottom-up：文件第 0 行是图像最底行（image y=1）→ data 第二行
    // image (0,1)：R=30, G=20, B=10；image (2,1)：R=120, G=100, B=80
    expect(Array.from(decoded!.data.slice(0, 3))).toEqual([30, 20, 10]);
    expect(Array.from(decoded!.data.slice(15, 18))).toEqual([120, 100, 80]);
  });

  test('32 位 BI_BITFIELDS top-down 解码（含 alpha 掩码）', () => {
    const bmp = makeBmp({
      width: 1,
      height: 1,
      bpp: 32,
      topDown: true,
      compression: 3,
      masks: [0x00ff0000, 0x0000ff00, 0x000000ff],
      alphaMask: 0xff000000,
      pixel: 0xff102030,
    });
    const decoded = decodeBmp(bmp);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!.data)).toEqual([0x10, 0x20, 0x30, 0xff]);
  });

  test('异常布局（RLE 压缩 / 截断 / 非连续掩码）返回 null', () => {
    expect(decodeBmp(makeBmp({ width: 2, height: 2, bpp: 24, compression: 1 }))).toBeNull();
    expect(decodeBmp(makeBmp({ width: 8, height: 8, bpp: 24, truncatePixels: true }))).toBeNull();
    expect(
      decodeBmp(
        makeBmp({
          width: 1,
          height: 1,
          bpp: 32,
          compression: 3,
          masks: [0x00c0c0c0, 0x0000ff00, 0x000000ff], // 非连续红掩码
        }),
      ),
    ).toBeNull();
    expect(decodeBmp(Buffer.from('BM-not-a-bmp'))).toBeNull();
    expect(decodeBmp(PNG_FIXTURE)).toBeNull();
  });

  test('convertBmpToPng 输出结构合法的 PNG（IHDR 尺寸 + IDAT 可解压回像素）', () => {
    const bmp = makeBmp({ width: 3, height: 2, bpp: 24 });
    const png = convertBmpToPng(bmp);
    expect(png).not.toBeNull();
    const chunks = parsePngChunks(png!);
    const ihdr = chunks.find((c) => c.type === 'IHDR')!;
    const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
    expect(dv.getUint32(0)).toBe(3);
    expect(dv.getUint32(4)).toBe(2);
    expect(ihdr.data[9]).toBe(2); // colorType 2 (Truecolor)
    expect(chunks.at(-1)!.type).toBe('IEND');
    const idat = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
    const raw = inflateSync(Buffer.concat(idat));
    // filter byte 0 + 3 像素 × 3 通道，共 2 行
    expect(raw.length).toBe(2 * (3 * 3 + 1));
    expect(raw[0]).toBe(0);
  });

  test('encodePng RGBA → colorType 6', () => {
    const png = encodePng(1, 1, 4, new Uint8Array([1, 2, 3, 4]));
    const ihdr = parsePngChunks(png).find((c) => c.type === 'IHDR')!;
    expect(ihdr.data[9]).toBe(6);
  });

  test('isPng / isBmp 魔数判定', () => {
    expect(isPng(PNG_FIXTURE)).toBe(true);
    expect(isPng(makeBmp({ width: 1, height: 1, bpp: 24 }))).toBe(false);
    expect(isBmp(makeBmp({ width: 1, height: 1, bpp: 24 }))).toBe(true);
    expect(isBmp(PNG_FIXTURE)).toBe(false);
  });
});

// ─────────────────────────── readClipboardImage 各分支 ───────────────────────────

const notWsl = async () => false;

describe('readClipboardImage：wayland（wl-paste）', () => {
  test('image/png 直接命中 → ok png', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const res = await readClipboardImage({
      env: { WAYLAND_DISPLAY: 'wayland-0' },
      platform: 'linux',
      isWsl: notWsl,
      spawnBin: spawnFn(
        [
          { file: 'wl-paste', args: ['--version'] },
          { file: 'wl-paste', args: ['-t', 'image/png'], stdout: PNG_FIXTURE },
        ],
        calls,
      ),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strategy).toBe('wayland');
    expect(res.ext).toBe('png');
    expect(Buffer.from(res.bytes).equals(PNG_FIXTURE)).toBe(true);
    // 探测先行 + 读 PNG 命中后不再读 BMP
    expect(calls.some((c) => c.args.includes('--version'))).toBe(true);
    expect(calls.some((c) => c.args.includes('image/bmp'))).toBe(false);
  });

  test('PNG 空时回落 image/bmp → 转 PNG 成功', async () => {
    const bmp = makeBmp({ width: 4, height: 4, bpp: 24 });
    const res = await readClipboardImage({
      env: { WAYLAND_DISPLAY: 'wayland-0' },
      platform: 'linux',
      isWsl: notWsl,
      spawnBin: spawnFn([
        { file: 'wl-paste', args: ['--version'] },
        { file: 'wl-paste', args: ['-t', 'image/png'], stdout: new Uint8Array(0), code: 1 },
        { file: 'wl-paste', args: ['-t', 'image/bmp'], stdout: bmp },
      ]),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.ext).toBe('png');
    expect(isPng(res.bytes)).toBe(true);
    expect(res.note).toBeUndefined();
  });

  test('BMP 无法解码 → 原样 .bmp + 注明', async () => {
    const badBmp = makeBmp({ width: 2, height: 2, bpp: 24, compression: 1 });
    const res = await readClipboardImage({
      env: { WAYLAND_DISPLAY: 'wayland-0' },
      platform: 'linux',
      isWsl: notWsl,
      spawnBin: spawnFn([
        { file: 'wl-paste', args: ['--version'] },
        { file: 'wl-paste', args: ['-t', 'image/png'], stdout: new Uint8Array(0), code: 1 },
        { file: 'wl-paste', args: ['-t', 'image/bmp'], stdout: badBmp },
      ]),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.ext).toBe('bmp');
    expect(Buffer.from(res.bytes).equals(badBmp)).toBe(true);
    expect(res.note).toContain('BMP');
  });

  test('两个 mime 都为空 → no-image', async () => {
    const res = await readClipboardImage({
      env: { WAYLAND_DISPLAY: 'wayland-0' },
      platform: 'linux',
      isWsl: notWsl,
      spawnBin: spawnFn([
        { file: 'wl-paste', args: ['--version'] },
        { file: 'wl-paste', args: ['-t', 'image/png'] },
        { file: 'wl-paste', args: ['-t', 'image/bmp'] },
      ]),
    });
    expect(res).toEqual({ kind: 'no-image', message: '剪贴板中没有图片' });
  });
});

describe('readClipboardImage：x11（xclip）', () => {
  test('DISPLAY + xclip 读 PNG → ok', async () => {
    const res = await readClipboardImage({
      env: { DISPLAY: ':0' },
      platform: 'linux',
      isWsl: notWsl,
      spawnBin: spawnFn([
        { file: 'xclip', args: ['-version'] },
        { file: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'], stdout: PNG_FIXTURE },
      ]),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strategy).toBe('x11');
    expect(res.ext).toBe('png');
  });
});

describe('readClipboardImage：powershell（WSL 与 win32）', () => {
  const psRules = (): SpawnRule[] => [
    { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'exit 0'] },
    {
      file: 'powershell.exe',
      args: (a) => a[0] === '-NoProfile' && a[1] === '-STA' && a[2] === '-Command',
      stdout: PNG_FIXTURE.toString('base64'),
    },
  ];

  test('WSL：探测 + -NoProfile -STA -Command 读 base64 PNG → ok', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const res = await readClipboardImage({
      env: {},
      platform: 'linux',
      isWsl: async () => true,
      spawnBin: spawnFn(psRules(), calls),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strategy).toBe('wsl-powershell');
    expect(res.ext).toBe('png');
    const read = calls.find((c) => c.args[1] === '-STA');
    expect(read?.args[0]).toBe('-NoProfile');
    expect(read?.args[2]).toBe('-Command');
    expect(read?.args[3]).toContain('[System.Drawing.Imaging.ImageFormat]::Png');
  });

  test('win32：同脚本走 win32-powershell', async () => {
    const res = await readClipboardImage({
      env: {},
      platform: 'win32',
      spawnBin: spawnFn(psRules()),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strategy).toBe('win32-powershell');
  });

  test('退出码 3（剪贴板无图）→ no-image', async () => {
    const res = await readClipboardImage({
      env: {},
      platform: 'win32',
      spawnBin: spawnFn([
        { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'exit 0'] },
        { file: 'powershell.exe', args: (a) => a[1] === '-STA', stdout: '', code: 3 },
      ]),
    });
    expect(res).toEqual({ kind: 'no-image', message: '剪贴板中没有图片' });
  });

  test('退出码 4（headless 取不到剪贴板）→ no-tool 指引', async () => {
    const res = await readClipboardImage({
      env: {},
      platform: 'win32',
      spawnBin: spawnFn([
        { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'exit 0'] },
        { file: 'powershell.exe', args: (a) => a[1] === '-STA', stdout: '', code: 4 },
      ]),
    });
    expect(res.kind).toBe('no-tool');
    expect(res.kind === 'no-tool' && res.message).toContain('无法读取剪贴板');
  });

  test('WSL 判定走 /proc/version 含 microsoft', async () => {
    // 不注入 isWsl，验证默认推导（WSL_DISTRO_NAME 缺失时读 /proc/version）
    const res = await readClipboardImage({
      env: {},
      platform: 'linux',
      readFileText: async (p) => {
        expect(p).toBe('/proc/version');
        return 'Linux version 5.15.167.4-microsoft-standard-WSL2';
      },
      spawnBin: spawnFn(psRules()),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strategy).toBe('wsl-powershell');
  });
});

describe('readClipboardImage：darwin（osascript JXA）', () => {
  const jxaRules = (): SpawnRule[] => [
    { file: 'osascript', args: ['-l', 'JavaScript', '-e', '0'] },
    {
      file: 'osascript',
      args: (a) => a[0] === '-l' && a[1] === 'JavaScript' && a[2] === '-e',
      stdout: PNG_FIXTURE.toString('base64'),
    },
  ];

  test('读 NSPasteboard PNG（base64 stdout）→ ok', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const res = await readClipboardImage({
      env: {},
      platform: 'darwin',
      spawnBin: spawnFn(jxaRules(), calls),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strategy).toBe('darwin-osascript');
    expect(res.ext).toBe('png');
    const read = calls.find((c) => c.file === 'osascript' && c.args[2] === '-e' && c.args[3]?.length > 10);
    expect(read?.args[3]).toContain('NSPasteboardTypePNG');
    expect(read?.args[3]).toContain('NSPasteboardTypeTIFF');
  });

  test('退出码 3 → no-image', async () => {
    const res = await readClipboardImage({
      env: {},
      platform: 'darwin',
      spawnBin: spawnFn([
        { file: 'osascript', args: ['-l', 'JavaScript', '-e', '0'] },
        { file: 'osascript', args: (a) => a[2] === '-e', stdout: '', code: 3 },
      ]),
    });
    expect(res).toEqual({ kind: 'no-image', message: '剪贴板中没有图片' });
  });
});

describe('readClipboardImage：fail-open 链路与兜底', () => {
  test('WSLg 掉线（wl-paste 读取失败）→ 自动落到 powershell interop', async () => {
    const res = await readClipboardImage({
      env: { WAYLAND_DISPLAY: 'wayland-0', WSL_DISTRO_NAME: 'Ubuntu' },
      platform: 'linux',
      spawnBin: spawnFn([
        { file: 'wl-paste', args: ['--version'] },
        { file: 'wl-paste', args: ['-t', 'image/png'], error: enoent() },
        { file: 'wl-paste', args: ['-t', 'image/bmp'], error: enoent() },
        { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'exit 0'] },
        { file: 'powershell.exe', args: (a) => a[1] === '-STA', stdout: PNG_FIXTURE.toString('base64') },
      ]),
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strategy).toBe('wsl-powershell');
  });

  test('无任何可用工具（探测全失败）→ no-tool 指引', async () => {
    const res = await readClipboardImage({
      env: {},
      platform: 'linux',
      isWsl: notWsl,
      spawnBin: spawnFn([]),
    });
    expect(res.kind).toBe('no-tool');
    if (res.kind !== 'no-tool') return;
    expect(res.message).toContain('无法读取剪贴板');
    expect(res.message).toContain('保存图片');
  });

  test('未知格式（非 PNG/BMP 魔数）→ no-image 并说明不受支持', async () => {
    const res = await readClipboardImage({
      env: { WAYLAND_DISPLAY: 'wayland-0' },
      platform: 'linux',
      isWsl: notWsl,
      spawnBin: spawnFn([
        { file: 'wl-paste', args: ['--version'] },
        { file: 'wl-paste', args: ['-t', 'image/png'], stdout: Buffer.from('GIF89a not supported') },
      ]),
    });
    expect(res.kind).toBe('no-image');
    expect(res.kind === 'no-image' && res.message).toContain('仅支持 PNG/BMP');
  });
});
