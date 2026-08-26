import { describe, expect, test } from 'bun:test';
import { formatReplaceResult, formatSearchResult, getEmptyResultHint } from './utils';
import type { CliMatch, SgResult } from './types';

function match(file: string, line: number, text: string, replacement?: string): CliMatch {
  return {
    file,
    range: {
      byteOffset: { start: 0, end: text.length },
      start: { line, column: 0 },
      end: { line, column: text.length },
    },
    lines: text,
    text,
    language: 'TypeScript',
    ...(replacement !== undefined ? { replacement } : {}),
  };
}

function result(matches: CliMatch[], opts: Partial<SgResult> = {}): SgResult {
  return { matches, totalMatches: matches.length, truncated: false, ...opts };
}

describe('formatSearchResult', () => {
  test('错误透传', () => {
    expect(formatSearchResult({ matches: [], totalMatches: 0, truncated: false, error: 'boom' }))
      .toBe('Error: boom');
  });

  test('空结果', () => {
    expect(formatSearchResult({ matches: [], totalMatches: 0, truncated: false }))
      .toBe('No matches found.');
  });

  test('按文件分组并标注截断', () => {
    const out = formatSearchResult(
      result([match('a.ts', 0, 'console.log("x")'), match('b.ts', 2, 'foo()')], {
        totalMatches: 2,
        truncated: true,
        truncatedReason: 'max_matches',
      }),
    );
    expect(out).toContain('a.ts:');
    expect(out).toContain('b.ts:');
    expect(out).toContain('1: console.log("x")');
    expect(out).toContain('3: foo()');
    expect(out).toContain('Found 2 matches in 2 files');
    expect(out).toContain('output truncated: max_matches');
  });
});

describe('formatReplaceResult', () => {
  test('dry-run 标注', () => {
    const out = formatReplaceResult(
      result([match('a.ts', 0, 'console.log("x")', 'logger.info("x")')], { totalMatches: 1 }),
      true,
    );
    expect(out).toContain('[DRY RUN]');
    expect(out).toContain('"console.log("x")" → "logger.info("x")"');
    expect(out).toContain('run with dryRun=false');
  });

  test('applied 标注', () => {
    const out = formatReplaceResult(
      result([match('a.ts', 0, 'x', 'y')], { totalMatches: 1 }),
      false,
    );
    expect(out).toContain('[APPLIED]');
    expect(out).not.toContain('dryRun=false');
  });
});

describe('getEmptyResultHint', () => {
  test('Python 尾部冒号提示', () => {
    expect(getEmptyResultHint('def foo():', 'python')).toContain('Remove trailing colon');
    expect(getEmptyResultHint('class Foo:', 'python')).toContain('Remove trailing colon');
    expect(getEmptyResultHint('def foo()', 'python')).toBeNull();
  });

  test('JS 函数体提示', () => {
    expect(getEmptyResultHint('function $NAME', 'typescript')).toContain('$$$');
    expect(getEmptyResultHint('const x = 1', 'typescript')).toBeNull();
  });
});
