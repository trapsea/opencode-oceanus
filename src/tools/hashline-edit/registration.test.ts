import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerOceanusTools } from '../index';
import { computeLineHash } from './hash';
import type { PluginConfig } from '../../../config/schema';
import type { ToolDefinition, ToolingContext } from '../../../runtime/types';

/**
 * hashline 锚定编辑工具的注册名契约：
 * - editing.strategy=hashline（默认）：以内置名 `edit` 注册（插件重名优先语义，
 *   借用宿主 edit 渲染器获得原生 diff 模板），permission action 保持 hashline_edit，
 *   codemode:false（直接工具目录）。
 * - editing.strategy=host：以 `hashline_edit` 原名注册，与宿主原生 edit 并存。
 * - 两种命名下的 execute 行为一致（锚点编辑 + 可读 diff 报告 + metadata.filediff）。
 */

const tempDirs: string[] = [];

async function mockCtx(root: string, added: ToolDefinition[]): Promise<ToolingContext> {
  return {
    tool: {
      transform: async (cb) => {
        cb({ add: (t) => added.push(t) });
      },
      hook: async () => {},
    },
    session: {
      get: async () => ({ id: 's1', location: { directory: root } }),
    },
  } as unknown as ToolingContext;
}

async function register(config: PluginConfig, root = '/ws'): Promise<ToolDefinition[]> {
  const added: ToolDefinition[] = [];
  const ctx = await mockCtx(root, added);
  await registerOceanusTools(ctx, config);
  return added;
}

describe('hashline 锚定编辑工具注册名契约', () => {
  test('默认策略（hashline）：以内置名 edit 注册 + permission=hashline_edit + codemode:false', async () => {
    const added = await register({});
    const tool = added.find((t) => t.name === 'edit');
    expect(tool).toBeDefined();
    expect(tool!.options?.permission).toBe('hashline_edit');
    expect(tool!.options?.codemode).toBe(false);
    // 原名 hashline_edit 不再注册（避免模型双工具困惑）。
    expect(added.find((t) => t.name === 'hashline_edit')).toBeUndefined();
    // output schema 已声明（0.41.1 回归修复）。
    expect(tool!.output).toBeDefined();
  });

  test('host 策略：保留 hashline_edit 原名，不覆盖内置名', async () => {
    const added = await register({ editing: { strategy: 'host' } });
    expect(added.find((t) => t.name === 'hashline_edit')).toBeDefined();
    expect(added.find((t) => t.name === 'edit')).toBeUndefined();
  });

  test('edit 名义下 execute 行为一致：锚点编辑 + 可读 diff + metadata.filediff', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'oceanus-edit-reg-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'data.txt');
    await writeFile(file, 'alpha\nbeta\n', 'utf-8');
    const added = await register({}, dir);
    const tool = added.find((t) => t.name === 'edit')!;
    const res = (await tool.execute(
      { filePath: 'data.txt', edits: [{ op: 'replace', pos: `2#${computeLineHash(2, 'beta')}`, lines: 'BETA' }] },
      { sessionID: 's1' },
    )) as { content?: unknown; metadata?: Record<string, unknown> };
    const text = res.content as string;
    expect(text).toContain('Edited data.txt (+1 -1)');
    expect(text).toContain('-beta');
    expect(text).toContain('+BETA');
    // 宿主 edit 渲染器消费的字段约定（file + patch）。
    const filediff = res.metadata?.filediff as { file: string; patch: string };
    expect(filediff.file).toBe('data.txt');
    expect(filediff.patch).toContain('+BETA');
    expect(await readFile(file, 'utf-8')).toContain('BETA');
  });

  test('禁用 tools.hashline_edit 时两种策略下均不注册', async () => {
    const disabled: PluginConfig = { tools: { hashline_edit: { enabled: false } } };
    expect((await register(disabled)).find((t) => t.name === 'edit' || t.name === 'hashline_edit')).toBeUndefined();
    expect(
      (await register({ ...disabled, editing: { strategy: 'host' } })).find(
        (t) => t.name === 'edit' || t.name === 'hashline_edit',
      ),
    ).toBeUndefined();
  });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
