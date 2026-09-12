import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpawnFn, SpawnProc } from '../cbm/process';
import { detectAgentBrowser } from './detect';

/**
 * detect 单测：三级探测与 doctor 的全部分支。
 * 全部 fake spawn 注入；binaryPath/npm-global 级需要 existsSync 为真，
 * 用 /tmp/opencode 下的真实临时空文件模拟（不执行、无网络）。
 */

interface FakeResult {
  code: number;
  stdout?: string;
  stderr?: string;
  /** spawn 阶段直接失败（模拟 ENOENT）。 */
  throwOnSpawn?: boolean;
}

interface Handler {
  match: (cmd: string[]) => boolean;
  result: FakeResult;
}

function makeProc(result: FakeResult): SpawnProc {
  if (result.throwOnSpawn) {
    return {
      stdout: () => Promise.resolve(''),
      stderr: () => Promise.resolve(''),
      // 延迟 reject：保证 await 已挂接 handler，避免 unhandled rejection。
      exited: new Promise<number>((_, reject) =>
        setImmediate(() => reject(new Error('spawn ENOENT'))),
      ),
      kill: () => true,
      exitCode: null,
    };
  }
  return {
    stdout: () => Promise.resolve(result.stdout ?? ''),
    stderr: () => Promise.resolve(result.stderr ?? ''),
    exited: Promise.resolve(result.code),
    kill: () => true,
    exitCode: null,
  };
}

function fakeSpawn(handlers: Handler[]): SpawnFn {
  return (cmd: string[]) => {
    const handler = handlers.find((h) => h.match(cmd));
    const result: FakeResult =
      handler?.result ??
      { code: 1, stderr: `no handler for: ${cmd.join(' ')}` };
    return makeProc(result);
  };
}

const cmdIs =
  (...prefix: string[]) =>
  (cmd: string[]): boolean =>
    prefix.every((part, i) => cmd[i] === part);

const TMP = '/tmp/opencode/agent-browser-detect-test';

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('detectAgentBrowser 三级探测', () => {
  test('PATH 命中：--version 成功即 available，source=path', async () => {
    const spawn = fakeSpawn([
      {
        match: cmdIs('agent-browser', '--version'),
        result: { code: 0, stdout: 'agent-browser 1.9.0\n' },
      },
    ]);
    const result = await detectAgentBrowser({ spawn });
    expect(result.available).toBe(true);
    expect(result.source).toBe('path');
    expect(result.version).toBe('agent-browser 1.9.0');
    expect(result.doctorOk).toBeUndefined();
  });

  test('PATH spawn 失败（ENOENT）不抛异常，进入下一级', async () => {
    const spawn = fakeSpawn([
      {
        match: cmdIs('agent-browser', '--version'),
        result: { code: 0, throwOnSpawn: true },
      },
      {
        match: cmdIs('npm', 'ls'),
        result: { code: 1, stderr: '(empty)' },
      },
    ]);
    const result = await detectAgentBrowser({ spawn });
    expect(result.available).toBe(false);
    expect(result.error).toContain('PATH 无 agent-browser');
    expect(result.error).toContain('npm global 未安装');
  });

  test('配置 binaryPath 存在且可执行：source=binary-path', async () => {
    mkdirSync(TMP, { recursive: true });
    const bin = join(TMP, 'agent-browser-bin');
    writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
    const spawn = fakeSpawn([
      {
        match: cmdIs(bin, '--version'),
        result: { code: 0, stdout: 'agent-browser 2.1.0' },
      },
      {
        match: cmdIs('agent-browser', '--version'),
        result: { code: 0, throwOnSpawn: true },
      },
    ]);
    const result = await detectAgentBrowser({
      spawn,
      configuredBinaryPath: bin,
    });
    expect(result.available).toBe(true);
    expect(result.source).toBe('binary-path');
    expect(result.binaryPath).toBe(bin);
  });

  test('npm global 命中：npm ls + prefix 推导 bin 并验证', async () => {
    const prefix = join(TMP, 'npm-prefix');
    const binDir = join(prefix, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'agent-browser'), '#!/bin/sh\n', {
      mode: 0o755,
    });
    const globalBin = join(binDir, 'agent-browser');
    const spawn = fakeSpawn([
      {
        match: cmdIs('agent-browser', '--version'),
        result: { code: 0, throwOnSpawn: true },
      },
      {
        match: cmdIs('npm', 'ls'),
        result: { code: 0, stdout: '/usr/lib\n└── agent-browser@3.0.0\n' },
      },
      {
        match: cmdIs('npm', 'prefix'),
        result: { code: 0, stdout: `${prefix}\n` },
      },
      {
        match: cmdIs(globalBin, '--version'),
        result: { code: 0, stdout: 'agent-browser 3.0.0' },
      },
    ]);
    const result = await detectAgentBrowser({ spawn });
    expect(result.available).toBe(true);
    expect(result.source).toBe('npm-global');
    expect(result.binaryPath).toBe(globalBin);
    expect(result.version).toBe('agent-browser 3.0.0');
  });

  test('三级全部失败：available=false 且 error 汇总各级原因', async () => {
    mkdirSync(TMP, { recursive: true });
    const missing = join(TMP, 'not-exist-bin');
    const spawn = fakeSpawn([
      {
        match: cmdIs('agent-browser', '--version'),
        result: { code: 127, stderr: 'command not found' },
      },
      {
        match: cmdIs('npm', 'ls'),
        result: { code: 1, stderr: '(empty)' },
      },
    ]);
    const result = await detectAgentBrowser({
      spawn,
      configuredBinaryPath: missing,
    });
    expect(result.available).toBe(false);
    expect(result.error).toContain('PATH 无 agent-browser');
    expect(result.error).toContain(`binaryPath 不存在: ${missing}`);
    expect(result.error).toContain('npm global 未安装');
  });

  test('checkDoctor=true：doctor 非 0 不推翻 available，仅 doctorOk=false', async () => {
    const spawn = fakeSpawn([
      {
        match: cmdIs('agent-browser', '--version'),
        result: { code: 0, stdout: 'agent-browser 1.9.0' },
      },
      {
        match: cmdIs('agent-browser', 'doctor'),
        result: { code: 1, stdout: '{"status":"chrome-missing"}' },
      },
    ]);
    const result = await detectAgentBrowser({ spawn, checkDoctor: true });
    expect(result.available).toBe(true);
    expect(result.doctorOk).toBe(false);
    expect(result.doctorOutput).toContain('chrome-missing');
  });

  test('checkDoctor=true 且 doctor 通过：doctorOk=true', async () => {
    const spawn = fakeSpawn([
      {
        match: cmdIs('agent-browser', '--version'),
        result: { code: 0, stdout: 'agent-browser 1.9.0' },
      },
      {
        match: cmdIs('agent-browser', 'doctor'),
        result: { code: 0, stdout: '{"status":"ok"}' },
      },
    ]);
    const result = await detectAgentBrowser({ spawn, checkDoctor: true });
    expect(result.available).toBe(true);
    expect(result.doctorOk).toBe(true);
  });
});
