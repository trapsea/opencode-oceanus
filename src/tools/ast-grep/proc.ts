import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions as NodeSpawnOptions } from 'node:child_process';

/**
 * 跨运行时（Bun / Node）的进程 spawn 封装，接口刻意精简以方便测试注入。
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
    get exitCode() {
      return child.exitCode;
    },
  };
}
