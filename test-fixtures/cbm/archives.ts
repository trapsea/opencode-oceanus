/**
 * CBM-05 测试夹具：内存构造 tar.gz 与 zip 归档。
 *
 * 只依赖 Node/Bun 内置模块（node:zlib），不访问网络、不调用系统 tar/unzip，
 * 让路径穿越、损坏等用例完全确定性。
 */

import { deflateRawSync, gzipSync } from 'node:zlib';

export interface FixtureEntry {
  /** 归档内成员名（用 `/` 分隔，或故意含 `../`/绝对路径做穿越测试）。 */
  name: string;
  /** 成员内容。目录成员可省略或传空串。 */
  content?: string | Buffer;
  /** tar 显式类型：'dir' 标记目录（普通文件默认 'file'）。 */
  type?: 'file' | 'dir';
}

/* ------------------------------------------------------------------ */
/* CRC32（zip 校验）                                                   */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* tar.gz 构造                                                          */
/* ------------------------------------------------------------------ */

/** 构造一份 tar.gz（gzip 压缩的 ustar 归档）。 */
export function buildTarGz(files: FixtureEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const isDir = f.type === 'dir' || f.name.endsWith('/');
    const content = Buffer.isBuffer(f.content)
      ? f.content
      : Buffer.from(f.content ?? '', 'utf8');

    const header = Buffer.alloc(512);
    name.copy(header, 0);
    header.write(isDir ? '0000755\0' : '0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii'); // uid
    header.write('0000000\0', 116, 8, 'ascii'); // gid
    const size = isDir ? 0 : content.length;
    header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii'); // mtime
    header.write('        \0', 148, 8, 'ascii'); // chksum 占位（空格）
    header[156] = isDir ? 53 : 48; // '5' 目录，'0' 普通文件
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    blocks.push(header);
    if (!isDir) {
      blocks.push(content);
      const pad = content.length % 512 === 0 ? 0 : 512 - (content.length % 512);
      if (pad > 0) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(512), Buffer.alloc(512));
  return gzipSync(Buffer.concat(blocks));
}

/* ------------------------------------------------------------------ */
/* zip 构造（store 无压缩 + deflate 两种）                              */
/* ------------------------------------------------------------------ */

export interface ZipEntryOptions {
  /** 0=store（不压缩），8=deflate（默认）。 */
  method?: 0 | 8;
}

/**
 * 构造一份 zip 归档。默认 deflate 压缩；可对个别成员指定 store。
 */
export function buildZip(
  files: FixtureEntry[],
  entryOptions: ZipEntryOptions = { method: 8 },
): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const isDir = f.name.endsWith('/');
    const raw = Buffer.isBuffer(f.content)
      ? f.content
      : Buffer.from(f.content ?? '', 'utf8');
    const method = isDir ? 0 : entryOptions.method ?? 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw) >>> 0;

    // local file header
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0, 12); // date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); // compressed size
    lh.writeUInt32LE(raw.length, 22); // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra len
    parts.push(lh, nameBuf, data);

    // central directory header
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8); // flags
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); // time
    ch.writeUInt16LE(0, 14); // date
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra len
    ch.writeUInt16LE(0, 32); // comment len
    ch.writeUInt16LE(0, 34); // disk start
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(isDir ? 0o40755 : 0o100755, 38); // external attrs
    ch.writeUInt32LE(offset, 42); // local header offset
    central.push(ch, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const cdOffset = parts.reduce((s, b) => s + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(files.length, 8); // entries this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...parts, ...central, eocd]);
}

/** 便捷：生成一个假的、可注入任意内容校验和的“二进制”内容。 */
export function mockBinaryContent(marker: string): Buffer {
  return Buffer.from(`#! mock binary\nmarker=${marker}\n`, 'utf8');
}
