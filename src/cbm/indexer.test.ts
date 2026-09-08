import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import {
  createIndexer,
  normalizeIndexStatus,
  normalizeListProjects,
  type IndexerRunCli,
} from './indexer';
import type { CbmCliErrorCode, CbmCliResult, CbmExecOptions } from '../tools/cbm/types';

/**
 * CBM-06：索引生命周期和自动首次索引。
 *
 * 覆盖：已索引命中（会话缓存）、首次自动索引、并发首次查询共享同一个
 * indexing Promise、自动索引失败降级、项目切换隔离、autoIndex=false 允许
 * fallback、list_projects/index_status 结构化错误归一化。
 *
 * 测试注入 fake runCli，不依赖真实二进制 / 网络 / 缓存。
 */

const ROOT = '/workspace/root';

test('indexer 使用注入的同一 cache root', async () => {
  const calls: CbmExecOptions[] = [];
  const indexer = createIndexer({ cacheRoot: '/shared/cbm', runCli: async (opts) => {
    calls.push(opts);
    return okResult({ indexed: true });
  }} as never);
  await indexer.ensureIndexed(ROOT, { workspaceRoot: ROOT } as never);
  expect(calls[0]?.env?.CBM_CACHE_DIR).toBe('/shared/cbm');
});

function okResult(data: unknown, tool = 'index_status'): CbmCliResult {
  return { ok: true, tool, data };
}

function errResult(
  code: CbmCliErrorCode,
  message = 'boom',
  tool = 'index_status',
): CbmCliResult {
  return { ok: false, tool, data: null, error: { code, message } };
}

function fakeRunCli(
  handler: (opts: CbmExecOptions) => CbmCliResult | Promise<CbmCliResult>,
): { runCli: IndexerRunCli; calls: CbmExecOptions[] } {
  const calls: CbmExecOptions[] = [];
  const runCli: IndexerRunCli = async (opts) => {
    calls.push(opts);
    return handler(opts);
  };
  return { runCli, calls };
}

function argsOf(opts: CbmExecOptions): Record<string, unknown> {
  return (opts.args as Record<string, unknown>) ?? {};
}

describe('normalizeIndexStatus：list_projects/index_status 结果归一化', () => {
  test('indexed 状态', () => {
    expect(normalizeIndexStatus(okResult({ status: 'indexed' })).kind).toBe('indexed');
    expect(normalizeIndexStatus(okResult({ status: 'ready' })).kind).toBe('indexed');
    expect(normalizeIndexStatus(okResult({ indexed: true })).kind).toBe('indexed');
  });

  test('unindexed 状态（多种约定）', () => {
    expect(normalizeIndexStatus(okResult({ status: 'unindexed' })).kind).toBe('unindexed');
    expect(normalizeIndexStatus(okResult({ status: 'not_indexed' })).kind).toBe('unindexed');
    expect(normalizeIndexStatus(okResult({ status: 'not_initialized' })).kind).toBe('unindexed');
    expect(normalizeIndexStatus(okResult({ indexed: false })).kind).toBe('unindexed');
  });

  test('indexing / in_progress 状态统一为 starting', () => {
    expect(normalizeIndexStatus(okResult({ status: 'indexing' })).kind).toBe('starting');
    expect(normalizeIndexStatus(okResult({ in_progress: true })).kind).toBe('starting');
    expect(normalizeIndexStatus(okResult({ indexing: true })).kind).toBe('starting');
  });

  test('无法解析 → unknown，不误报已索引，并携带原始状态值供诊断', () => {
    expect(normalizeIndexStatus(okResult({ foo: 'bar' })).kind).toBe('unknown');
    expect(normalizeIndexStatus(okResult({})).kind).toBe('unknown');
    expect(normalizeIndexStatus(okResult(null)).kind).toBe('unknown');
    const info = normalizeIndexStatus(okResult({ status: 'weird_new_status' }));
    expect(info.kind).toBe('unknown');
    expect(info.errorCode).toBe('unparsed_status');
    expect(info.errorMessage).toContain('weird_new_status');
  });

  test('结构化错误 → unknown，保留错误码', () => {
    const info = normalizeIndexStatus(errResult('binary_missing'));
    expect(info.kind).toBe('unknown');
    expect(info.errorCode).toBe('binary_missing');
    expect(info.errorMessage).toBe('boom');
  });
});

describe('normalizeListProjects：项目列表归一化', () => {
  test('数组直接返回字符串项', () => {
    expect(normalizeListProjects(okResult(['/a', '/b'], 'list_projects'))).toEqual({
      ok: true,
      projects: ['/a', '/b'],
    });
  });

  test('对象含 projects 字段', () => {
    expect(
      normalizeListProjects(
        okResult({ projects: [{ path: '/a' }, '/b'] }, 'list_projects'),
      ),
    ).toEqual({ ok: true, projects: ['/b'] });
  });

  test('错误 → ok:false 且保留错误码', () => {
    const res = normalizeListProjects(errResult('exit_nonzero', 'x', 'list_projects'));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('exit_nonzero');
  });
});

describe('createIndexer：已索引命中（会话缓存）', () => {
  test('状态检查确认已索引后，后续调用直接命中缓存', async () => {
    let statusCalls = 0;
    let repoCalls = 0;
    const { runCli } = fakeRunCli((opts) => {
      if (opts.tool === 'index_repository') {
        repoCalls += 1;
        return okResult({}, 'index_repository');
      }
      statusCalls += 1;
      return okResult({ status: 'indexed' });
    });
    const h = createIndexer({ runCli });

    const o1 = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(o1.kind).toBe('indexed');

    const o2 = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(o2.kind).toBe('indexed');

    expect(statusCalls).toBe(1);
    expect(repoCalls).toBe(0);
    expect(h.isIndexed('proj', ROOT)).toBe(true);
  });
});

describe('createIndexer：未索引自动建图', () => {
  test('首次状态检查 unindexed → 自动触发一次 index_repository', async () => {
    const { runCli, calls } = fakeRunCli((opts) => {
      if (opts.tool === 'index_repository') return okResult({}, 'index_repository');
      return okResult({ status: 'unindexed' });
    });
    const h = createIndexer({ runCli });

    const outcome = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(outcome.kind).toBe('index_started');
    // index_started 仅表示已触发建图，不等同于 daemon 确认 indexed。
    expect(h.isIndexed('proj', ROOT)).toBe(false);

    const indexCalls = calls.filter((c) => c.tool === 'index_repository');
    expect(indexCalls).toHaveLength(1);
    expect(argsOf(indexCalls[0]).repo_path).toBe('proj');
  });

  test('autoIndex=false（工厂默认）允许 fallback，不触发任何 CLI 调用', async () => {
    let calls = 0;
    const { runCli } = fakeRunCli(() => {
      calls += 1;
      return okResult({ status: 'unindexed' });
    });
    const h = createIndexer({ runCli, autoIndex: false });

    const outcome = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(outcome.kind).toBe('skipped_auto_index_disabled');
    expect(calls).toBe(0);
  });

  test('单次调用 autoIndex=false 覆盖工厂默认，允许 fallback', async () => {
    let calls = 0;
    const { runCli } = fakeRunCli(() => {
      calls += 1;
      return okResult({ status: 'unindexed' });
    });
    const h = createIndexer({ runCli, autoIndex: true });

    const outcome = await h.ensureIndexed('proj', {
      workspaceRoot: ROOT,
      timeoutMs: 1000,
      autoIndex: false,
    });
    expect(outcome.kind).toBe('skipped_auto_index_disabled');
    expect(calls).toBe(0);
  });

  test('无项目路径 → skipped_no_project（允许 fallback）', async () => {
    let calls = 0;
    const { runCli } = fakeRunCli(() => {
      calls += 1;
      return okResult({ status: 'unindexed' });
    });
    const h = createIndexer({ runCli });
    const outcome = await h.ensureIndexed(undefined, { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(outcome.kind).toBe('skipped_no_project');
    expect(calls).toBe(0);
  });
});

describe('createIndexer：并发首次查询共享同一个 indexing Promise', () => {
  test('并发只建图一次', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let repoCalls = 0;
    const { runCli } = fakeRunCli(async (opts) => {
      if (opts.tool === 'index_repository') {
        repoCalls += 1;
        await gate;
        return okResult({}, 'index_repository');
      }
      return okResult({ status: 'unindexed' });
    });
    const h = createIndexer({ runCli });

    const p1 = h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    const p2 = h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });

    expect(h.isIndexing('proj', ROOT)).toBe(true);
    release();

    const [o1, o2] = await Promise.all([p1, p2]);
    expect(o1.kind).toBe('index_started');
    expect(o2.kind).toBe('index_started');
    expect(repoCalls).toBe(1);
  });
});

describe('createIndexer：自动索引失败降级', () => {
  test('index_repository 失败 → degraded，不抛异常，不缓存为已索引', async () => {
    const { runCli } = fakeRunCli((opts) => {
      if (opts.tool === 'index_repository') {
        return errResult('exit_nonzero', 'index failed', 'index_repository');
      }
      return okResult({ status: 'unindexed' });
    });
    const h = createIndexer({ runCli });

    const outcome = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(outcome.kind).toBe('degraded');
    expect(outcome.reason).toBe('index_failed');
    expect(outcome.errorCode).toBe('exit_nonzero');
    expect(h.isIndexed('proj', ROOT)).toBe(false);

    // 未缓存失败 → 允许重试，不抛异常
    const o2 = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(o2.kind).toBe('degraded');
  });

  test('index_status 状态检查失败 → degraded（降级），允许 fallback', async () => {
    const { runCli } = fakeRunCli(() => errResult('binary_missing'));
    const h = createIndexer({ runCli });

    const outcome = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(outcome.kind).toBe('degraded');
    expect(outcome.reason).toBe('index_status_failed');
    expect(outcome.errorCode).toBe('binary_missing');
  });

  test('runCli 抛异常 → degraded（fail-open），不把异常泄漏给调用方', async () => {
    const { runCli } = fakeRunCli(() => {
      throw new Error('spawn ENOENT');
    });
    const h = createIndexer({ runCli });

    const outcome = await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(outcome.kind).toBe('degraded');
    expect(outcome.reason).toBe('exception');
    expect(outcome.message).toMatch(/ENOENT/);
  });
});

describe('createIndexer：项目切换隔离', () => {
  test('A 的索引状态不影响 B，B 未索引时独立触发索引', async () => {
    const repo: string[] = [];
    const { runCli } = fakeRunCli((opts) => {
      if (opts.tool === 'index_repository') {
        repo.push(argsOf(opts).repo_path as string);
        return okResult({}, 'index_repository');
      }
      const p = argsOf(opts).project;
      return okResult({ status: p === 'projA' ? 'indexed' : 'unindexed' });
    });
    const h = createIndexer({ runCli });

    const oa = await h.ensureIndexed('projA', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(oa.kind).toBe('indexed');
    expect(h.isIndexed('projA', ROOT)).toBe(true);
    expect(h.isIndexed('projB', ROOT)).toBe(false);

    const ob = await h.ensureIndexed('projB', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(ob.kind).toBe('index_started');
    expect(repo).toEqual(['projB']);

    // A 仍为已索引且无需再检查
    const oa2 = await h.ensureIndexed('projA', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(oa2.kind).toBe('indexed');
  });

  test('reset 清空会话状态', async () => {
    const { runCli } = fakeRunCli(() => okResult({ status: 'indexed' }));
    const h = createIndexer({ runCli });
    await h.ensureIndexed('proj', { workspaceRoot: ROOT, timeoutMs: 1000 });
    expect(h.isIndexed('proj', ROOT)).toBe(true);
    h.reset();
    expect(h.isIndexed('proj', ROOT)).toBe(false);
  });
});

describe('runExclusive：cbm_index 并发去重', () => {
  test('同一项目并发调用只执行一次 fn，结果共享', async () => {
    let executions = 0;
    const h = createIndexer({ runCli: fakeRunCli(() => okResult({ status: 'indexed' })).runCli });
    const fn = async () => {
      executions += 1;
      await new Promise((r) => setTimeout(r, 20));
      return executions;
    };
    const [a, b, c] = await Promise.all([
      h.runExclusive('/w/proj', '/w', fn),
      h.runExclusive('/w/proj', '/w', fn),
      h.runExclusive('/w/proj', '/w', fn),
    ]);
    expect(executions).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
  });

  test('完成后再次调用重新执行（保留显式刷新语义）', async () => {
    let executions = 0;
    const h = createIndexer({ runCli: fakeRunCli(() => okResult({ status: 'indexed' })).runCli });
    const fn = async () => {
      executions += 1;
      return executions;
    };
    await h.runExclusive('/w/proj', '/w', fn);
    await h.runExclusive('/w/proj', '/w', fn);
    expect(executions).toBe(2);
  });

  test('不同项目互不合并；项目键缺失时直接执行', async () => {
    const runs: string[] = [];
    const h = createIndexer({ runCli: fakeRunCli(() => okResult({ status: 'indexed' })).runCli });
    await Promise.all([
      h.runExclusive('/w/a', '/w', async () => {
        runs.push('a');
      }),
      h.runExclusive('/w/b', '/w', async () => {
        runs.push('b');
      }),
      h.runExclusive(undefined, '/w', async () => {
        runs.push('none');
      }),
    ]);
    expect(runs.sort()).toEqual(['a', 'b', 'none']);
  });

  test('fn 失败后锁被释放，后续调用可重试', async () => {
    let attempts = 0;
    const h = createIndexer({ runCli: fakeRunCli(() => okResult({ status: 'indexed' })).runCli });
    await expect(
      h.runExclusive('/w/proj', '/w', async () => {
        attempts += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const ok = await h.runExclusive('/w/proj', '/w', async () => {
      attempts += 1;
      return 'recovered';
    });
    expect(ok).toBe('recovered');
    expect(attempts).toBe(2);
  });
});
