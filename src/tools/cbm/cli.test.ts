import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCbmMissingMessage, resolveCbmBinaryPath, runCbmCli } from './cli';
import type { SpawnFn, SpawnOptions, SpawnProc } from '../../cbm/process';
import type { CbmIndexer } from './types';

/**
 * CBM-03：CLI 执行器 `cli <tool> <json>` 契约。
 *
 * 覆盖：无 shell 的参数数组 spawn、二进制解析优先级（binaryPath→缓存→PATH）、
 * 路径越界、超时/退出码/ENOENT/非 JSON/超大输出结构化错误、环境白名单、
 * trace_path canonical + trace_call_path fallback、ensureInstalled/indexer 注入。
 */

const ROOT = '/workspace/root';
const FAKE_BIN = '/opt/cbm/codebase-memory-mcp';

function withEnv(name: string, value: string, fn: () => void): void {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

interface SpawnCall {
  command: string[];
  options?: SpawnOptions;
}

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

const searchOpts = {
  tool: 'search_graph',
  args: { query: 'findMe' },
  workspaceRoot: ROOT,
};

describe('runCbmCli：命令构建（无 shell）', () => {
  test('命令是 `cli <tool> <json>` 参数数组', async () => {
    const { spawn, calls } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(searchOpts, { spawn, resolveBinary: () => FAKE_BIN });
    expect(result.ok).toBe(true);
    expect(Array.isArray(calls[0].command)).toBe(true);
    expect(calls[0].command).toEqual([
      FAKE_BIN,
      'cli',
      'search_graph',
      '{"query":"findMe"}',
    ]);
  });

  test('真实 spawn：参数原样传递，不经过 shell 解释', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cbm-noshell-'));
    try {
      const script = join(dir, 'echo-args');
      writeFileSync(
        script,
        '#!/bin/sh\nprintf "%s" "$3" > "$CBM_OUT"\n',
        { mode: 0o755 },
      );
      const out = join(dir, 'out.txt');
      const query = 'a;b $(danger) `x` * ? | & c';
      const result = await runCbmCli({
        tool: 'search_graph',
        args: { query },
        binaryPath: script,
        workspaceRoot: dir,
        env: { CBM_OUT: out },
      });
      expect(result.ok).toBe(true);
      const written = readFileSync(out, 'utf8');
      expect(written).toBe(JSON.stringify({ query }));
      expect(written).toContain('$(danger)');
      expect(written).toContain('`x`');
      expect(written).toContain('a;b');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runCbmCli：二进制解析', () => {
  test('显式 binaryPath 最高优先级', async () => {
    const { spawn, calls } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(
      { ...searchOpts, binaryPath: FAKE_BIN },
      { spawn, resolveBinary: () => '/ignored', ensureInstalled: async () => '/ignored' },
    );
    expect(result.ok).toBe(true);
    expect(calls[0].command[0]).toBe(FAKE_BIN);
  });

  test('二进制缺失 → binary_missing 诊断', async () => {
    const result = await runCbmCli(searchOpts, { resolveBinary: () => null });
    expect(result.error?.code).toBe('binary_missing');
    expect(result.error?.message).toMatch(/not found/);
  });

  test('解析顺序：缓存命中（current.json）', () => {
    const cache = mkdtempSync(join(tmpdir(), 'cbm-cache-'));
    try {
      withEnv('XDG_CACHE_HOME', cache, () => {
        const bin = join(
          cache,
          'opencode-oceanus',
          'codebase-memory-mcp',
          'versions',
          '0.10.8',
          'linux-x64',
          'codebase-memory-mcp',
        );
        mkdirSync(dirname(bin), { recursive: true });
        writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
        writeFileSync(
          join(
            cache,
            'opencode-oceanus',
            'codebase-memory-mcp',
            'current.json',
          ),
          JSON.stringify({ version: '0.10.8', platform: 'linux-x64' }),
        );
        expect(resolveCbmBinaryPath({})).toBe(bin);
      });
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  test('解析顺序：缓存无 current.json 时回退 PATH', () => {
    const cache = mkdtempSync(join(tmpdir(), 'cbm-empty-cache-'));
    const pathDir = mkdtempSync(join(tmpdir(), 'cbm-path-'));
    try {
      withEnv('XDG_CACHE_HOME', cache, () => {
        withEnv('PATH', pathDir, () => {
          const bin = join(pathDir, 'codebase-memory-mcp');
          writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
          expect(resolveCbmBinaryPath({})).toBe(bin);
        });
      });
    } finally {
      rmSync(cache, { recursive: true, force: true });
      rmSync(pathDir, { recursive: true, force: true });
    }
  });

  test('解析顺序：binaryPath 优先于缓存', () => {
    const cache = mkdtempSync(join(tmpdir(), 'cbm-cache2-'));
    try {
      withEnv('XDG_CACHE_HOME', cache, () => {
        const explicit = join(cache, 'explicit-bin');
        writeFileSync(explicit, 'x', { mode: 0o755 });
        expect(resolveCbmBinaryPath({ binaryPath: explicit })).toBe(explicit);
      });
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});

describe('runCbmCli：路径越界', () => {
  test('projectPath 越界 → workspace_boundary，不执行 spawn', async () => {
    let called = false;
    const { spawn } = capturingSpawn(() => {
      called = true;
      return procOf('{}');
    });
    const result = await runCbmCli(
      { tool: 'index_repository', args: {}, projectPath: '../outside', workspaceRoot: ROOT },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(called).toBe(false);
    expect(result.error?.code).toBe('workspace_boundary');
  });

  test('从 args.repository_path 提取并校验越界', async () => {
    let called = false;
    const { spawn } = capturingSpawn(() => {
      called = true;
      return procOf('{}');
    });
    const result = await runCbmCli(
      { tool: 'index_repository', args: { repository_path: '/etc' }, workspaceRoot: ROOT },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(called).toBe(false);
    expect(result.error?.code).toBe('workspace_boundary');
  });

  test('路径位于 workspace 内时正常执行', async () => {
    const { spawn } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(
      { tool: 'index_repository', args: { repository_path: '.' }, projectPath: '.', workspaceRoot: ROOT },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(result.ok).toBe(true);
  });
});

describe('runCbmCli：结构化错误', () => {
  test('非零退出码 + stderr → exit_nonzero', async () => {
    const { spawn } = capturingSpawn(() => procOf('', { stderr: 'boom', exitCode: 3 }));
    const result = await runCbmCli(searchOpts, { spawn, resolveBinary: () => FAKE_BIN });
    expect(result.error?.code).toBe('exit_nonzero');
    expect(result.error?.exitCode).toBe(3);
    expect(result.error?.message).toBe('boom');
  });

  test('非 JSON 输出 → invalid_json', async () => {
    const { spawn } = capturingSpawn(() => procOf('this is not json'));
    const result = await runCbmCli(searchOpts, { spawn, resolveBinary: () => FAKE_BIN });
    expect(result.error?.code).toBe('invalid_json');
  });

  test('超大输出 → output_oversize', async () => {
    const big = 'x'.repeat(200);
    const { spawn } = capturingSpawn(() => procOf(JSON.stringify({ data: big })));
    const result = await runCbmCli(
      { ...searchOpts, maxOutputBytes: 100 },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(result.error?.code).toBe('output_oversize');
    expect(result.truncatedReason).toBe('max_output_bytes');
  });

  test('超时 → timeout', async () => {
    const pending = () => new Promise<string>(() => {});
    const { spawn } = capturingSpawn(() => ({
      stdout: pending,
      stderr: pending,
      exited: pending as unknown as Promise<number>,
      kill: () => true,
      exitCode: null,
    }));
    const result = await runCbmCli(
      { ...searchOpts, timeoutMs: 40 },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(result.error?.code).toBe('timeout');
    expect(result.truncatedReason).toBe('timeout');
  });

  test('spawn ENOENT → spawn_failed', async () => {
    const err = Object.assign(new Error('spawn codebase-memory-mcp ENOENT'), {
      code: 'ENOENT',
    });
    const { spawn } = capturingSpawn(() => ({
      stdout: async () => {
        throw err;
      },
      stderr: async () => '',
      exited: Promise.reject(err),
      kill: () => true,
      exitCode: null,
    }));
    const result = await runCbmCli(searchOpts, { spawn, resolveBinary: () => FAKE_BIN });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('spawn_failed');
    expect(result.error?.message).toMatch(/ENOENT/);
  });
});

describe('runCbmCli：环境白名单', () => {
  test('spawn 收到的 env 不含 provider token', async () => {
    const { spawn, calls } = capturingSpawn(() => procOf('{"ok":true}'));
    const previous = { ...process.env };
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    try {
      const result = await runCbmCli(
        { ...searchOpts, env: { CBM_CACHE_DIR: '/my/cache' } },
        { spawn, resolveBinary: () => FAKE_BIN },
      );
      expect(result.ok).toBe(true);
      const env = calls[0].options?.env ?? {};
      expect(env.CBM_CACHE_DIR).toBe('/my/cache');
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      process.env = previous;
    }
  });
});

describe('runCbmCli：trace_path canonical 与旧版本 fallback', () => {
  test('trace_call_path 归一化为 canonical trace_path', async () => {
    const { spawn, calls } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(
      { tool: 'trace_call_path', args: { symbol: 'foo' }, workspaceRoot: ROOT },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(calls[0].command[2]).toBe('trace_path');
    expect(result.tool).toBe('trace_path');
    expect(result.ok).toBe(true);
  });

  test('trace_path 因工具不存在失败 → 回退 trace_call_path', async () => {
    const { spawn, calls } = capturingSpawn((command) => {
      if (command[2] === 'trace_path') {
        return procOf('', { stderr: "error: unrecognized subcommand 'trace_path'", exitCode: 1 });
      }
      return procOf('{"ok":true,"results":[]}');
    });
    const result = await runCbmCli(
      { tool: 'trace_path', args: { symbol: 'foo' }, workspaceRoot: ROOT },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(result.ok).toBe(true);
    expect(result.tool).toBe('trace_call_path');
    expect(calls).toHaveLength(2);
    expect(calls[0].command[2]).toBe('trace_path');
    expect(calls[1].command[2]).toBe('trace_call_path');
  });

  test('trace_path 失败但不是“工具不存在”时保留原错误，不回退', async () => {
    const { spawn, calls } = capturingSpawn(() =>
      procOf('', { stderr: 'symbol not indexed', exitCode: 1 }),
    );
    const result = await runCbmCli(
      { tool: 'trace_path', args: { symbol: 'foo' }, workspaceRoot: ROOT },
      { spawn, resolveBinary: () => FAKE_BIN },
    );
    expect(result.error?.code).toBe('exit_nonzero');
    expect(result.error?.message).toBe('symbol not indexed');
    expect(calls).toHaveLength(1);
  });
});

describe('runCbmCli：ensureInstalled / indexer 注入', () => {
  test('ensureInstalled 被 await，并使用返回的二进制', async () => {
    let installCalls = 0;
    const ensureInstalled = async () => {
      installCalls += 1;
      return FAKE_BIN;
    };
    const { spawn, calls } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(searchOpts, { spawn, resolveBinary: () => null, ensureInstalled });
    expect(result.ok).toBe(true);
    expect(installCalls).toBe(1);
    expect(calls[0].command[0]).toBe(FAKE_BIN);
  });

  test('ensureInstalled 返回 null 且 resolveBinary 命中 → 使用 resolveBinary', async () => {
    const { spawn, calls } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(searchOpts, {
      spawn,
      resolveBinary: () => FAKE_BIN,
      ensureInstalled: async () => null,
    });
    expect(result.ok).toBe(true);
    expect(calls[0].command[0]).toBe(FAKE_BIN);
  });

  test('indexer 注入：查询类工具在 autoIndex 时先索引', async () => {
    let indexed = 0;
    const indexer: CbmIndexer = { ensureIndexed: async () => { indexed += 1; } };
    const { spawn } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(
      { ...searchOpts, autoIndex: true },
      { spawn, resolveBinary: () => FAKE_BIN, indexer },
    );
    expect(indexed).toBe(1);
    expect(result.ok).toBe(true);
  });

  test('index_repository 不触发 autoIndex（其自身就是索引）', async () => {
    let indexed = 0;
    const indexer: CbmIndexer = { ensureIndexed: async () => { indexed += 1; } };
    const { spawn } = capturingSpawn(() => procOf('{"ok":true}'));
    const result = await runCbmCli(
      { tool: 'index_repository', args: { repository_path: '.' }, projectPath: '.', workspaceRoot: ROOT, autoIndex: true },
      { spawn, resolveBinary: () => FAKE_BIN, indexer },
    );
    expect(indexed).toBe(0);
    expect(result.ok).toBe(true);
  });
});

describe('buildCbmMissingMessage', () => {
  test('包含安装/修复指引', () => {
    const msg = buildCbmMissingMessage();
    expect(msg).toContain('not found');
    expect(msg).toContain('binaryPath');
    expect(msg).toContain('PATH');
  });
});
