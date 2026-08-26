import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  WorkspaceBoundaryError,
  buildSgArgs,
  isPathWithinRoot,
  resolveWorkspacePaths,
  shouldApplyChanges,
} from './args';
import type { ReplaceOptions, SearchOptions } from './types';

const ROOT = '/workspace/root';

describe('buildSgArgs', () => {
  test('搜索：构造 run -p -lang --json=compact 并默认路径为 [.]', () => {
    const options: SearchOptions = { pattern: 'console.log($MSG)', lang: 'typescript' };
    expect(buildSgArgs(options, 'report')).toEqual([
      'run', '-p', 'console.log($MSG)', '--lang', 'typescript', '--json=compact', '.',
    ]);
  });

  test('搜索：保留 paths / globs / context', () => {
    const options: SearchOptions = {
      pattern: 'console.log($MSG)',
      lang: 'tsx',
      paths: ['src', 'lib'],
      globs: ['!**/*.test.ts'],
      context: 2,
    };
    const args = buildSgArgs(options, 'report');
    expect(args).toContain('src');
    expect(args).toContain('lib');
    expect(args).toContain('--globs');
    expect(args).toContain('!**/*.test.ts');
    expect(args).toContain('-C');
    expect(args).toContain('2');
  });

  test('替换 report：带 -r 但不带 --update-all', () => {
    const options: ReplaceOptions = {
      pattern: 'console.log($MSG)',
      rewrite: 'logger.info($MSG)',
      lang: 'typescript',
    };
    const args = buildSgArgs(options, 'report');
    expect(args).toContain('-r');
    expect(args).toContain('logger.info($MSG)');
    expect(args).not.toContain('--update-all');
    expect(args).toContain('--json=compact');
  });

  test('替换 apply：去掉 --json，加 --update-all', () => {
    const options: ReplaceOptions = {
      pattern: 'console.log($MSG)',
      rewrite: 'logger.info($MSG)',
      lang: 'typescript',
      dryRun: false,
    };
    const args = buildSgArgs(options, 'apply');
    expect(args).toContain('--update-all');
    expect(args).not.toContain('--json=compact');
    expect(args).toContain('-r');
  });

  test('apply 模式下缺少 rewrite 抛错', () => {
    const options: SearchOptions = { pattern: 'x', lang: 'typescript' };
    expect(() => buildSgArgs(options, 'apply')).toThrow(/rewrite/);
  });
});

describe('shouldApplyChanges', () => {
  test('dryRun 为 false 时才应应用写文件', () => {
    expect(shouldApplyChanges({ pattern: 'x', lang: 'ts', rewrite: 'y', dryRun: false })).toBe(true);
    expect(shouldApplyChanges({ pattern: 'x', lang: 'ts', rewrite: 'y', dryRun: true })).toBe(false);
    expect(shouldApplyChanges({ pattern: 'x', lang: 'ts', rewrite: 'y' })).toBe(false);
    expect(shouldApplyChanges({ pattern: 'x', lang: 'ts' })).toBe(false);
  });
});

describe('工作区路径边界', () => {
  test('根内路径（含 glob 与绝对路径）被允许', () => {
    expect(isPathWithinRoot('src', ROOT)).toBe(true);
    expect(isPathWithinRoot('./src', ROOT)).toBe(true);
    expect(isPathWithinRoot('src/**/*.ts', ROOT)).toBe(true);
    expect(isPathWithinRoot('lib/**', ROOT)).toBe(true);
    expect(isPathWithinRoot(join(ROOT, 'a', 'b.ts'), ROOT)).toBe(true);
  });

  test('根外路径被拒绝', () => {
    expect(isPathWithinRoot('../outside', ROOT)).toBe(false);
    expect(isPathWithinRoot('../../etc/passwd', ROOT)).toBe(false);
    expect(isPathWithinRoot('/etc/passwd', ROOT)).toBe(false);
    expect(isPathWithinRoot('src/../../escape', ROOT)).toBe(false);
  });

  test('resolveWorkspacePaths 默认 [.] 并返回解析后的根', () => {
    const resolved = resolveWorkspacePaths(undefined, ROOT);
    expect(resolved.paths).toEqual(['.']);
    expect(resolved.cwd).toBe(ROOT);
  });

  test('resolveWorkspacePaths 对根外路径抛出 WorkspaceBoundaryError', () => {
    expect(() => resolveWorkspacePaths(['../outside'], ROOT)).toThrow(WorkspaceBoundaryError);
    expect(() => resolveWorkspacePaths(['/etc/passwd'], ROOT)).toThrow(WorkspaceBoundaryError);
  });

  test('resolveWorkspacePaths 错误消息包含请求路径与根', () => {
    try {
      resolveWorkspacePaths(['../evil'], ROOT);
      throw new Error('should not reach');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkspaceBoundaryError);
      const err = e as WorkspaceBoundaryError;
      expect(err.message).toContain('../evil');
      expect(err.message).toContain(ROOT);
      expect(err.message).toMatch(/outside the workspace/i);
    }
  });
});
