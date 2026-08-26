import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { findSgCliPathSync } from './constants';
import { runSg } from './cli';
import type { ReplaceOptions, SearchOptions } from './types';

/**
 * 针对真实 ast-grep CLI 的集成测试。
 *
 * 需要 AST_GREP_BIN 指向可用的 ast-grep 二进制（或 PATH 上能找到），
 * 否则测试跳过。运行方式示例：
 *   AST_GREP_BIN=/path/to/ast-grep bun test src/tools/ast-grep/integration.test.ts
 */

const tempDirs: string[] = [];

function requireBinary(): string | null {
  return process.env.AST_GREP_BIN || findSgCliPathSync();
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oceanus-astgrep-'));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(dir: string): Promise<string> {
  const file = join(dir, 'a.ts');
  await writeFile(
    file,
    'function hello() {\n  console.log("hi");\n  console.log("yo");\n}\n',
  );
  return file;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe('集成：真实 ast-grep CLI', () => {
  test('搜索并返回结构化匹配', async () => {
    const bin = requireBinary();
    if (!bin) return;
    const dir = await tempDir();
    await writeFixture(dir);

    const options: SearchOptions = {
      pattern: 'console.log($MSG)',
      lang: 'typescript',
      workspaceRoot: dir,
    };
    const result = await runSg(options);

    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    for (const m of result.matches) {
      expect(m.text).toMatch(/^console\.log/);
      expect(m.file).toBe('a.ts');
    }
  });

  test('替换 dry-run：预览 replacement 且不改写文件', async () => {
    const bin = requireBinary();
    if (!bin) return;
    const dir = await tempDir();
    const file = await writeFixture(dir);
    const before = await readFile(file, 'utf8');

    const options: ReplaceOptions = {
      pattern: 'console.log($MSG)',
      rewrite: 'logger.info($MSG)',
      lang: 'typescript',
      workspaceRoot: dir,
      dryRun: true,
    };
    const result = await runSg(options);

    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.matches[0].replacement).toMatch(/^logger\.info/);
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  test('替换 apply：真正改写文件', async () => {
    const bin = requireBinary();
    if (!bin) return;
    const dir = await tempDir();
    const file = await writeFixture(dir);

    const options: ReplaceOptions = {
      pattern: 'console.log($MSG)',
      rewrite: 'logger.info($MSG)',
      lang: 'typescript',
      workspaceRoot: dir,
      dryRun: false,
    };
    const result = await runSg(options);

    expect(result.error).toBeUndefined();
    const after = await readFile(file, 'utf8');
    expect(after).toContain('logger.info("hi")');
    expect(after).not.toContain('console.log("hi")');
  });

  test('工作区路径越界被拒绝', async () => {
    const bin = requireBinary();
    if (!bin) return;
    const dir = await tempDir();
    await writeFixture(dir);

    const options: SearchOptions = {
      pattern: 'console.log($MSG)',
      lang: 'typescript',
      workspaceRoot: dir,
      paths: ['../outside'],
    };
    const result = await runSg(options);
    expect(result.error).toMatch(/outside the workspace/i);
  });
});
