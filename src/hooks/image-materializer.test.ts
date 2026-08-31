import { afterEach, describe, expect, it } from 'bun:test';
import {
  materializePromptImages,
  registerImageMaterializer,
  type ImageMaterializerDeps,
  type PromptHookEvent,
} from './image-materializer';
import { registerOceanusHooks } from './index';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolingContext } from '../runtime/types';

const ROOT = '/tmp/opencode/ws';

function makeDeps(
  writes: Array<{ path: string; bytes: Uint8Array }>,
  logger?: ImageMaterializerDeps['logger'],
): ImageMaterializerDeps {
  return {
    getWorkspaceRoot: () => ROOT,
    write: async (path, bytes) => {
      writes.push({ path, bytes });
    },
    hash: (bytes) => `h${bytes.length}`,
    logger,
  };
}

function pngDataUri(): string {
  // 1x1 PNG 的 base64
  return `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}`;
}

function makeEvent(uris: string[]): PromptHookEvent {
  return {
    sessionID: 'ses_test',
    prompt: { text: '看下这张图', files: uris.map((uri) => ({ uri })) },
  };
}

describe('materializePromptImages', () => {
  it('视觉支持：data:image 附件替换为 file:// 并追加路径提示', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const event = makeEvent([pngDataUri(), { uri: 'file:///a/b.md' } as never].map(String));
    // 修正：构造混合 files
    const ev: PromptHookEvent = {
      sessionID: 'ses_test',
      prompt: {
        text: '看下这张图',
        files: [{ uri: pngDataUri() }, { uri: 'file:///a/b.md' }],
      },
    };
    void event;
    const res = await materializePromptImages(ev, true, makeDeps(writes));
    expect(res.mutated).toBe(true);
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0]).toBe(join(ROOT, '.oceanus/media/h4.png'));
    expect(writes).toHaveLength(1);
    // data: 被替换为 file://，非图片附件保留
    expect(ev.prompt.files!.map((f) => f.uri)).toEqual([
      `file://${join(ROOT, '.oceanus/media/h4.png')}`,
      'file:///a/b.md',
    ]);
    expect(ev.prompt.text).toContain('[oceanus] 已物化图片附件');
    expect(ev.prompt.text).toContain('observer');
  });

  it('非视觉主模型（vision=false）：移除图片 part，仅保留文本路径提示', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const ev = makeEvent([pngDataUri()]);
    const res = await materializePromptImages(ev, false, makeDeps(writes));
    expect(res.mutated).toBe(true);
    expect(res.paths).toHaveLength(1);
    expect(ev.prompt.files).toHaveLength(0);
    expect(ev.prompt.text).toContain('已物化图片附件');
  });

  it('无图片附件：不改动', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const ev = makeEvent(['file:///a/b.md']);
    const res = await materializePromptImages(ev, true, makeDeps(writes));
    expect(res.mutated).toBe(false);
    expect(res.paths).toHaveLength(0);
    expect(ev.prompt.text).toBe('看下这张图');
  });

  it('写盘失败：fail-open 保留原附件，不抛异常', async () => {
    const ev = makeEvent([pngDataUri()]);
    const deps: ImageMaterializerDeps = {
      getWorkspaceRoot: () => ROOT,
      write: async () => {
        throw new Error('disk full');
      },
      hash: () => 'x',
      logger: () => {},
    };
    const res = await materializePromptImages(ev, true, deps);
    expect(res.mutated).toBe(false);
    expect(ev.prompt.files).toHaveLength(1);
    expect(ev.prompt.files![0].uri).toMatch(/^data:image\/png/);
  });

  it('幂等：相同内容 hash 相同文件名，重复调用不产生新路径', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const deps = makeDeps(writes);
    const ev1 = makeEvent([pngDataUri()]);
    const ev2 = makeEvent([pngDataUri()]);
    const r1 = await materializePromptImages(ev1, true, deps);
    const r2 = await materializePromptImages(ev2, true, deps);
    expect(r1.paths[0]).toBe(r2.paths[0]);
  });
});

describe('registerImageMaterializer', () => {
  it('注册名为 prompt 的 hook；回调触发时按当次 vision 状态物化', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const hooks: Array<{ name: string; cb: (e: never) => Promise<void> }> = [];
    let vision = true;
    await registerImageMaterializer(
      {
        hook: async (name, cb) => {
          hooks.push({ name, cb: cb as never });
        },
      },
      () => vision,
      makeDeps(writes),
    );
    expect(hooks).toHaveLength(1);
    // 契约：必须是 prompt hook（宿主实际可用；beta 类型未声明不代表运行时不可用）。
    expect(hooks[0].name).toBe('prompt');

    const ev1 = makeEvent([pngDataUri()]);
    await hooks[0].cb(ev1 as never);
    expect(writes).toHaveLength(1);
    expect(ev1.prompt.files![0].uri).toMatch(/^file:\/\//);
    expect(ev1.prompt.text).toContain('已物化图片附件');

    // vision 状态在每次回调触发时动态读取，而非注册期固化。
    vision = false;
    const ev2 = makeEvent([pngDataUri()]);
    await hooks[0].cb(ev2 as never);
    expect(ev2.prompt.files).toHaveLength(0);
    expect(ev2.prompt.text).toContain('已物化图片附件');
  });

  it('回调内物化失败不外抛（fail-open，不阻塞 prompt admission）', async () => {
    const hooks: Array<{ cb: (e: never) => Promise<void> }> = [];
    const deps: ImageMaterializerDeps = {
      getWorkspaceRoot: () => ROOT,
      write: async () => {
        throw new Error('disk full');
      },
      hash: () => 'x',
      logger: () => {},
    };
    await registerImageMaterializer(
      { hook: async (_name, cb) => void hooks.push({ cb: cb as never }) },
      () => true,
      deps,
    );
    const ev = makeEvent([pngDataUri()]);
    await expect(hooks[0].cb(ev as never)).resolves.toBeUndefined();
    expect(ev.prompt.files![0].uri).toMatch(/^data:image\/png/);
  });
});

// ─────────────── 接线层（registerOceanusHooks）运行时能力探测 ───────────────
// beta-18230 的 @opencode-ai/plugin SessionDomain 类型未声明 session.hook，
// 但 prompt hook 在实际 Host 中可用：接线必须靠运行时探测，不能靠类型判断。
// retry hook 与 prompt hook 能力相互独立，不能从 prompt 可用推断 retry 可用。

interface SessionHostOptions {
  root?: string;
  /** 模拟宿主不支持 retry hook 名：hook('retry') 直接拒绝。 */
  retryRejects?: boolean;
  /** 不暴露 synthetic（默认暴露）。 */
  noSynthetic?: boolean;
}

function makeSessionHost(opts: SessionHostOptions = {}) {
  const sessionHooks: Array<{ name: string; cb: (e: never) => Promise<void> | void }> = [];
  const session = {
    get: async ({ sessionID }: { sessionID: string }) => ({
      id: sessionID,
      projectID: 'p1',
      location: { directory: opts.root ?? ROOT },
    }),
    hook: async (name: string, cb: (e: never) => Promise<void> | void) => {
      if (name === 'retry' && opts.retryRejects) {
        throw new Error('unknown hook "retry"');
      }
      sessionHooks.push({ name, cb });
    },
    ...(opts.noSynthetic ? {} : { synthetic: async () => {} }),
  };
  return { session, sessionHooks };
}

function makeWiringCtx(sessionLike: unknown): { ctx: ToolingContext } {
  const ctx = {
    tool: {
      transform: async () => {},
      hook: async () => {},
    },
    session: sessionLike,
  } as unknown as ToolingContext;
  return { ctx };
}

function triggerPrompt(hooks: Array<{ name: string; cb: (e: never) => Promise<void> | void }>, root: string) {
  const promptHook = hooks.find((h) => h.name === 'prompt');
  expect(promptHook, 'prompt hook 已注册').toBeDefined();
  const event = {
    sessionID: 'ses_wiring',
    prompt: { text: '看下这张图', files: [{ uri: pngDataUri() }] },
  };
  return { event, run: () => promptHook!.cb(event as never) };
}

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length) {
    await rm(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('registerOceanusHooks：image hook 运行时能力探测', () => {
  it('宿主暴露 session.hook：注册 prompt 物化，data:image 真实落盘并替换为 file://', async () => {
    const root = await mkdtemp(join('/tmp/opencode', 'oceanus-img-'));
    tempRoots.push(root);
    const { session, sessionHooks } = makeSessionHost({ root });
    const { ctx } = makeWiringCtx(session);

    await registerOceanusHooks(ctx, {});
    expect(sessionHooks.map((h) => h.name)).toContain('prompt');

    const { event, run } = triggerPrompt(sessionHooks, root);
    await run();
    // data:image/* 物化契约：真实写入 <root>/.oceanus/media/，uri 替换为 file://。
    const materialized = event.prompt.files![0].uri;
    expect(materialized).toMatch(/^file:\/\//);
    const onDisk = materialized.slice('file://'.length);
    expect(onDisk.startsWith(join(root, '.oceanus', 'media'))).toBe(true);
    expect(onDisk.endsWith('.png')).toBe(true);
    expect(existsSync(onDisk)).toBe(true);
    expect(event.prompt.text).toContain('[oceanus] 已物化图片附件');
  });

  it('宿主未暴露 session.hook：静默跳过图片 hook，注册流程不抛错', async () => {
    const logs: string[] = [];
    const { ctx } = makeWiringCtx({}); // 最小宿主：无 hook / synthetic / get
    await expect(
      registerOceanusHooks(ctx, {}, { logger: (m) => void logs.push(m) }),
    ).resolves.toBeUndefined();
    expect(logs.some((m) => m.includes('image-materializer'))).toBe(false);
    expect(logs.some((m) => m.includes('image-error-hint'))).toBe(false);
  });

  it('宿主拒绝 retry hook：仅 image-error-hint fail-open，prompt 物化不受影响', async () => {
    const logs: string[] = [];
    const { session, sessionHooks } = makeSessionHost({ retryRejects: true });
    const { ctx } = makeWiringCtx(session);

    await expect(
      registerOceanusHooks(ctx, {}, { logger: (m) => void logs.push(m) }),
    ).resolves.toBeUndefined();
    // 独立能力：retry 拒绝不能拖垮 prompt（也不能从 prompt 可用推断 retry 可用）。
    expect(sessionHooks.map((h) => h.name)).toEqual(['prompt']);
    expect(logs.some((m) => m.includes('image-error-hint'))).toBe(true);

    const { event, run } = triggerPrompt(sessionHooks, ROOT);
    await run();
    expect(event.prompt.files![0].uri).toMatch(/^file:\/\//);
    expect(event.prompt.text).toContain('已物化图片附件');
  });

  it('宿主缺 synthetic：跳过 retry 提示注册，prompt 物化照常', async () => {
    const { session, sessionHooks } = makeSessionHost({ noSynthetic: true });
    const { ctx } = makeWiringCtx(session);
    await registerOceanusHooks(ctx, {});
    expect(sessionHooks.map((h) => h.name)).toEqual(['prompt']);
  });

  it('disabled_hooks 关闭 image_materializer：不注册 prompt hook', async () => {
    const { session, sessionHooks } = makeSessionHost();
    const { ctx } = makeWiringCtx(session);
    await registerOceanusHooks(ctx, { disabled_hooks: ['image_materializer'] });
    expect(sessionHooks.map((h) => h.name)).not.toContain('prompt');
  });
});
