import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions as NodeSpawnOptions,
} from 'node:child_process';

/**
 * codebase-memory-mcp（CBM）跨运行时（Bun / Node）进程 spawn 抽象。
 *
 * CBM-03：CLI 执行器只接受**参数数组**，`shell: false` 显式禁用 shell 解析，
 * 避免 `$(...)` / 反引号 / 管道 / glob 等被当作命令执行。接口刻意精简，
 * 方便在测试中注入 fake spawn。
 */

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: 'pipe' | 'inherit' | 'ignore';
  stderr?: 'pipe' | 'inherit' | 'ignore';
  stdin?: 'pipe' | 'inherit' | 'ignore';
}

export interface SpawnProc {
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
  /** 进程退出时 resolve 退出码；spawn 失败时 reject。 */
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  /** 向标准输入写入数据；不可用时省略。 */
  stdin?: (data: string) => void;
  readonly exitCode: number | null;
}

export type SpawnFn = (command: string[], options?: SpawnOptions) => SpawnProc;

function collectStream(
  stream: NodeJS.ReadableStream | null,
): () => Promise<string> {
  if (!stream) return () => Promise.resolve('');
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return () =>
    new Promise<string>((resolve, reject) => {
      if (!stream.readable) {
        resolve(Buffer.concat(chunks).toString('utf-8'));
        return;
      }
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    });
}

export function crossSpawn(command: string[], options: SpawnOptions = {}): SpawnProc {
  const [file, ...args] = command;
  const spawnOptions: NodeSpawnOptions = {
    stdio: [
      options.stdin ?? 'ignore',
      options.stdout ?? 'pipe',
      options.stderr ?? 'pipe',
    ],
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv | undefined,
    // 关键：参数数组模式，绝不启用 shell。
    shell: false,
    // Windows 上隐藏子进程控制台窗口（Node 默认 false 会闪弹 cmd 窗口）。
    windowsHide: true,
  };

  const child: ChildProcess = nodeSpawn(file, args, spawnOptions);

  const stdout = collectStream(child.stdout);
  const stderr = collectStream(child.stderr);

  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  return {
    stdout,
    stderr,
    exited,
    kill: (signal) => child.kill(signal as NodeJS.Signals),
    stdin: (data) => {
      child.stdin?.write(data);
      child.stdin?.end();
    },
    get exitCode() {
      return child.exitCode;
    },
  };
}
