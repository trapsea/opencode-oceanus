import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildClipboardImageTool } from './clipboard-image';
import { registerOceanusTools } from './index';
import { isToolEnabled } from '../config/utils';
import type { PluginConfig } from '../config/schema';
import type { ClipboardReadResult } from './clipboard/platforms';
import type { ToolContextLike, ToolDefinition, ToolingContext } from '../runtime/types';

/**
 * clipboard_image 工具契约测试：
 * 成功 / 无图 / 无工具三分支全部通过注入 readClipboard / now / fs 驱动；
 * 另覆盖 BMP 原件落盘、工作区解析失败、异常 fail-open 与注册入口。
 */

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([9, 9, 9]),
]);
const BMP_BYTES = Buffer.from([0x42, 0x4d, 1, 2, 3, 4, 5, 6, 7, 8]);

const FIXED_NOW = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z

function mockCtx(root: string | null, added?: ToolDefinition[]): ToolingContext {
  return {
    tool: {
      transform: async (cb) => {
        cb({ add: (t) => added?.push(t) });
      },
      hook: async () => {},
    },
    session: {
      get: async () => (root ? { id: 's1', location: { directory: root } } : undefined),
    },
  } as unknown as ToolingContext;
}

const okResult = (bytes: Uint8Array, ext: 'png' | 'bmp', note?: string): ClipboardReadResult => ({
  kind: 'ok',
  bytes,
  ext,
  strategy: 'wayland',
  ...(note ? { note } : {}),
});

async function run(tool: ToolDefinition, sessionID = 'sess_1'): Promise<any> {
  const res = await tool.execute({}, { sessionID } as ToolContextLike);
  expect(typeof res.content).toBe('string');
  return JSON.parse(res.content as string);
}

describe('clipboard_image：成功分支', () => {
  test('PNG 落盘到 .oceanus/media/ 并返回绝对路径', async () => {
    const root = await mkdtemp(path.join('/tmp/opencode', 'oceanus-clipboard-tool-'));
    try {
      const tool = buildClipboardImageTool(mockCtx(root), {
        readClipboard: async () => okResult(PNG_BYTES, 'png'),
        now: () => FIXED_NOW,
      });
      const out = await run(tool);
      expect(out.ok).toBe(true);
      expect(out.format).toBe('png');
      expect(out.bytes).toBe(PNG_BYTES.length);
      expect(out.path).toMatch(/\.oceanus[/\\]media[/\\]20231114T221320000Z-[0-9a-f]{8}\.png$/);
      expect(path.isAbsolute(out.path)).toBe(true);
      // 文件真实存在且字节一致
      const written = await readFile(out.path);
      expect(written.equals(PNG_BYTES)).toBe(true);
      expect(out.note).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('同字节 + 同时间戳 → 路径幂等（内容 hash 文件名）', async () => {
    const root = await mkdtemp(path.join('/tmp/opencode', 'oceanus-clipboard-tool-'));
    try {
      const tool = buildClipboardImageTool(mockCtx(root), {
        readClipboard: async () => okResult(PNG_BYTES, 'png'),
        now: () => FIXED_NOW,
      });
      const a = await run(tool);
      const b = await run(tool);
      expect(b.path).toBe(a.path);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('BMP 无法转换 → 存 .bmp 原件并注明', async () => {
    const root = await mkdtemp(path.join('/tmp/opencode', 'oceanus-clipboard-tool-'));
    try {
      const note = '原始 BMP 无法自动转换为 PNG，已保存 BMP 原件（observer 的 read 通常也能读 BMP）';
      const tool = buildClipboardImageTool(mockCtx(root), {
        readClipboard: async () => okResult(BMP_BYTES, 'bmp', note),
        now: () => FIXED_NOW,
      });
      const out = await run(tool);
      expect(out.ok).toBe(true);
      expect(out.format).toBe('bmp');
      expect(out.path).toMatch(/\.bmp$/);
      expect(out.note).toBe(note);
      const written = await readFile(out.path);
      expect(written.equals(BMP_BYTES)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('clipboard_image：无图 / 无工具分支', () => {
  test('no-image：返回指引且不落盘', async () => {
    const writes: string[] = [];
    const tool = buildClipboardImageTool(mockCtx('/ws'), {
      readClipboard: async () => ({ kind: 'no-image', message: '剪贴板中没有图片' }),
      now: () => FIXED_NOW,
      fs: {
        mkdir: async (dir) => {
          writes.push(`mkdir:${dir}`);
          return dir;
        },
        writeFile: async (file) => {
          writes.push(`write:${file}`);
          return undefined;
        },
      },
    });
    const out = await run(tool);
    expect(out).toEqual({ ok: false, reason: 'no-image', message: '剪贴板中没有图片' });
    expect(writes).toEqual([]);
  });

  test('no-tool：返回人工保存指引', async () => {
    const tool = buildClipboardImageTool(mockCtx('/ws'), {
      readClipboard: async () => ({
        kind: 'no-tool',
        message: '当前环境无法读取剪贴板（未找到可用的剪贴板工具），请让用户保存图片并告知路径',
      }),
      now: () => FIXED_NOW,
      fs: {
        mkdir: async (d) => d,
        writeFile: async (f) => f,
      },
    });
    const out = await run(tool);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no-tool');
    expect(out.message).toContain('请让用户保存图片并告知路径');
  });

  test('no-image 消息缺省时使用内置文案', async () => {
    const tool = buildClipboardImageTool(mockCtx('/ws'), {
      readClipboard: async () => ({ kind: 'no-image', message: '' }),
      fs: { mkdir: async (d) => d, writeFile: async (f) => f },
    });
    const out = await run(tool);
    expect(out.message).toBe('剪贴板中没有图片');
  });
});

describe('clipboard_image：fail-open', () => {
  test('工作区根解析失败 → 结构化 error，不抛异常', async () => {
    const tool = buildClipboardImageTool(mockCtx(null), {
      readClipboard: async () => okResult(PNG_BYTES, 'png'),
    });
    const out = await run(tool);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('error');
    expect(out.message).toContain('工作区根目录');
  });

  test('readClipboard 抛异常 → 捕获并返回结构化 error', async () => {
    const tool = buildClipboardImageTool(mockCtx('/ws'), {
      readClipboard: async () => {
        throw new Error('boom');
      },
      fs: { mkdir: async (d) => d, writeFile: async (f) => f },
    });
    const out = await run(tool);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('error');
    expect(out.message).toContain('boom');
  });

  test('写盘失败（mkdir 抛错）→ 捕获并返回结构化 error', async () => {
    const tool = buildClipboardImageTool(mockCtx('/ws'), {
      readClipboard: async () => okResult(PNG_BYTES, 'png'),
      fs: {
        mkdir: async () => {
          throw new Error('EACCES');
        },
        writeFile: async (f) => f,
      },
    });
    const out = await run(tool);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('error');
    expect(out.message).toContain('EACCES');
  });
});

describe('clipboard_image：注册入口', () => {
  test('registerOceanusTools 注册 clipboard_image（默认启用）', async () => {
    const added: ToolDefinition[] = [];
    const config = { codebaseMemory: { enabled: false } } as unknown as PluginConfig;
    await registerOceanusTools(mockCtx('/ws', added), config, {});
    const tool = added.find((t) => t.name === 'clipboard_image');
    expect(tool).toBeDefined();
    expect(isToolEnabled(config, 'clipboard_image')).toBe(true);
    expect(tool!.input).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    expect(tool!.description).toContain('observer');
  });

  test('disabled_tools 配置可关闭 clipboard_image', async () => {
    const added: ToolDefinition[] = [];
    const config = {
      codebaseMemory: { enabled: false },
      disabled_tools: ['clipboard_image'],
    } as unknown as PluginConfig;
    await registerOceanusTools(mockCtx('/ws', added), config, {});
    expect(added.some((t) => t.name === 'clipboard_image')).toBe(false);
    expect(isToolEnabled(config, 'clipboard_image')).toBe(false);
  });
});
