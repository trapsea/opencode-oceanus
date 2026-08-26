import { describe, expect, test } from 'bun:test';
import {
  buildManifestUrl,
  createCanonicalManifest,
  parseManifest,
  type ParseManifestResult,
} from './manifest';
import { resolveCbmPlatform } from './constants';
import type { CbmReleaseManifest } from './types';

/**
 * CBM-02：内置 SHA-256 manifest 解析契约。
 *
 * 覆盖：canonical 归档 URL（必须 HTTPS）、manifest 缺失字段、大小超限、
 * sha256 格式校验（64 位小写十六进制）、同名冲突 digest 拒绝、二进制相对路径
 * 安全、内建 UI 标志。测试全部使用注入的 manifest，不访问真实网络。
 */

const A_HEX = 'a'.repeat(64);
const B_HEX = 'b'.repeat(64);

function validManifest(): CbmReleaseManifest {
  const platform = resolveCbmPlatform('linux', 'x64');
  return createCanonicalManifest(platform, A_HEX);
}

function resultOf(raw: string, opts?: Parameters<typeof parseManifest>[1]): ParseManifestResult {
  return parseManifest(raw, opts);
}

describe('buildManifestUrl / createCanonicalManifest', () => {
  test('URL 为 HTTPS 且包含版本 tag 与 canonical 归档名', () => {
    const platform = resolveCbmPlatform('darwin', 'arm64');
    const url = buildManifestUrl(platform);
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain('/v0.10.8/');
    expect(url.endsWith('codebase-memory-mcp-macos-arm64.tar.gz')).toBe(true);
  });

  test('release base 指向官方 DeusData 仓库', () => {
    const url = buildManifestUrl(resolveCbmPlatform('linux', 'x64'));
    expect(url.startsWith('https://github.com/DeusData/codebase-memory-mcp/releases/download/')).toBe(
      true,
    );
    expect(url).not.toContain('nnethery');
  });

  test('Windows 归档 URL 使用 .zip', () => {
    const platform = resolveCbmPlatform('win32', 'x64');
    expect(buildManifestUrl(platform)).toContain('codebase-memory-mcp-windows-amd64.zip');
  });

  test('canonical manifest 记录 archive/url/sha256/binaryPath/uiBuiltIn', () => {
    const m = validManifest();
    expect(m.version).toBe('0.10.8');
    expect(m.platform).toBe('linux-x64');
    expect(m.archive).toBe('codebase-memory-mcp-linux-amd64.tar.gz');
    expect(m.sha256).toBe(A_HEX);
    expect(m.binaryPath).toBe('codebase-memory-mcp');
    expect(m.uiBuiltIn).toBe(true);
  });

  test('Windows manifest 的 binaryPath 带 .exe', () => {
    const platform = resolveCbmPlatform('win32', 'x64');
    const m = createCanonicalManifest(platform, A_HEX);
    expect(m.binaryPath).toBe('codebase-memory-mcp.exe');
    expect(m.uiBuiltIn).toBe(true);
  });
});

describe('parseManifest - 合法输入', () => {
  test('接受合法 manifest，字段完整', () => {
    const m = validManifest();
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest).toEqual(m);
      expect(res.manifest.uiBuiltIn).toBe(true);
    }
  });
});

describe('parseManifest - 大小超限', () => {
  test('原始字节超过上限时报 oversize', () => {
    const big = JSON.stringify(validManifest()) + ' '.repeat(8192);
    const res = resultOf(big, { maxBytes: 1024 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('oversize');
  });

  test('size 字段超过归档大小上限时报 oversize', () => {
    const m = { ...validManifest(), size: 1024 * 1024 * 1024 };
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('oversize');
  });
});

describe('parseManifest - 缺失/格式错误字段', () => {
  test('缺失必填字段报 missing_field', () => {
    const m = validManifest();
    const { sha256, ...rest } = m;
    void sha256;
    const res = resultOf(JSON.stringify(rest));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('missing_field');
  });

  test('非布尔 uiBuiltIn 报 missing_field', () => {
    const m = { ...validManifest(), uiBuiltIn: 'yes' };
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('missing_field');
  });

  test('非法 JSON 报 invalid_json', () => {
    const res = resultOf('{not json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_json');
  });

  test('空对象报 missing_field', () => {
    const res = resultOf('{}');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('missing_field');
  });
});

describe('parseManifest - sha256 格式校验', () => {
  test('长度不足 64 报 invalid_sha256', () => {
    const m = { ...validManifest(), sha256: 'a'.repeat(63) };
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_sha256');
  });

  test('含非十六进制字符报 invalid_sha256', () => {
    const m = { ...validManifest(), sha256: 'g'.repeat(64) };
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_sha256');
  });

  test('大写十六进制（非小写）报 invalid_sha256', () => {
    const m = { ...validManifest(), sha256: 'A'.repeat(64) };
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_sha256');
  });
});

describe('parseManifest - URL 校验', () => {
  test('非 HTTPS 或非 URL 报 invalid_url', () => {
    const http = { ...validManifest(), url: validManifest().url.replace('https://', 'http://') };
    expect(resultOf(JSON.stringify(http))).toMatchObject({ ok: false, code: 'invalid_url' });

    const notUrl = { ...validManifest(), url: 'not-a-url' };
    expect(resultOf(JSON.stringify(notUrl))).toMatchObject({ ok: false, code: 'invalid_url' });
  });
});

describe('parseManifest - 冲突 digest', () => {
  test('同名归档与 trusted digest 冲突时报 conflict_digest', () => {
    const m = validManifest();
    const res = resultOf(JSON.stringify({ ...m, sha256: B_HEX }), {
      trusted: { archive: m.archive, sha256: A_HEX },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('conflict_digest');
  });

  test('同名归档 digest 一致时通过', () => {
    const m = validManifest();
    const res = resultOf(JSON.stringify(m), {
      trusted: { archive: m.archive, sha256: A_HEX },
    });
    expect(res.ok).toBe(true);
  });

  test('不同名归档不与 trusted 比对冲突', () => {
    const m = validManifest();
    const res = resultOf(JSON.stringify(m), {
      trusted: { archive: 'other-archive.tar.gz', sha256: B_HEX },
    });
    expect(res.ok).toBe(true);
  });
});

describe('parseManifest - 二进制相对路径安全', () => {
  test('绝对路径报 unsafe_path', () => {
    const m = { ...validManifest(), binaryPath: '/etc/codebase-memory-mcp' };
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsafe_path');
  });

  test('含 .. 的路径报 unsafe_path', () => {
    const m = { ...validManifest(), binaryPath: 'runtime-assets/../../evil' };
    const res = resultOf(JSON.stringify(m));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsafe_path');
  });

  test('Windows 盘符绝对路径报 unsafe_path', () => {
    const platform = resolveCbmPlatform('win32', 'x64');
    const m = createCanonicalManifest(platform, A_HEX);
    const res = resultOf(JSON.stringify({ ...m, binaryPath: 'C:\\Windows\\evil.exe' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsafe_path');
  });
});

describe('六平台 canonical 归档 URL', () => {
  const cases: Array<[string, string, string]> = [
    // [平台, 架构, 期望 archiveName 后缀]
    ['darwin', 'arm64', 'codebase-memory-mcp-macos-arm64.tar.gz'],
    ['darwin', 'x64', 'codebase-memory-mcp-macos-amd64.tar.gz'],
    ['linux', 'arm64', 'codebase-memory-mcp-linux-arm64.tar.gz'],
    ['linux', 'x64', 'codebase-memory-mcp-linux-amd64.tar.gz'],
    ['win32', 'arm64', 'codebase-memory-mcp-windows-arm64.zip'],
    ['win32', 'x64', 'codebase-memory-mcp-windows-amd64.zip'],
  ];

  for (const [platform, arch, archiveName] of cases) {
    test(`${platform}-${arch} -> ${archiveName}`, () => {
      const p = resolveCbmPlatform(platform, arch);
      const url = buildManifestUrl(p);
      const expected = `https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.10.8/${archiveName}`;
      expect(url).toBe(expected);
      expect(createCanonicalManifest(p, A_HEX).url).toBe(expected);
      expect(createCanonicalManifest(p, A_HEX).archive).toBe(archiveName);
    });
  }
});
