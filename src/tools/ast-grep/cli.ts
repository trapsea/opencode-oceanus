import {
  DEFAULT_MAX_MATCHES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  findSgCliPathSync,
} from './constants';
import { buildSgArgs, resolveWorkspacePaths, shouldApplyChanges } from './args';
import { crossSpawn, type SpawnFn } from './proc';
import type { CliMatch, ReplaceOptions, SearchOptions, SgResult } from './types';

/** runSg 的可注入依赖，便于测试替换 spawn / CLI 解析。 */
export interface RunDeps {
  spawn?: SpawnFn;
  resolveCli?: () => string | null;
}

export interface ParseLimits {
  maxMatches: number;
  maxOutputBytes: number;
}

/** 将 CLI 输出的 JSON 字符串解析为 SgResult，处理字节/匹配数截断。 */
export function parseSgOutput(stdout: string, limits: ParseLimits): SgResult {
  const maxOutputBytes = limits.maxOutputBytes;
  const maxMatches = limits.maxMatches;
  const byteLength = Buffer.byteLength(stdout, 'utf8');
  const outputTruncated = byteLength >= maxOutputBytes;

  const outputToProcess = outputTruncated
    ? Buffer.from(stdout, 'utf8').subarray(0, maxOutputBytes).toString('utf8')
    : stdout;

  let matches: CliMatch[] = [];
  try {
    matches = JSON.parse(outputToProcess) as CliMatch[];
  } catch {
    if (outputTruncated) {
      // 输出被硬截断导致 JSON 不完整：尝试在最后一个 `},` 处恢复为合法数组。
      try {
        const lastComma = outputToProcess.lastIndexOf('},');
        if (lastComma > 0) {
          matches = JSON.parse(
            `${outputToProcess.substring(0, lastComma + 1)}]`,
          ) as CliMatch[];
        }
      } catch {
        return {
          matches: [],
          totalMatches: 0,
          truncated: true,
          truncatedReason: 'max_output_bytes',
          error: 'Output too large and could not be parsed',
        };
      }
    } else {
      return { matches: [], totalMatches: 0, truncated: false };
    }
  }

  const matchesTruncated = matches.length > maxMatches;
  const finalMatches = matchesTruncated ? matches.slice(0, maxMatches) : matches;
  return {
    matches: finalMatches,
    totalMatches: matches.length,
    truncated: outputTruncated || matchesTruncated,
    truncatedReason: outputTruncated
      ? 'max_output_bytes'
      : matchesTruncated
        ? 'max_matches'
        : undefined,
  };
}

/** CLI 缺失时的诊断消息。 */
export function buildCliMissingMessage(): string {
  return (
    'ast-grep CLI binary not found.\n\n' +
    'Searched: AST_GREP_BIN override, cache dir, @ast-grep/cli npm package, ' +
    'platform-specific package, and `ast-grep`/`sg` on PATH.\n' +
    'Install options:\n' +
    '  bun add -D @ast-grep/cli\n' +
    '  cargo install ast-grep --locked\n' +
    '  brew install ast-grep\n' +
    'Or set AST_GREP_BIN=/path/to/ast-grep to point at an existing binary.'
  );
}

function missingCliResult(): SgResult {
  return { matches: [], totalMatches: 0, truncated: false, error: buildCliMissingMessage() };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isEnoent(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException;
  return (
    err?.code === 'ENOENT' ||
    (typeof err?.message === 'string' &&
      (err.message.includes('ENOENT') || err.message.includes('not found')))
  );
}

type PassOutcome =
  | { kind: 'output'; stdout: string; stderr: string; exitCode: number }
  | { kind: 'fatal'; result: SgResult };

async function runPass(
  spawn: SpawnFn,
  cliPath: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<PassOutcome> {
  let proc;
  try {
    proc = spawn([cliPath, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  } catch (e) {
    if (isEnoent(e)) return { kind: 'fatal', result: missingCliResult() };
    return {
      kind: 'fatal',
      result: { matches: [], totalMatches: 0, truncated: false, error: `Failed to spawn ast-grep: ${errorMessage(e)}` },
    };
  }

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* noop */
      }
      reject(new Error(`Search timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    proc.exited.then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
  } catch {
    /* noop */
  }

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      Promise.race([proc.stdout(), timeoutPromise]),
      proc.stderr(),
      proc.exited,
    ]);
  } catch (e) {
    if (timedOut) {
      return {
        kind: 'fatal',
        result: {
          matches: [],
          totalMatches: 0,
          truncated: true,
          truncatedReason: 'timeout',
          error: `Search timeout after ${timeoutMs}ms`,
        },
      };
    }
    if (isEnoent(e)) return { kind: 'fatal', result: missingCliResult() };
    return {
      kind: 'fatal',
      result: { matches: [], totalMatches: 0, truncated: false, error: `Failed to run ast-grep: ${errorMessage(e)}` },
    };
  }

  return { kind: 'output', stdout, stderr, exitCode };
}

function resultFromPass(pass: PassOutcome, limits: ParseLimits): SgResult {
  if (pass.kind === 'fatal') return pass.result;
  const { stdout, stderr, exitCode } = pass;

  if (exitCode !== 0 && stdout.trim() === '') {
    if (stderr.includes('No files found')) {
      return { matches: [], totalMatches: 0, truncated: false };
    }
    if (stderr.trim()) {
      return { matches: [], totalMatches: 0, truncated: false, error: stderr.trim() };
    }
    return { matches: [], totalMatches: 0, truncated: false };
  }

  if (!stdout.trim()) {
    return { matches: [], totalMatches: 0, truncated: false };
  }

  return parseSgOutput(stdout, limits);
}

/**
 * 执行一次 ast-grep 搜索或替换。
 *
 * - 搜索（无 rewrite）：单遍 report，返回 JSON 结构化匹配。
 * - 替换 dry-run（默认）：单遍 report，文件不变。
 * - 替换 apply（dryRun:false）：先 report 获取结构化结果，再以无 json 的
 *   `--update-all` 独立一遍真正写入文件。
 *
 * 所有失败都以 SgResult.error 返回，不抛异常；工作区路径越界也会被捕获为错误。
 */
export async function runSg(
  options: SearchOptions | ReplaceOptions,
  deps: RunDeps = {},
): Promise<SgResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limits: ParseLimits = {
    maxMatches: options.maxMatches ?? DEFAULT_MAX_MATCHES,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  };

  let paths: string[];
  let cwd: string;
  try {
    const resolved = resolveWorkspacePaths(options.paths, workspaceRoot);
    paths = resolved.paths;
    cwd = resolved.cwd;
  } catch (e) {
    return { matches: [], totalMatches: 0, truncated: false, error: errorMessage(e) };
  }

  const resolveCli = deps.resolveCli ?? findSgCliPathSync;
  const cliPath = resolveCli();
  if (!cliPath) return missingCliResult();

  const spawn = deps.spawn ?? crossSpawn;
  const applyChanges = shouldApplyChanges(options);

  const reportPass = await runPass(
    spawn,
    cliPath,
    buildSgArgs({ ...options, paths }, 'report'),
    cwd,
    timeoutMs,
  );
  let result = resultFromPass(reportPass, limits);

  if (applyChanges && !result.error) {
    const applyPass = await runPass(
      spawn,
      cliPath,
      buildSgArgs({ ...options, paths }, 'apply'),
      cwd,
      timeoutMs,
    );
    if (applyPass.kind === 'fatal') {
      result = { ...result, error: applyPass.result.error };
    } else if (applyPass.exitCode !== 0) {
      result = {
        ...result,
        error:
          applyPass.stderr.trim() ||
          `ast-grep apply failed with exit code ${applyPass.exitCode}`,
      };
    }
  }

  return result;
}
