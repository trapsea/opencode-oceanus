/**
 * CBM-13 入口接线 smoke 测试。
 *
 * 通过抽取出的 `runSetup(ctx, options)` 用 fake ctx + 注入的 CBM 依赖验证：
 * - setup 接线顺序（后台安装先于 tools/hooks）；
 * - 后台安装不阻塞插件启动（`startBackgroundInstall` 只触发不 await）；
 * - 失败降级（后台安装 / MCP 注册失败不阻塞 agents/tools/hooks/commands）；
 * - 共享依赖（同一 indexer / ensureInstalled / cacheRoot 被 tools、hooks、
 *   commands、CLI、UI 复用；显式 `codebaseMemory.cacheDir` 全局生效）。
 *
 * 全部使用注入的 fake 安装 / 索引实现，不访问真实网络 / 进程 / 缓存。
 */
import { describe, expect, test } from 'bun:test';
import { runSetup } from '../index';
import { buildCbmSharedDeps, type CbmWiringInjections } from '../cbm/wiring';
import { getCacheRoot } from '../cbm/paths';
import type { IndexerHandle } from '../cbm/indexer';
import type {
  CommandDefinition,
  PluginSetupContext,
  ToolDefinition,
} from '../runtime/types';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 带 ensureIndexed 记录 spy 的共享索引器 stub。 */
function createIndexerStub(
  ensureIndexedCalls: Array<string | undefined>,
): IndexerHandle {
  return {
    ensureIndexed: async (projectPath, opts) => {
      ensureIndexedCalls.push(projectPath ?? opts.workspaceRoot);
      return { kind: 'indexed' };
    },
    isIndexed: () => true,
    isIndexing: () => false,
    getLastOutcome: () => undefined,
    reset: () => {},
  };
}

interface FakeSetupCtxOptions {
  /** ctx.mcp.transform 抛错（模拟宿主 MCP 不可用）。 */
  mcpThrows?: boolean;
  /** 记录各域动作执行顺序。 */
  order?: string[];
}

/** 最小 fake setup ctx：覆盖 agent/skill/command/tool/session/mcp。 */
function createFakeSetupCtx(opts: FakeSetupCtxOptions = {}): {
  ctx: PluginSetupContext;
  addedTools: ToolDefinition[];
  beforeHooks: Array<(e: any) => Promise<void> | void>;
  afterHooks: Array<(e: any) => Promise<void> | void>;
  commands: CommandDefinition[];
  order: string[];
} {
  const order = opts.order ?? [];
  const addedTools: ToolDefinition[] = [];
  const beforeHooks: Array<(e: any) => Promise<void> | void> = [];
  const afterHooks: Array<(e: any) => Promise<void> | void> = [];
  const commands: CommandDefinition[] = [];

  const ctx: PluginSetupContext = {
    agent: {
      transform: async (cb) => {
        order.push('agents');
        const draft = {
          get: () => undefined,
          remove: () => {},
          update: () => {},
          default: () => {},
        };
        cb(draft as never);
      },
      reload: async () => {},
    },
    skill: {
      transform: async (cb) => {
        order.push('skills');
        cb({ add: () => {} } as never);
      },
      reload: async () => {},
    },
    command: {
      transform: async (cb) => {
        order.push('commands');
        cb({ add: (cmd) => commands.push(cmd) } as never);
      },
      reload: async () => {},
    },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
      prompt: async () => {},
    },
    tool: {
      transform: async (cb) => {
        order.push('tools');
        cb({ add: (t) => addedTools.push(t) });
      },
      hook: async (name, cb) => {
        if (name === 'execute.before') beforeHooks.push(cb as never);
        else if (name === 'execute.after') afterHooks.push(cb as never);
        order.push('hooks');
      },
    },
    mcp: {
      transform: async (cb) => {
        if (opts.mcpThrows) throw new Error('simulated mcp.transform failure');
        cb({ list: () => [], get: () => undefined, set: () => {}, update: () => {}, remove: () => {} } as never);
      },
      reload: async () => {},
    },
  };
  return { ctx, addedTools, beforeHooks, afterHooks, commands, order };
}

const findCommand = (commands: CommandDefinition[], name: string): CommandDefinition => {
  const c = commands.find((x) => x.name === name);
  expect(c, `command ${name} 已注册`).toBeDefined();
  return c!;
};

const findTool = (tools: ToolDefinition[], name: string): ToolDefinition => {
  const t = tools.find((x) => x.name === name);
  expect(t, `tool ${name} 已注册`).toBeDefined();
  return t!;
};

// ─────────────────────────── buildCbmSharedDeps（共享依赖） ───────────────────────────

describe('CBM-13 buildCbmSharedDeps：共享缓存根/安装/索引器', () => {
  test('所有入口即使收到冲突 cacheRoot 也记录同一个快照根', async () => {
    const root = '/tmp/cbm-shared-root';
    const seen: string[] = [];
    const shared = buildCbmSharedDeps({ codebaseMemory: { cacheDir: root } }, {
      startBackgroundInstall: async (opts) => { seen.push(opts?.cacheRoot ?? ''); return null; },
      ensureInstalled: async (opts) => { seen.push(opts?.cacheRoot ?? ''); return null; },
    });
    await shared.startBackground({ cacheRoot: '/wrong/background' });
    await shared.ensureInstalled({ cacheRoot: '/wrong/install' });
    await shared.uiEnsureInstalled({ cacheRoot: '/wrong/ui' });
    await shared.runDeps.ensureInstalled!({ cacheRoot: '/wrong/cli' });
    expect(seen).toEqual([root, root, root, root]);
  });

  test('显式 cacheDir 同时用于 provision/CLI/UI：ensureInstalled 注入收到同一 cacheRoot', async () => {
    const seen: string[] = [];
    const shared = buildCbmSharedDeps(
      { codebaseMemory: { enabled: true, autoDownload: true, cacheDir: '/tmp/cbm-cache' } },
      {
        ensureInstalled: async (opts) => {
          seen.push(opts?.cacheRoot ?? '');
          return '/tmp/cbm-cache/versions/0.10.8/linux-x64/codebase-memory-mcp';
        },
        createIndexer: () => createIndexerStub([]),
      },
    );

    expect(shared.cacheRoot).toBe('/tmp/cbm-cache');
    expect(shared.installOptions.cacheRoot).toBe('/tmp/cbm-cache');
    // CLI（runDeps.ensureInstalled）、共享 ensureInstalled、UI 三条路径都命中同一 cacheRoot。
    await shared.ensureInstalled();
    await shared.runDeps.ensureInstalled!();
    await shared.uiEnsureInstalled();
    expect(seen).toEqual(['/tmp/cbm-cache', '/tmp/cbm-cache', '/tmp/cbm-cache']);
  });

  test('未显式 cacheDir 时回落到默认 getCacheRoot()', () => {
    const shared = buildCbmSharedDeps({}, { createIndexer: () => createIndexerStub([]) });
    expect(shared.cacheRoot).toBe(getCacheRoot());
  });

  test('共享同一 indexer 与 ensureInstalled：runDeps.indexer === indexer，命令 getCacheRoot 一致', () => {
    const ensureIndexedCalls: Array<string | undefined> = [];
    const indexer = createIndexerStub(ensureIndexedCalls);
    const shared = buildCbmSharedDeps({ codebaseMemory: { cacheDir: '/cache' } }, {
      createIndexer: () => indexer,
    });
    expect(shared.indexer).toBe(indexer);
    expect(shared.runDeps.indexer).toBe(indexer);
    expect(shared.runDeps.ensureInstalled).toBeDefined();
    // commands 的 getCacheRoot 复用同一 cacheRoot。
    expect(shared.cacheRoot).toBe('/cache');
  });

  test('createIndexer 抛错时 fail-open：返回 fallback indexer，不抛异常', () => {
    const shared = buildCbmSharedDeps(
      { codebaseMemory: { cacheDir: '/cache' } },
      {
        createIndexer: () => {
          throw new Error('indexer exploded');
        },
        logger: () => {},
      },
    );
    expect(shared.indexer).toBeDefined();
    expect(shared.runDeps.indexer).toBeDefined();
  });
});

// ─────────────────────────── runSetup：顺序 / 非阻塞 ───────────────────────────

describe('CBM-13 runSetup：后台安装不阻塞与顺序', () => {
  test('setup 启动后台安装且不 await；后台先于 tools/hooks', async () => {
    const order: string[] = [];
    const bgRoots: string[] = [];
    const pending = deferred<string | null>();
    const fake = createFakeSetupCtx({ order });

    await runSetup(fake.ctx, {
      loadConfig: () => ({
        codebaseMemory: { enabled: true, autoDownload: true, cacheDir: '/tmp/cbm-cache' },
      }),
      cbm: {
        startBackgroundInstall: async (opts) => {
          order.push('background');
          bgRoots.push(opts?.cacheRoot ?? '');
          return pending.promise; // 永不 resolve → 验证 setup 未等待
        },
        ensureInstalled: async () => pending.promise,
        createIndexer: () => createIndexerStub([]),
      },
    });

    // runSetup 已 resolve，即便后台安装仍 pending → 非阻塞。
    expect(bgRoots).toEqual(['/tmp/cbm-cache']);
    expect(order).toContain('background');
    expect(order.indexOf('background')).toBeLessThan(order.indexOf('tools'));
    expect(order.indexOf('background')).toBeLessThan(order.indexOf('hooks'));
    // 后台安装 Promise 仍 pending（未被 await）。
    let settled = false;
    pending.promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  test('autoDownload=false 时不触发后台安装', async () => {
    const bg: string[] = [];
    const fake = createFakeSetupCtx();
    await runSetup(fake.ctx, {
      loadConfig: () => ({
        codebaseMemory: { enabled: true, autoDownload: false, cacheDir: '/tmp/cbm-cache' },
      }),
      cbm: {
        startBackgroundInstall: async () => {
          bg.push('started');
          return null;
        },
      },
    });
    expect(bg).toEqual([]);
  });
});

// ─────────────────────────── runSetup：失败降级 ───────────────────────────

describe('CBM-13 runSetup：失败降级（fail-open）', () => {
  test('后台安装抛错 + MCP 注册失败：agents/tools/hooks/commands 仍注册，setup 不抛', async () => {
    const fake = createFakeSetupCtx({ mcpThrows: true });
    await expect(
      runSetup(fake.ctx, {
        loadConfig: () => ({
          codebaseMemory: { enabled: true, autoDownload: true, cacheDir: '/tmp/cbm-cache' },
        }),
        cbm: {
          startBackgroundInstall: async () => {
            throw new Error('bg install exploded');
          },
          createIndexer: () => createIndexerStub([]),
          logger: () => {},
        },
      }),
    ).resolves.toBeUndefined();

    // 非 CBM 接线完整：preset + cbm 命令、工具注册。
    expect(findCommand(fake.commands, 'preset')).toBeDefined();
    expect(findCommand(fake.commands, 'cbm')).toBeDefined();
    expect(fake.addedTools.length).toBeGreaterThan(0);
    expect(findTool(fake.addedTools, 'ast_grep_search')).toBeDefined();
  });
});

// ─────────────────────────── runSetup：共享 indexer ───────────────────────────

describe('CBM-13 runSetup：共享 indexer 被 tools/hooks/commands 复用', () => {
  test('tools（cbm_search_graph）使用注入的共享 indexer', async () => {
    const ensureIndexedCalls: Array<string | undefined> = [];
    const fake = createFakeSetupCtx();
    await runSetup(fake.ctx, {
      loadConfig: () => ({
        codebaseMemory: { enabled: true, autoDownload: false, cliFallback: true, cacheDir: '/tmp/cbm-cache' },
      }),
      cbm: {
        createIndexer: () => createIndexerStub(ensureIndexedCalls),
        ensureInstalled: async () => null, // 避免真实网络
      },
    });

    const tool = findTool(fake.addedTools, 'cbm_search_graph');
    await tool.execute({ query: 'Foo' }, { sessionID: 's1' });
    // 查询型工具的索引门控命中共享 stub 的 ensureIndexed（workspace '/ws'）。
    expect(ensureIndexedCalls).toContain('/ws');
  });

  test('commands（/cbm index）与 hooks（cbm-guidance.before）复用同一 indexer', async () => {
    const ensureIndexedCalls: Array<string | undefined> = [];
    const fake = createFakeSetupCtx();
    await runSetup(fake.ctx, {
      loadConfig: () => ({
        codebaseMemory: { enabled: true, autoDownload: false, cliFallback: true, cacheDir: '/tmp/cbm-cache' },
      }),
      cbm: {
        createIndexer: () => createIndexerStub(ensureIndexedCalls),
        ensureInstalled: async () => null,
      },
    });

    // /cbm index 通过 handlers.indexer（共享 stub）触发。
    const cbm = findCommand(fake.commands, 'cbm');
    await cbm.execute({ sessionID: 's1', prompt: { text: 'index' }, delivery: 'steer' });
    expect(ensureIndexedCalls.length).toBe(1);

    // cbm-guidance.before（最后一个 before hook）复用同一 indexer。
    const guidanceBefore = fake.beforeHooks[fake.beforeHooks.length - 1];
    await guidanceBefore!({ tool: 'cbm_search_graph', sessionID: 's1' });
    expect(ensureIndexedCalls.length).toBe(2);
  });
});
