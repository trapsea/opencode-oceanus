import { describe, expect, test } from 'bun:test';
import { SISYPHUS_REVIEW_SKILL } from './sisyphus-review';

const { content, description } = SISYPHUS_REVIEW_SKILL;

describe('Review CBM budget/fail-open contract', () => {
  test('纯文档 diff 跳过索引', () => {
    expect(content).toMatch(/纯文档 diff[\s\S]{0,100}跳过.*cbm_index/);
  });

  test('首次成功与一次重试受预算约束', () => {
    expect(content).toMatch(/首次.*30 秒/);
    expect(content).toMatch(/最多.*重试一次.*60 秒/);
    expect(content).toMatch(/总预算.*90 秒/);
  });

  test('预算耗尽 fail-open 并记录 stale', () => {
    expect(content).toMatch(/预算耗尽[\s\S]{0,100}cbm: stale/);
    expect(content).toMatch(/grep\/read.*手工 diff[\s\S]{0,80}不得阻断|继续/);
  });

  test('Completion Audit 缺口退回 Execute 且按 evidence tier', () => {
    expect(content).toMatch(/evidence tier/i);
    expect(content).toMatch(/缺口.*退回 execute/i);
  });

  test('frontmatter 与 TypeScript description 各自唯一', () => {
    expect((content.match(/^description:/gm) ?? []).length).toBe(1);
    expect(description).toBeTruthy();
  });
});
