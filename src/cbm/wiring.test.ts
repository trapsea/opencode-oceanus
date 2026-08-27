import { afterEach, describe, expect, test } from 'bun:test';
import { buildCbmSharedDeps } from './wiring';
import { getCacheRoot } from './paths';

const original = process.env.CBM_CACHE_DIR;
afterEach(() => {
  if (original === undefined) delete process.env.CBM_CACHE_DIR;
  else process.env.CBM_CACHE_DIR = original;
});

describe('CBM wiring cache root（方案 A，失败优先）', () => {
  test('显式 cacheDir > 外部 CBM_CACHE_DIR > 默认根', () => {
    process.env.CBM_CACHE_DIR = '/external/cbm';
    expect(buildCbmSharedDeps({ codebaseMemory: { cacheDir: '/explicit/cbm' } }).cacheRoot).toBe('/explicit/cbm');
    expect(buildCbmSharedDeps({}).cacheRoot).toBe('/external/cbm');
    delete process.env.CBM_CACHE_DIR;
    expect(buildCbmSharedDeps({}).cacheRoot).toBe(getCacheRoot());
  });

  test('setup 后环境变化不影响共享根快照，且冲突 options 不可覆盖', async () => {
    process.env.CBM_CACHE_DIR = '/snapshot/cbm';
    const seen: string[] = [];
    const shared = buildCbmSharedDeps({}, {
      ensureInstalled: async (opts) => { seen.push(opts?.cacheRoot ?? ''); return null; },
    });
    process.env.CBM_CACHE_DIR = '/changed/cbm';
    await shared.ensureInstalled({ cacheRoot: '/conflict/cbm' });
    await shared.uiEnsureInstalled({ cacheRoot: '/conflict/ui' });
    expect(shared.cacheRoot).toBe('/snapshot/cbm');
    expect(seen).toEqual(['/snapshot/cbm', '/snapshot/cbm']);
  });
});
