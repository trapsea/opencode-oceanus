import { describe, expect, test } from 'bun:test';
import type { SpawnFn, SpawnProc } from '../cbm/process';
import {
  BrowserInstallError,
  installAgentBrowser,
} from './install';

/**
 * install 单测：确认门 fail-closed 与两段安装的错误码分支。
 * 全部 fake spawn 注入，不执行真实 npm / Chrome 下载。
 */

interface FakeResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

function makeProc(result: FakeResult): SpawnProc {
  return {
    stdout: () => Promise.resolve(result.stdout ?? ''),
    stderr: () => Promise.resolve(result.stderr ?? ''),
    exited: Promise.resolve(result.code),
    kill: () => true,
    exitCode: null,
  };
}

function fakeSpawn(
  handlers: Array<{ match: (cmd: string[]) => boolean; result: FakeResult }>,
): SpawnFn {
  return (cmd: string[]) => {
    const handler = handlers.find((h) => h.match(cmd));
    return makeProc(
      handler?.result ?? {
        code: 1,
        stderr: `no handler for: ${cmd.join(' ')}`,
      },
    );
  };
}

const cmdIs =
  (...prefix: string[]) =>
  (cmd: string[]): boolean =>
    prefix.every((part, i) => cmd[i] === part);

describe('installAgentBrowser 确认门', () => {
  test('未提供 confirm：fail-closed，抛 user_declined 且不执行任何命令', async () => {
    let spawned = 0;
    const spawn: SpawnFn = (cmd) => {
      spawned += 1;
      return makeProc({ code: 0 });
    };
    expect(spawned).toBe(0);
    try {
      await installAgentBrowser({}, { spawn });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserInstallError);
      expect((error as BrowserInstallError).code).toBe('user_declined');
    }
    expect(spawned).toBe(0);
  });

  test('confirm 返回 false：同样 user_declined', async () => {
    let spawned = 0;
    const spawn: SpawnFn = (cmd) => {
      spawned += 1;
      return makeProc({ code: 0 });
    };
    await expect(
      installAgentBrowser({ confirm: () => false }, { spawn }),
    ).rejects.toMatchObject({ code: 'user_declined' });
    expect(spawned).toBe(0);
  });
});

describe('installAgentBrowser 两段安装', () => {
  test('npm install 失败：npm_install_failed 且附 stderr 摘要', async () => {
    const spawn = fakeSpawn([
      {
        match: cmdIs('npm', 'install', '-g', 'agent-browser'),
        result: { code: 1, stderr: 'EACCES: permission denied' },
      },
    ]);
    try {
      await installAgentBrowser({ confirm: () => true }, { spawn });
      expect.unreachable();
    } catch (error) {
      expect((error as BrowserInstallError).code).toBe('npm_install_failed');
      expect((error as BrowserInstallError).message).toContain('EACCES');
    }
  });

  test('Chrome 下载失败：chrome_install_failed', async () => {
    const spawn = fakeSpawn([
      {
        match: cmdIs('npm', 'install', '-g'),
        result: { code: 0 },
      },
      {
        match: cmdIs('agent-browser', 'install'),
        result: { code: 1, stderr: 'download failed' },
      },
    ]);
    await expect(
      installAgentBrowser(
        { confirm: () => true, withDeps: false },
        { spawn },
      ),
    ).rejects.toMatchObject({ code: 'chrome_install_failed' });
  });

  test('withDeps=true 传递 --with-deps；doctor 失败抛 doctor_failed', async () => {
    const seen: string[][] = [];
    const spawn: SpawnFn = (cmd) => {
      seen.push(cmd);
      if (cmdIs('agent-browser', 'doctor')(cmd)) {
        return makeProc({ code: 1, stdout: '{"status":"deps-missing"}' });
      }
      return makeProc({ code: 0, stdout: 'ok' });
    };
    await expect(
      installAgentBrowser(
        { confirm: () => true, withDeps: true, runDoctor: true },
        { spawn },
      ),
    ).rejects.toMatchObject({ code: 'doctor_failed' });
    expect(
      seen.some((cmd) =>
        cmdIs('agent-browser', 'install', '--with-deps')(cmd),
      ),
    ).toBe(true);
  });

  test('成功路径：版本锁定 + 安装后探测可用', async () => {
    const seen: string[][] = [];
    const spawn: SpawnFn = (cmd) => {
      seen.push(cmd);
      if (cmdIs('agent-browser', '--version')(cmd)) {
        return makeProc({ code: 0, stdout: 'agent-browser 1.9.0' });
      }
      return makeProc({ code: 0 });
    };
    const result = await installAgentBrowser(
      {
        confirm: () => true,
        version: '1.9.0',
        runDoctor: true,
      },
      { spawn },
    );
    expect(seen.some((cmd) => cmd.join(' ') === 'npm install -g agent-browser@1.9.0')).toBe(
      true,
    );
    expect(result.detect.available).toBe(true);
    expect(result.detect.source).toBe('path');
  });
});
