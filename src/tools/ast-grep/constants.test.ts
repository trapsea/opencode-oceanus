import { existsSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  findSgCliPathSync,
  isAstGrepVersionOutput,
  verifyAstGrepBinary,
  type VersionProbeFn,
} from './constants';

/**
 * 针对 `--version` 验证逻辑的回归测试。
 *
 * 背景：`findSgCliPathSync()` 之前只按文件大小接受 PATH 候选，会把 Linux
 * `/usr/bin/sg -> newgrp` 误判为 ast-grep。修复后每个候选在返回前都要通过
 * 轻量 `--version` 验证，输出必须明确包含 `ast-grep`。
 *
 * 这些测试只依赖注入的探测函数（不要求环境装有 ast-grep），唯一例外是
 * 存在真实 `/usr/bin/sg` 时的回归断言。
 */

describe('isAstGrepVersionOutput', () => {
  test('接受典型 ast-grep 版本输出', () => {
    expect(isAstGrepVersionOutput('ast-grep 0.34.1')).toBe(true);
    expect(isAstGrepVersionOutput('ast-grep 0.29.3\n')).toBe(true);
    expect(isAstGrepVersionOutput('AST-GREP 0.1.0')).toBe(true);
  });

  test('拒绝 GNU sg/newgrp 及其它同名程序的输出', () => {
    // newgrp 对未知参数/组的报错，或纯空输出，都不含 ast-grep。
    expect(isAstGrepVersionOutput('sg: unknown group --version')).toBe(false);
    expect(isAstGrepVersionOutput('newgrp: no such group')).toBe(false);
    expect(isAstGrepVersionOutput('')).toBe(false);
    expect(isAstGrepVersionOutput('sg (util-linux) 2.39.3')).toBe(false);
  });
});

describe('verifyAstGrepBinary', () => {
  const probeReturning = (output: string | null): VersionProbeFn => () => output;

  test('探测输出含 ast-grep 时通过', () => {
    expect(
      verifyAstGrepBinary('/tmp/fake-sg', { probe: probeReturning('ast-grep 0.34.1') }),
    ).toBe(true);
  });

  test('探测输出不含 ast-grep 时拒绝（newgrp 场景）', () => {
    expect(
      verifyAstGrepBinary('/usr/bin/sg', {
        probe: probeReturning('sg: unknown group --version'),
      }),
    ).toBe(false);
  });

  test('探测失败（spawn 错误 / null）时安全拒绝，不抛异常', () => {
    expect(verifyAstGrepBinary('/no/such/bin', { probe: probeReturning(null) })).toBe(
      false,
    );
  });

  test('探测输出为空字符串时拒绝', () => {
    expect(verifyAstGrepBinary('/usr/bin/sg', { probe: probeReturning('') })).toBe(
      false,
    );
  });

  test('超时被传递给探测函数', () => {
    let seenTimeout = 0;
    const probe: VersionProbeFn = (_file, timeoutMs) => {
      seenTimeout = timeoutMs;
      return null;
    };
    verifyAstGrepBinary('/usr/bin/sg', { probe, timeoutMs: 123 });
    expect(seenTimeout).toBe(123);
  });
});

describe('findSgCliPathSync 候选验证（注入探测）', () => {
  test('AST_GREP_BIN 候选验证失败时不返回，而是继续搜索并最终返回 null', () => {
    // 探测一律返回非 ast-grep 输出，模拟所有候选（含误判的 sg）都不可用。
    const previous = process.env.AST_GREP_BIN;
    process.env.AST_GREP_BIN = '/usr/bin/sg';
    try {
      const result = findSgCliPathSync({
        probe: () => 'sg: unknown group --version',
        timeoutMs: 500,
      });
      // 关键是绝不返回被拒绝的 /usr/bin/sg 候选。
      expect(result).not.toBe('/usr/bin/sg');
    } finally {
      if (previous === undefined) delete process.env.AST_GREP_BIN;
      else process.env.AST_GREP_BIN = previous;
    }
  });
});

// 仅在真实 /usr/bin/sg（GNU newgrp）存在时运行的真实回归断言。
const realSg = '/usr/bin/sg';
const hasRealSg = existsSync(realSg);

describe('真实 /usr/bin/sg 回归', () => {
  test(`verifyAstGrepBinary(${realSg}) 必须为 false${hasRealSg ? '' : '（跳过：文件不存在）'}`, () => {
    if (!hasRealSg) return;
    // 真实探测：/usr/bin/sg --version 不应输出 ast-grep。
    expect(verifyAstGrepBinary(realSg, { timeoutMs: 3000 })).toBe(false);
  });
});
