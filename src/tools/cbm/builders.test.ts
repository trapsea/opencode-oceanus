import { describe, expect, test } from 'bun:test';
import { buildCbmTools } from './index';
import type { IndexerHandle, IndexerRunCli } from '../../cbm/indexer';
import { CBM_TOOLS } from '../../cbm/registry';
import type { PluginConfig } from '../../config/schema';
import type { ToolContextLike, ToolDefinition, ToolingContext } from '../../runtime/types';

/**
 * CBM-09：CLI 兜底工具 builders 契约。
 *
 * 覆盖：注册门控（codebaseMemory.enabled / cliFallback / disabled_tools）、
 * 输入 schema 校验、cbm_status 不触发索引、cbm_index 显式索引、查询工具经
 * indexer 首次状态检查、cbm_trace 映射 canonical trace_path、cbm_query 只读
 * Cypher 子集、输出结构化归一化、workspace 根解析失败容错。
 *
 * 全部通过注入 fake runCli / stub indexer 驱动，不依赖真实二进制。
 */

const ROOT = '/ws';

function createMockCtx(opts: { root?: string; getThrows?: boolean } = {}) {
  const root = opts.root ?? ROOT;
  const ctx: ToolingContext = {
    tool: {
      transform: async (cb) => {
        cb({ add: () => {} });
      },
      hook: async () => {},
    },
    session: {
      get: async ({ sessionID }) => {
        if (opts.getThrows) throw new Error('host get unavailable');
        return { id: sessionID, location: { directory: root } };
      },
    },
  };
  return { ctx, root };
}

function okIndexer(calls?: { ensureIndexed: number }): IndexerHandle {
  return {
    ensureIndexed: async () => {
      if (calls) calls.ensureIndexed += 1;
      return { kind: 'indexed' };
    },
    isIndexed: () => true,
    isIndexing: () => false,
    getLastOutcome: () => undefined,
    runExclusive: (_p, _w, fn) => fn(),
    reset: () => {},
  };
}

/** 阻止索引的 indexer：一旦被调用立即抛错（用于断言“不应索引”的工具）。 */
function failIndexer(): IndexerHandle {
  return {
    ensureIndexed: async () => {
      throw new Error('该工具不应触发索引');
    },
    isIndexed: () => false,
    isIndexing: () => false,
    getLastOutcome: () => undefined,
    runExclusive: (_p, _w, fn) => fn(),
    reset: () => {},
  };
}

/** 记录每次 CLI 调用并返回结构化结果的 fake runCli。 */
function recordingRun(records: Array<{ tool: string; args: unknown }>) {
  const run: IndexerRunCli = async (options) => {
    records.push({ tool: options.tool, args: options.args });
    if (options.tool === 'index_status') return { ok: true, tool: options.tool, data: { indexed: true } };
    if (options.tool === 'index_repository') {
      return { ok: true, tool: options.tool, data: { status: 'indexing', in_progress: true } };
    }
    if (options.tool === 'search_graph') {
      return { ok: true, tool: options.tool, data: { matches: [{ name: 'Foo', file: 'a.ts', lines: [1, 2] }] } };
    }
    if (options.tool === 'trace_path') {
      return { ok: true, tool: options.tool, data: { results: [{ function: 'OrderHandler' }] } };
    }
    if (options.tool === 'get_code_snippet') {
      return { ok: true, tool: options.tool, data: { source: 'function foo() {}' } };
    }
    if (options.tool === 'query_graph') {
      return { ok: true, tool: options.tool, data: { nodes: [] } };
    }
    if (options.tool === 'detect_changes') {
      return { ok: true, tool: options.tool, data: { changed_files: ['b.ts'] } };
    }
    return { ok: true, tool: options.tool, data: {} };
  };
  return run;
}

function find(tools: ToolDefinition[], name: string): ToolDefinition {
  const t = tools.find((x) => x.name === name);
  expect(t, `tool ${name} 已构建`).toBeDefined();
  return t!;
}

async function exec(tool: ToolDefinition, input: unknown): Promise<any> {
  const result = await tool.execute(input, { sessionID: 's1' } as ToolContextLike);
  expect(typeof result.content).toBe('string');
  return JSON.parse(result.content as string);
}

// ─────────────────────────── 注册门控 ───────────────────────────

describe('buildCbmTools 注册门控', () => {
  test('仅配置 custom cacheDir 时，CLI 入口传递 cacheRoot 与 CBM_CACHE_DIR', async () => {
    let observed: any;
    const tools = buildCbmTools(
      createMockCtx().ctx,
      { codebaseMemory: { enabled: true, cliFallback: true, cacheDir: '/custom/cbm' } },
      { runCli: async (options) => { observed = options; return { ok: true, tool: options.tool, data: { installed: false } }; } },
    );
    await find(tools, 'cbm_status').execute({}, { sessionID: 's1' } as ToolContextLike);
    expect(observed.cacheRoot).toBe('/custom/cbm');
    expect(observed.env?.CBM_CACHE_DIR).toBe('/custom/cbm');
  });

  const ALL: readonly string[] = CBM_TOOLS;

  test('默认注册全部 7 个 cbm_* 工具', () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]) });
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL].sort());
  });

  test('codebaseMemory.enabled=false 时不注册任何 cbm 工具', () => {
    const { ctx } = createMockCtx();
    const config: PluginConfig = { codebaseMemory: { enabled: false } };
    expect(buildCbmTools(ctx, config, {})).toEqual([]);
  });

  test('codebaseMemory.cliFallback=false 时不注册任何 cbm 工具', () => {
    const { ctx } = createMockCtx();
    const config: PluginConfig = { codebaseMemory: { cliFallback: false } };
    expect(buildCbmTools(ctx, config, {})).toEqual([]);
  });

  test('disabled_tools 移除对应 cbm 工具', () => {
    const { ctx } = createMockCtx();
    const config: PluginConfig = { disabled_tools: ['cbm_query', 'cbm_code'] };
    const tools = buildCbmTools(ctx, config, { runCli: recordingRun([]) });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('cbm_query');
    expect(names).not.toContain('cbm_code');
    expect(names).toContain('cbm_search_graph');
  });

  test('单项 enabled:false 等价于禁用', () => {
    const { ctx } = createMockCtx();
    const config: PluginConfig = { tools: { cbm_trace: { enabled: false } } };
    const tools = buildCbmTools(ctx, config, { runCli: recordingRun([]) });
    expect(tools.map((t) => t.name)).not.toContain('cbm_trace');
  });
});

// ─────────────────────────── cbm_status 不触发索引 ───────────────────────────

describe('cbm_status：不触发索引', () => {
  test('只调用 index_status，绝不调用 index_repository / ensureIndexed', async () => {
    const { ctx } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: failIndexer() });
    const tool = find(tools, 'cbm_status');
    const res = await exec(tool, {});
    expect(records.map((r) => r.tool)).toEqual(['index_status']);
    expect(res.indexed).toBe(true);
  });

  test('workspace 根解析失败返回错误而非抛异常', async () => {
    const { ctx } = createMockCtx({ getThrows: true });
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: failIndexer() });
    const tool = find(tools, 'cbm_status');
    const res = await exec(tool, {});
    expect(res.error).toContain('无法解析');
  });
});

// ─────────────────────────── cbm_index 显式索引 ───────────────────────────

describe('cbm_index：显式触发索引', () => {
  test('调用 index_repository 并带 repository_path=workspace root', async () => {
    const { ctx, root } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: failIndexer() });
    const tool = find(tools, 'cbm_index');
    const res = await exec(tool, {});
    expect(records).toHaveLength(1);
    expect(records[0].tool).toBe('index_repository');
    expect((records[0].args as Record<string, unknown>).repository_path).toBe(root);
    expect(res.in_progress).toBe(true);
  });

  test('builder 将 cbm_index 映射到 index_repository CLI', async () => {
    const { ctx, root } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tool = find(buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: failIndexer() }), 'cbm_index');
    await exec(tool, {});
    expect(records[0]).toMatchObject({ tool: 'index_repository', args: { repository_path: root } });
  });
});

// ─────────────────────────── 查询工具经 indexer 首次状态检查 ───────────────────────────

describe('查询型工具经 indexer 首次状态检查', () => {
  test('cbm_search_graph 先 ensureIndexed 再执行查询', async () => {
    const { ctx } = createMockCtx();
    const counters = { ensureIndexed: 0 };
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, {
      runCli: recordingRun(records),
      indexer: okIndexer(counters),
    });
    const tool = find(tools, 'cbm_search_graph');
    const res = await exec(tool, { query: 'OrderHandler' });
    expect(counters.ensureIndexed).toBe(1);
    expect(records[records.length - 1].tool).toBe('search_graph');
    expect(res.matches[0].name).toBe('Foo');
  });

  test('indexer 降级（索引失败）时返回操作性提示并允许回退', async () => {
    const { ctx } = createMockCtx();
    const indexer: IndexerHandle = {
      ensureIndexed: async () => ({
        kind: 'degraded',
        reason: 'index_failed',
        errorCode: 'binary_missing',
        message: 'binary not found',
      }),
      isIndexed: () => false,
      isIndexing: () => false,
      getLastOutcome: () => undefined,
      reset: () => {},
    };
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer });
    const tool = find(tools, 'cbm_search_graph');
    const res = await exec(tool, { query: 'x' });
    expect(res.error).toBeTruthy();
    expect(String(res.error)).toMatch(/索引/);
  });
});

// ─────────────────────────── 输入 schema 校验 ───────────────────────────

describe('输入 schema 校验', () => {
  test('cbm_search_graph 缺少 query 返回错误', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_search_graph');
    const res = await exec(tool, {});
    expect(res.error).toContain('query 必填');
  });

  test('cbm_trace 缺少 symbol 返回错误', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_trace');
    const res = await exec(tool, {});
    expect(res.error).toContain('symbol 必填');
  });

  test('cbm_trace direction 必须是 inbound/outbound', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_trace');
    const res = await exec(tool, { symbol: 'foo', direction: 'sideways' });
    expect(res.error).toContain('direction');
  });

  test('cbm_code 缺少 qualified_name 返回错误', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_code');
    const res = await exec(tool, {});
    expect(res.error).toContain('qualified_name');
  });

  test('cbm_query 缺少 query 返回错误', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_query');
    const res = await exec(tool, {});
    expect(res.error).toContain('query 必填');
  });

  test('cbm_trace depth 越界（0/5/1.5）被拒绝', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_trace');
    for (const depth of [0, 5, 1.5]) {
      const res = await exec(tool, { symbol: 'OrderHandler', direction: 'inbound', depth });
      expect(res.error).toContain('depth 必须是 1 到 4 的整数');
    }
  });

  test('cbm_detect_changes depth（1/5）与 limit（0/1.5）被拒绝', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_detect_changes');
    for (const depth of [1, 5]) {
      const res = await exec(tool, { since: 'HEAD~1', depth });
      expect(res.error).toContain('depth 必须是 2 到 4 的整数');
    }
    for (const limit of [0, 1.5]) {
      const res = await exec(tool, { since: 'HEAD~1', limit });
      expect(res.error).toContain('limit 必须是正整数');
    }
  });
});

// ─────────────────────────── cbm_trace 映射 canonical trace_path ───────────────────────────

describe('cbm_trace 映射 canonical trace_path', () => {
  test('调用 trace_path（canonical），带 function_name、direction 与 depth', async () => {
    const { ctx } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: okIndexer() });
    const tool = find(tools, 'cbm_trace');
    const res = await exec(tool, { symbol: 'OrderHandler', direction: 'inbound', depth: 3 });
    const call = records[records.length - 1];
    expect(call.tool).toBe('trace_path');
    expect((call.args as Record<string, unknown>).function_name).toBe('OrderHandler');
    expect((call.args as Record<string, unknown>).direction).toBe('inbound');
    expect((call.args as Record<string, unknown>).depth).toBe(3);
    expect(res.results[0].function).toBe('OrderHandler');
  });
});

// ─────────────────────────── cbm_query 只读 Cypher 子集 ───────────────────────────

describe('cbm_query 只读 Cypher 子集', () => {
  test('写入型语句（DETACH DELETE）被拒绝', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_query');
    const res = await exec(tool, { query: 'MATCH (n) DETACH DELETE n' });
    expect(res.error).toContain('只允许只读');
  });

  test('CREATE / MERGE / SET / REMOVE 被拒绝', async () => {
    const { ctx } = createMockCtx();
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun([]), indexer: okIndexer() });
    const tool = find(tools, 'cbm_query');
    for (const q of ['CREATE (n)', 'MERGE (n)', 'MATCH (n) SET n.x=1', 'MATCH (n) REMOVE n.x']) {
      const res = await exec(tool, { query: q });
      expect(res.error).toContain('只允许只读');
    }
  });

  test('字符串字面量里的写入关键词不误报', async () => {
    const { ctx } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: okIndexer() });
    const tool = find(tools, 'cbm_query');
    const res = await exec(tool, { query: "MATCH (n) WHERE n.name = 'CREATE' RETURN n" });
    expect(res.error).toBeUndefined();
    expect((records[records.length - 1].args as Record<string, unknown>).query).toContain('WHERE');
  });

  test('只读查询正常通过', async () => {
    const { ctx } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: okIndexer() });
    const tool = find(tools, 'cbm_query');
    const res = await exec(tool, { query: 'MATCH (n) RETURN n LIMIT 5' });
    expect(res.error).toBeUndefined();
    expect(records[records.length - 1].tool).toBe('query_graph');
  });
});

// ─────────────────────────── cbm_code / cbm_detect_changes 映射 ───────────────────────────

describe('cbm_code / cbm_detect_changes 映射', () => {
  test('cbm_code 调用 get_code_snippet，带 qualified_name', async () => {
    const { ctx } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: okIndexer() });
    const tool = find(tools, 'cbm_code');
    const res = await exec(tool, { qualified_name: 'pkg.orders.OrderHandler' });
    const call = records[records.length - 1];
    expect(call.tool).toBe('get_code_snippet');
    expect((call.args as Record<string, unknown>).qualified_name).toBe('pkg.orders.OrderHandler');
    expect(res.source).toContain('function foo');
  });

  test('cbm_detect_changes 调用 detect_changes 并透传安全影响面参数', async () => {
    const { ctx } = createMockCtx();
    const records: Array<{ tool: string; args: unknown }> = [];
    const tools = buildCbmTools(ctx, {}, { runCli: recordingRun(records), indexer: okIndexer() });
    const tool = find(tools, 'cbm_detect_changes');
    const res = await exec(tool, { since: '2026-01-01', direction: 'inbound', depth: 3, limit: 50 });
    const call = records[records.length - 1];
    expect(call.tool).toBe('detect_changes');
    expect((call.args as Record<string, unknown>).since).toBe('2026-01-01');
    expect((call.args as Record<string, unknown>).direction).toBe('inbound');
    expect((call.args as Record<string, unknown>).depth).toBe(3);
    expect((call.args as Record<string, unknown>).limit).toBe(50);
    expect(res.changed_files).toEqual(['b.ts']);
  });
});

// ─────────────────────────── 错误归一化 ───────────────────────────

describe('错误结构化归一化', () => {
  test('CLI 失败返回结构化 error 而非抛异常', async () => {
    const { ctx } = createMockCtx();
    const run: IndexerRunCli = async (options) => ({
      ok: false,
      tool: options.tool,
      data: null,
      error: { code: 'binary_missing', message: 'not found' },
    });
    const tools = buildCbmTools(ctx, {}, { runCli: run, indexer: okIndexer() });
    const tool = find(tools, 'cbm_search_graph');
    const res = await exec(tool, { query: 'x' });
    expect(res.error).toContain('not found');
    expect(res.code).toBe('binary_missing');
  });
});
