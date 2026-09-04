import { describe, expect, test } from 'bun:test';
import {
  AUTO_INDEX_DISABLED_MESSAGE,
  buildIndexingGuidance,
  INDEXING_IN_PROGRESS_MESSAGE,
  NO_PROJECT_MESSAGE,
} from './guidance';
import type { IndexerOutcome } from './indexer';

/**
 * CBM-06：索引生命周期引导提示。
 *
 * 覆盖：已索引 / 已自动索引（不回退）、索引启动中（starting）/过期（stale）、
 * autoIndex 关闭（回退原生工具）、无项目路径（回退）、失败降级
 * （不伪造完整索引结果）。
 */

describe('buildIndexingGuidance', () => {
  test('引导提示使用中文自然语言', () => {
    expect(INDEXING_IN_PROGRESS_MESSAGE).not.toMatch(/index is|Please|The /i);
  });
  test('indexed → ready，不回退', () => {
    const g = buildIndexingGuidance({ kind: 'indexed' });
    expect(g.kind).toBe('ready');
    expect(g.fallbackRecommended).toBe(false);
    expect(g.message).toMatch(/已索引/);
  });

  test('index_started → 进行中，建议回退', () => {
    const g = buildIndexingGuidance({ kind: 'index_started' });
    expect(g.kind).toBe('indexing_in_progress');
    expect(g.fallbackRecommended).toBe(true);
    expect(g.message).toMatch(/自动索引/);
  });

  test('indexing → starting/stale，建议 fail-open 回退', () => {
    const g = buildIndexingGuidance({ kind: 'indexing' });
    expect(g.kind).toBe('indexing_in_progress');
    expect(g.fallbackRecommended).toBe(true);
    expect(g.message).toContain('starting');
    expect(g.message).toContain('stale');
    expect(INDEXING_IN_PROGRESS_MESSAGE).toContain('fail-open');
  });

  test('skipped_auto_index_disabled → 回退原生工具，并给可操作提示', () => {
    const g = buildIndexingGuidance({ kind: 'skipped_auto_index_disabled' });
    expect(g.kind).toBe('auto_index_disabled');
    expect(g.fallbackRecommended).toBe(true);
    expect(g.message).toBe(AUTO_INDEX_DISABLED_MESSAGE);
    expect(g.message).toMatch(/autoIndex=false/);
    expect(g.message).toContain('cbm_index');
  });

  test('skipped_no_project → 回退', () => {
    const g = buildIndexingGuidance({ kind: 'skipped_no_project' });
    expect(g.kind).toBe('no_project');
    expect(g.fallbackRecommended).toBe(true);
    expect(g.message).toBe(NO_PROJECT_MESSAGE);
  });

  test('degraded → 回退，不伪造完整索引结果', () => {
    const g = buildIndexingGuidance({
      kind: 'degraded',
      reason: 'index_failed',
      errorCode: 'exit_nonzero',
      message: 'index failed',
    });
    expect(g.kind).toBe('degraded');
    expect(g.fallbackRecommended).toBe(true);
    expect(g.message).toMatch(/index_failed/);
    expect(g.message).toMatch(/index failed/);
    expect(g.message).toMatch(/不会伪造完整索引结果/);
  });
});

describe('INDEXING_IN_PROGRESS_MESSAGE 文案', () => {
  test('用于查询期间返回 starting/stale 引导', () => {
    expect(INDEXING_IN_PROGRESS_MESSAGE).toBeTruthy();
    const g: IndexerOutcome = { kind: 'indexing' };
    expect(buildIndexingGuidance(g).message).toBe(INDEXING_IN_PROGRESS_MESSAGE);
  });
});
