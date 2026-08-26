import { describe, expect, test } from 'bun:test';
import { buildCliMissingMessage, parseSgOutput, runSg } from './cli';
import type { SpawnFn, SpawnOptions, SpawnProc } from './proc';
import type { ReplaceOptions, SearchOptions } from './types';

const ROOT = '/workspace/root';
const FAKE_CLI = '/usr/bin/ast-grep';

interface SpawnCall {
  command: string[];
  options?: SpawnOptions;
}

function procOf(
  stdout: string,
  opts: { stderr?: string; exitCode?: number } = {},
): SpawnProc {
  return {
    stdout: async () => stdout,
    stderr: async () => opts.stderr ?? '',
    exited: Promise.resolve(opts.exitCode ?? 0),
    kill: () => true,
    exitCode: null,
  };
}

/** 记录每次 spawn 的调用，并将 stdout/stderr/exitCode 交给 handler 决定。 */
function capturingSpawn(
  handler: (command: string[]) => SpawnProc,
): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = (command, options) => {
    calls.push({ command, options });
    return handler(command);
  };
  return { spawn, calls };
}

function matchJson(file: string, text: string, replacement?: string): string {
  const obj: Record<string, unknown> = {
    text,
    range: {
      byteOffset: { start: 0, end: text.length },
      start: { line: 0, column: 0 },
      end: { line: 0, column: text.length },
    },
    file,
    lines: text,
    charCount: { leading: 0, trailing: 1 },
    language: 'TypeScript',
    metaVariables: { single: {}, multi: {}, transformed: {} },
  };
  if (replacement !== undefined) obj.replacement = replacement;
  return JSON.stringify(obj);
}

const searchOptions: SearchOptions = {
  pattern: 'console.log($MSG)',
  lang: 'typescript',
  workspaceRoot: ROOT,
};

describe('parseSgOutput', () => {
  test('解析合法 JSON 数组', () => {
    const stdout = `[${matchJson('a.ts', 'console.log("x")')}]`;
    const result = parseSgOutput(stdout, { maxMatches: 100, maxOutputBytes: 1024 });
    expect(result.error).toBeUndefined();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].file).toBe('a.ts');
    expect(result.truncated).toBe(false);
    expect(result.totalMatches).toBe(1);
  });

  test('超过 maxMatches 时截断并标记原因', () => {
    const matches = Array.from({ length: 10 }, (_, i) =>
      matchJson(`f${i}.ts`, `x${i}`),
    ).join(',');
    const result = parseSgOutput(`[${matches}]`, { maxMatches: 3, maxOutputBytes: 100_000 });
    expect(result.matches).toHaveLength(3);
    expect(result.totalMatches).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('max_matches');
  });

  test('超过 maxOutputBytes 时截断并标记原因', () => {
    const matches = Array.from({ length: 20 }, (_, i) =>
      matchJson(`f${i}.ts`, `line ${i} `.repeat(50)),
    ).join(',');
    const result = parseSgOutput(`[${matches}]`, { maxMatches: 500, maxOutputBytes: 300 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('max_output_bytes');
  });

  test('非截断但无法解析时返回空结果', () => {
    const result = parseSgOutput('not json at all', { maxMatches: 100, maxOutputBytes: 1_000_000 });
    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

describe('runSg：CLI 缺失诊断', () => {
  test('resolveCli 返回 null 时给出安装诊断', async () => {
    const result = await runSg(searchOptions, { resolveCli: () => null });
    expect(result.matches).toHaveLength(0);
    expect(result.error).toMatch(/ast-grep CLI binary not found/);
    expect(result.error).toMatch(/bun add -D @ast-grep\/cli/);
    expect(result.error).toMatch(/AST_GREP_BIN/);
  });

  test('spawn 抛 ENOENT 时给出缺失诊断', async () => {
    const { spawn } = capturingSpawn(() => {
      const err = Object.assign(new Error('spawn sg ENOENT'), { code: 'ENOENT' });
      return {
        stdout: async () => {
          throw err;
        },
        stderr: async () => '',
        exited: Promise.reject(err),
        kill: () => true,
        exitCode: null,
      };
    });
    const result = await runSg(searchOptions, { spawn, resolveCli: () => FAKE_CLI });
    expect(result.error).toMatch(/ast-grep CLI binary not found/);
  });
});

describe('runSg：spawn 正常路径', () => {
  test('解析真实 JSON 输出', async () => {
    const stdout = `[${matchJson('a.ts', 'console.log("hi")')}]`;
    const { spawn } = capturingSpawn(() => procOf(stdout));
    const result = await runSg(searchOptions, { spawn, resolveCli: () => FAKE_CLI });
    expect(result.error).toBeUndefined();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].file).toBe('a.ts');
  });

  test('工作区路径越界时返回错误而非执行', async () => {
    let called = false;
    const { spawn } = capturingSpawn(() => {
      called = true;
      return procOf('[]');
    });
    const result = await runSg(
      { ...searchOptions, paths: ['../outside'] },
      { spawn, resolveCli: () => FAKE_CLI },
    );
    expect(called).toBe(false);
    expect(result.error).toMatch(/outside the workspace/i);
  });

  test('非零退出码 + 空 stdout + stderr 有内容时返回 stderr 错误', async () => {
    const { spawn } = capturingSpawn(() => procOf('', { stderr: 'bad pattern', exitCode: 1 }));
    const result = await runSg(searchOptions, { spawn, resolveCli: () => FAKE_CLI });
    expect(result.error).toBe('bad pattern');
  });

  test('非零退出码 + "No files found" 视为空结果而非错误', async () => {
    const { spawn } = capturingSpawn(() =>
      procOf('', { stderr: 'No files found', exitCode: 1 }),
    );
    const result = await runSg(searchOptions, { spawn, resolveCli: () => FAKE_CLI });
    expect(result.error).toBeUndefined();
    expect(result.matches).toHaveLength(0);
  });
});

describe('runSg：超时', () => {
  test('进程超时时返回 timeout 截断', async () => {
    const pending = () => new Promise<string>(() => {});
    const { spawn } = capturingSpawn(() => ({
      stdout: pending,
      stderr: pending,
      exited: pending as unknown as Promise<number>,
      kill: () => true,
      exitCode: null,
    }));
    const result = await runSg(
      { ...searchOptions, timeoutMs: 40 },
      { spawn, resolveCli: () => FAKE_CLI },
    );
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('timeout');
    expect(result.error).toMatch(/timeout/i);
  });
});

describe('runSg：替换 dry-run 与 apply', () => {
  test('dry-run（默认）单遍 report，不写文件', async () => {
    const stdout = `[${matchJson('a.ts', 'console.log("hi")', 'logger.info("hi")')}]`;
    const { spawn, calls } = capturingSpawn(() => procOf(stdout));
    const options: ReplaceOptions = { ...searchOptions, rewrite: 'logger.info($MSG)' };
    const result = await runSg(options, { spawn, resolveCli: () => FAKE_CLI });
    expect(result.error).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toContain('--json=compact');
    expect(calls[0].command).not.toContain('--update-all');
  });

  test('apply（dryRun:false）两遍：先 report 后 --update-all 写文件', async () => {
    const stdout = `[${matchJson('a.ts', 'console.log("hi")', 'logger.info("hi")')}]`;
    const { spawn, calls } = capturingSpawn(() => procOf(stdout));
    const options: ReplaceOptions = {
      ...searchOptions,
      rewrite: 'logger.info($MSG)',
      dryRun: false,
    };
    const result = await runSg(options, { spawn, resolveCli: () => FAKE_CLI });
    expect(result.error).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[0].command).toContain('--json=compact');
    expect(calls[0].command).not.toContain('--update-all');
    expect(calls[1].command).toContain('--update-all');
    expect(calls[1].command).not.toContain('--json=compact');
  });

  test('apply 第二遍失败时在结果中附带错误', async () => {
    const { spawn } = capturingSpawn((command) => {
      if (command.includes('--update-all')) {
        return procOf('', { stderr: 'apply exploded', exitCode: 1 });
      }
      return procOf(`[${matchJson('a.ts', 'console.log("hi")', 'logger.info("hi")')}]`);
    });
    const options: ReplaceOptions = {
      ...searchOptions,
      rewrite: 'logger.info($MSG)',
      dryRun: false,
    };
    const result = await runSg(options, { spawn, resolveCli: () => FAKE_CLI });
    expect(result.error).toBe('apply exploded');
  });
});

describe('buildCliMissingMessage', () => {
  test('包含安装指引与 AST_GREP_BIN 提示', () => {
    const msg = buildCliMissingMessage();
    expect(msg).toContain('bun add -D @ast-grep/cli');
    expect(msg).toContain('cargo install ast-grep');
    expect(msg).toContain('brew install ast-grep');
    expect(msg).toContain('AST_GREP_BIN');
  });
});
