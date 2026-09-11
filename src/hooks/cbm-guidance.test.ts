import { describe, expect, test } from 'bun:test';
import {
  buildGrepReadHint,
  createDirectMcpWriteGuard,
  createCbmIndexRepeatGuard,
  isIndexTriggerTool,
  CBM_GREP_READ_HINT_MARKER,
  CBM_GUIDANCE_MARKER,
  CBM_INDEX_REPEAT_MARKER,
  CBM_INDEX_REPEAT_COOLDOWN_MS,
  createCbmGuidanceHook,
  DEFAULT_CBM_GREP_READ_MIN_CALLS,
} from './cbm-guidance';
import type {
  EnsureIndexedOptions,
  IndexerHandle,
  IndexerOutcome,
} from '../cbm/indexer';

/**
 * CBM-11：CBM guidance / index health advisory hook。
 *
 * 覆盖语义：
 * - 首次结构化查询前检查索引（before，按 session 去重）；
 * - 索引未就绪时在结构化查询结果上追加引导（fail-open，不拦截）；
 * - 已索引项目对重复 grep/read 追加 advisory hint（同一 session 去重）；
 * - grep 的 text/comment/ast 模式与 glob / ast_grep 不提示；
 * - 尊重 codebaseMemory.guidance（guidanceEnabled=false 不提示）；
 * - 任何异常 fail-open：绝不抛错阻断合法工具。
 */

interface StubOpts {
  ensure?: (
    projectPath: string | undefined,
    opts: EnsureIndexedOptions,
  ) => Promise<IndexerOutcome>;
  indexed?: boolean;
}

function stubIndexer(opts: StubOpts = {}) {
  const calls: Array<{
    projectPath: string | undefined;
    workspaceRoot: string;
    autoIndex: boolean | undefined;
  }> = [];
  const indexer: IndexerHandle = {
    ensureIndexed: async (projectPath, eOpts) => {
      calls.push({
        projectPath,
        workspaceRoot: eOpts.workspaceRoot,
        autoIndex: eOpts.autoIndex,
      });
      if (opts.ensure) return opts.ensure(projectPath, eOpts);
      return { kind: 'indexed' };
    },
    isIndexed: () => opts.indexed ?? true,
    isIndexing: () => false,
    getLastOutcome: () => undefined,
    reset: () => {},
  };
  return { indexer, calls };
}

const resolveRoot = async (): Promise<string> => '/ws';

function makeEvent(over: Partial<Record<string, unknown>> = {}) {
  return {
    tool: 'read',
    sessionID: 's1',
    status: 'completed',
    result: { content: 'payload' },
    ...over,
  } as any;
}

describe('buildGrepReadHint', () => {
  test('返回带标记、codebase-memory-mcp 优先与 wrapper 兜底的结构化查询建议', () => {
    const hint = buildGrepReadHint('/ws');
    expect(hint).toContain(CBM_GREP_READ_HINT_MARKER);
    expect(hint).toContain('codebase-memory-mcp');
    expect(hint).toContain('list_projects');
    expect(hint).toContain('root_path');
    expect(hint).toContain('cbm_search_graph');
    expect(hint).toContain('/ws');
  });

  test('默认阈值常量为 3', () => {
    expect(DEFAULT_CBM_GREP_READ_MIN_CALLS).toBe(3);
  });
});

describe('direct MCP 写入保护', () => {
  test('拒绝已知写入型 direct MCP 工具，允许只读工具', async () => {
    const guard = createDirectMcpWriteGuard();
    await expect(guard({ tool: 'codebase-memory-mcp_delete_project' })).rejects.toThrow('只读查询');
    await expect(guard({ tool: 'codebase-memory-mcp.ingest_traces' })).rejects.toThrow('只读查询');
    await expect(guard({ tool: 'codebase-memory-mcp_search_graph' })).resolves.toBeUndefined();
  });
});

describe('cbm 索引重复触发 guard', () => {
  test('isIndexTriggerTool 匹配 wrapper 与 direct 两种命名形态', () => {
    expect(isIndexTriggerTool('cbm_index')).toBe(true);
    expect(isIndexTriggerTool('codebase-memory-mcp_index_repository')).toBe(true);
    expect(isIndexTriggerTool('codebase-memory-mcp.index_repository')).toBe(true);
    expect(isIndexTriggerTool('cbm_search_graph')).toBe(false);
    expect(isIndexTriggerTool('codebase-memory-mcp_search_graph')).toBe(false);
    expect(isIndexTriggerTool(undefined)).toBe(false);
  });

  test('同一 session 冷却窗内第二次触发被拦截，非索引工具不受影响', async () => {
    const guard = createCbmIndexRepeatGuard({ resolveRoot: async () => '/ws', cooldownMs: 300_000 });
    await expect(guard({ tool: 'cbm_index', sessionID: 's1' })).resolves.toBeUndefined();
    await expect(guard({ tool: 'cbm_index', sessionID: 's1' })).rejects.toThrow(CBM_INDEX_REPEAT_MARKER);
    await expect(guard({ tool: 'codebase-memory-mcp_index_repository', sessionID: 's1' })).rejects.toThrow(
      /冷却/,
    );
    // 非索引工具不经过 guard
    await expect(guard({ tool: 'cbm_search_graph', sessionID: 's1' })).resolves.toBeUndefined();
    await expect(guard({ tool: 'read', sessionID: 's1' })).resolves.toBeUndefined();
  });

  test('冷却窗外的触发放行；不同 session / 不同 root 相互独立', async () => {
    const guard = createCbmIndexRepeatGuard({ resolveRoot: async () => '/ws', cooldownMs: 50 });
    await expect(guard({ tool: 'cbm_index', sessionID: 's1' })).resolves.toBeUndefined();
    // 不同 session 同 root 不受 s1 冷却影响
    await expect(guard({ tool: 'cbm_index', sessionID: 's2' })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 60));
    // 冷却结束放行
    await expect(guard({ tool: 'cbm_index', sessionID: 's1' })).resolves.toBeUndefined();
  });

  test('resolveRoot 失败/无 sessionID 时 fail-open 不拦截', async () => {
    const guard = createCbmIndexRepeatGuard({ resolveRoot: async () => null });
    await expect(guard({ tool: 'cbm_index', sessionID: 's1' })).resolves.toBeUndefined();
    const throwing = createCbmIndexRepeatGuard({
      resolveRoot: async () => {
        throw new Error('boom');
      },
    });
    await expect(throwing({ tool: 'cbm_index', sessionID: 's1' })).resolves.toBeUndefined();
    await expect(guard({ tool: 'cbm_index' })).resolves.toBeUndefined();
  });

  test('默认冷却窗常量为 5 分钟', () => {
    expect(CBM_INDEX_REPEAT_COOLDOWN_MS).toBe(300_000);
  });
});

describe('cbm-guidance before：首次结构化查询前检查索引', () => {
  test('首次结构化查询触发一次 ensureIndexed，后续去重', async () => {
    const { indexer, calls } = stubIndexer({
      ensure: async () => ({ kind: 'indexed' }),
    });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      resolveRoot,
    });
    await hook.before(makeEvent({ tool: 'cbm_search_graph' }));
    await hook.before(makeEvent({ tool: 'cbm_trace', sessionID: 's1' }));
    expect(calls).toHaveLength(1);
    expect(calls[0].workspaceRoot).toBe('/ws');
  });

  test('非结构化工具不触发索引检查', async () => {
    const { indexer, calls } = stubIndexer();
    const hook = createCbmGuidanceHook({ indexer, guidanceEnabled: true, resolveRoot });
    await hook.before(makeEvent({ tool: 'read' }));
    await hook.before(makeEvent({ tool: 'glob' }));
    await hook.before(makeEvent({ tool: 'cbm_status' }));
    expect(calls).toHaveLength(0);
  });

  test('ensureIndexed 抛错时 fail-open：不抛错', async () => {
    const { indexer } = stubIndexer({
      ensure: async () => {
        throw new Error('boom');
      },
    });
    const hook = createCbmGuidanceHook({ indexer, guidanceEnabled: true, resolveRoot });
    await expect(
      hook.before(makeEvent({ tool: 'cbm_search_graph' })),
    ).resolves.toBeUndefined();
  });

  test('索引未就绪（indexing）时，结构化查询结果追加引导且不拦截', async () => {
    const { indexer } = stubIndexer({
      ensure: async () => ({ kind: 'indexing' }),
    });
    const hook = createCbmGuidanceHook({ indexer, guidanceEnabled: true, resolveRoot });
    await hook.before(makeEvent({ tool: 'cbm_search_graph' }));
    const event = makeEvent({ tool: 'cbm_search_graph', result: { content: '{}' } });
    await hook.after(event);
    expect(event.result.content).toContain(CBM_GUIDANCE_MARKER);
    expect(event.result.content).toContain('starting');
    expect(event.result.content).toContain('stale');
    expect(event.result.content).toContain('fail-open');
    // 原内容保留
    expect(event.result.content).toContain('{}');
  });

  test('索引已就绪（indexed）时，结构化查询结果不被追加', async () => {
    const { indexer } = stubIndexer({
      ensure: async () => ({ kind: 'indexed' }),
    });
    const hook = createCbmGuidanceHook({ indexer, guidanceEnabled: true, resolveRoot });
    await hook.before(makeEvent({ tool: 'cbm_search_graph' }));
    const event = makeEvent({ tool: 'cbm_search_graph', result: { content: '{"ok":true}' } });
    await hook.after(event);
    expect(event.result.content).not.toContain(CBM_GUIDANCE_MARKER);
  });
});

describe('cbm-guidance after：已索引项目对重复 grep/read 提示', () => {
  test('read 达到阈值后追加 hint，且同一 session 只提示一次', async () => {
    const { indexer } = stubIndexer({ indexed: true });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      minGrepReadCalls: 2,
      resolveRoot,
    });
    const first = makeEvent({ tool: 'read', result: { content: 'a' } });
    await hook.after(first);
    expect(first.result.content).not.toContain(CBM_GREP_READ_HINT_MARKER);

    const second = makeEvent({ tool: 'read', result: { content: 'b' } });
    await hook.after(second);
    expect(second.result.content).toContain(CBM_GREP_READ_HINT_MARKER);

    const third = makeEvent({ tool: 'read', result: { content: 'c' } });
    await hook.after(third);
    expect(third.result.content).toBe('c'); // 去重：不再追加
  });

  test('grep 不带 mode（或未知 mode）达到阈值后提示', async () => {
    const { indexer } = stubIndexer({ indexed: true });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      minGrepReadCalls: 1,
      resolveRoot,
    });
    const event = makeEvent({ tool: 'grep', input: {}, result: { content: 'hit' } });
    await hook.after(event);
    expect(event.result.content).toContain(CBM_GREP_READ_HINT_MARKER);
  });

  test('grep 的 text/comment/ast 模式不提示', async () => {
    const { indexer } = stubIndexer({ indexed: true });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      minGrepReadCalls: 1,
      resolveRoot,
    });
    for (const mode of ['text', 'comment', 'ast']) {
      const event = makeEvent({
        tool: 'grep',
        sessionID: `grep-${mode}`,
        input: { mode },
        result: { content: 'hit' },
      });
      await hook.after(event);
      expect(event.result.content).not.toContain(CBM_GREP_READ_HINT_MARKER);
    }
  });

  test('glob / ast_grep_search 不提示', async () => {
    const { indexer } = stubIndexer({ indexed: true });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      minGrepReadCalls: 1,
      resolveRoot,
    });
    for (const tool of ['glob', 'ast_grep_search']) {
      const event = makeEvent({ tool, sessionID: `t-${tool}`, result: { content: 'hit' } });
      await hook.after(event);
      expect(event.result.content).not.toContain(CBM_GREP_READ_HINT_MARKER);
    }
  });

  test('非已索引项目不提示', async () => {
    const { indexer } = stubIndexer({
      indexed: false,
      ensure: async () => ({ kind: 'skipped_auto_index_disabled' }),
    });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      minGrepReadCalls: 1,
      resolveRoot,
    });
    const event = makeEvent({ tool: 'read', result: { content: 'r' } });
    await hook.after(event);
    expect(event.result.content).not.toContain(CBM_GREP_READ_HINT_MARKER);
  });

  test('guidanceEnabled=false 不提示', async () => {
    const { indexer } = stubIndexer({ indexed: true });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: false,
      minGrepReadCalls: 1,
      resolveRoot,
    });
    const event = makeEvent({ tool: 'read', result: { content: 'r' } });
    await hook.after(event);
    expect(event.result.content).not.toContain(CBM_GREP_READ_HINT_MARKER);
  });

  test('非字符串结果 fail-open：不抛错、不改写', async () => {
    const { indexer } = stubIndexer({ indexed: true });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      minGrepReadCalls: 1,
      resolveRoot,
    });
    const event = makeEvent({
      tool: 'read',
      result: { output: { structured: true } },
    });
    await expect(hook.after(event)).resolves.toBeUndefined();
    expect(event.result.output).toEqual({ structured: true });
  });

  test('无法解析工作区根目录时 fail-open：不提示、不抛错', async () => {
    const { indexer } = stubIndexer({ indexed: true });
    const hook = createCbmGuidanceHook({
      indexer,
      guidanceEnabled: true,
      minGrepReadCalls: 1,
      resolveRoot: async () => null,
    });
    const event = makeEvent({ tool: 'read', result: { content: 'r' } });
    await expect(hook.after(event)).resolves.toBeUndefined();
    expect(event.result.content).toBe('r');
  });
});
