import { existsSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crossSpawn, type SpawnFn } from '../../cbm/process';
import { getBinaryPath, getCacheRoot, getCurrentManifestPath } from '../../cbm/paths';
import {
  buildCbmEnv,
  canonicalToolName,
  CbmBoundaryError,
  extractProjectPaths,
  deriveProjectName,
  isToolNotFoundOutput,
  isTraceTool,
  validateProjectPath,
} from './args';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  DETECT_CHANGES_TOOL,
  GET_CODE_SNIPPET_TOOL,
  QUERY_GRAPH_TOOL,
  SEARCH_GRAPH_TOOL,
  TRACE_CALL_PATH_TOOL,
  TRACE_PATH_TOOL,
  INDEX_STATUS_TOOL,
  INDEX_REPOSITORY_TOOL,
  type CbmCliError,
  type CbmCliResult,
  type CbmExecOptions,
  type CbmRunDeps,
} from './types';

/**
 * codebase-memory-mcp（CBM）CLI 兜底执行器：`cli <tool> <json>`。
 *
 * CBM-03：实现安全、可测试的执行器。
 *   - spawn 使用参数数组，`shell: false`，绝不经过 shell 解析；
 *   - 二进制解析顺序：binaryPath→缓存→PATH；
 *   - 工作区根/项目路径越界校验（含从 JSON args 提取的路径）；
 *   - 超时、退出码、ENOENT、非 JSON/超大输出 → 结构化错误；
 *   - 环境变量白名单，不继承 provider token；
 *   - trace_path 为 canonical，旧版本可 fallback trace_call_path；
 *   - 预留 ensureInstalled / indexer 注入接口，多个调用共享安装 Promise。
 *
 * 所有失败都以 CbmCliResult.error 返回，不抛异常。
 */

const TRACE_QUERY_TOOLS = new Set<string>([
  SEARCH_GRAPH_TOOL,
  TRACE_PATH_TOOL,
  GET_CODE_SNIPPET_TOOL,
  QUERY_GRAPH_TOOL,
  DETECT_CHANGES_TOOL,
]);
const PROJECT_TOOLS = new Set([SEARCH_GRAPH_TOOL, TRACE_PATH_TOOL, GET_CODE_SNIPPET_TOOL, QUERY_GRAPH_TOOL, DETECT_CHANGES_TOOL, INDEX_STATUS_TOOL]);

/** 是否需要在查询前触发自动索引（index_repository / 状态类工具除外）。 */
function shouldIndexBeforeQuery(tool: string): boolean {
  return TRACE_QUERY_TOOLS.has(tool);
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 从 Oceanus 缓存 current.json 解析已安装二进制路径。 */
function resolveCachedBinary(cacheRoot: string = getCacheRoot()): string | null {
  try {
    const currentPath = getCurrentManifestPath(cacheRoot);
    if (!existsSync(currentPath)) return null;
    const current = JSON.parse(readFileSync(currentPath, 'utf8')) as {
      version?: string;
      platform?: string;
    };
    if (!current.version || !current.platform) return null;
    const isWin =
      current.platform.startsWith('win32') || process.platform === 'win32';
    const binaryName = isWin
      ? 'codebase-memory-mcp.exe'
      : 'codebase-memory-mcp';
    const bin = getBinaryPath(current.platform, current.version, binaryName, cacheRoot);
    return isFile(bin) ? bin : null;
  } catch {
    return null;
  }
}

function resolveCacheRoot(cacheRoot?: string): string {
  return cacheRoot ?? process.env.CBM_CACHE_DIR ?? getCacheRoot();
}

/** 在系统 PATH 上查找 codebase-memory-mcp。 */
function resolveOnPath(): string | null {
  const pathEnv = process.env.PATH ?? '';
  const names =
    process.platform === 'win32'
      ? ['codebase-memory-mcp.exe', 'codebase-memory-mcp']
      : ['codebase-memory-mcp'];
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of pathEnv.split(sep).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** 默认二进制解析：binaryPath→缓存→PATH。返回 null 表示未找到。 */
export function resolveCbmBinaryPath(
  opts: { binaryPath?: string; cacheRoot?: string } = {},
): string | null {
  if (opts.binaryPath && isFile(opts.binaryPath)) return opts.binaryPath;
  const cached = resolveCachedBinary(resolveCacheRoot(opts.cacheRoot));
  if (cached) return cached;
  return resolveOnPath();
}

/** 二进制缺失时的安装/修复诊断。 */
export function buildCbmMissingMessage(): string {
  return (
    'codebase-memory-mcp binary not found.\n\n' +
    'Searched: explicit binaryPath, Oceanus cache, and `codebase-memory-mcp` on PATH.\n' +
    'Set codebaseMemory.binaryPath or run an install/repair command to provision it.'
  );
}

function binaryMissingResult(tool: string): CbmCliResult {
  return {
    ok: false,
    tool,
    data: null,
    error: { code: 'binary_missing', message: buildCbmMissingMessage() },
  };
}

function normalizeSpawnError(e: unknown): CbmCliError {
  const err = e as NodeJS.ErrnoException;
  const detail = err?.message ?? String(e);
  const isEnoent =
    err?.code === 'ENOENT' ||
    typeof detail === 'string' &&
      (detail.includes('ENOENT') || detail.includes('not found'));
  return {
    code: 'spawn_failed',
    message: isEnoent
      ? `CBM binary could not be spawned (ENOENT): ${detail}`
      : `Failed to spawn CBM binary: ${detail}`,
  };
}

type PassOutcome =
  | { kind: 'output'; stdout: string; stderr: string; exitCode: number }
  | { kind: 'fatal'; error: CbmCliError };

async function runPass(
  spawn: SpawnFn,
  command: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  tool: string,
  stdinData?: string,
): Promise<PassOutcome> {
  let proc;
  try {
    proc = spawn(command, { cwd, env, stdout: 'pipe', stderr: 'pipe', stdin: stdinData === undefined ? 'ignore' : 'pipe' });
    if (stdinData !== undefined) proc.stdin?.(stdinData);
  } catch (e) {
    return { kind: 'fatal', error: normalizeSpawnError(e) };
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
      reject(new Error(`CBM ${tool} timeout after ${timeoutMs}ms`));
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
    [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([proc.stdout(), proc.stderr(), proc.exited]),
      timeoutPromise,
    ]);
  } catch (e) {
    if (timedOut) {
      return {
        kind: 'fatal',
        error: {
          code: 'timeout',
          message: `CBM ${tool} timed out after ${timeoutMs}ms`,
        },
      };
    }
    return { kind: 'fatal', error: normalizeSpawnError(e) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  return { kind: 'output', stdout, stderr, exitCode };
}

function resultFromPass(
  pass: PassOutcome,
  tool: string,
  maxOutputBytes: number,
): CbmCliResult {
  if (pass.kind === 'fatal') {
    if (pass.error.code === 'timeout') {
      return {
        ok: false,
        tool,
        data: null,
        truncated: true,
        truncatedReason: 'timeout',
        error: pass.error,
      };
    }
    return { ok: false, tool, data: null, error: pass.error };
  }
  const { stdout, stderr, exitCode } = pass;

  if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
    return {
      ok: false,
      tool,
      data: null,
      truncated: true,
      truncatedReason: 'max_output_bytes',
      error: {
        code: 'output_oversize',
        message: `CBM output exceeded ${maxOutputBytes} bytes`,
        stderr,
      },
    };
  }

  if (exitCode !== 0) {
    return {
      ok: false,
      tool,
      data: null,
      error: {
        code: 'exit_nonzero',
        message: stderr.trim() || `CBM exited with code ${exitCode}`,
        stderr,
        exitCode,
      },
    };
  }

  if (!stdout.trim()) {
    return { ok: true, tool, data: null };
  }

  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      tool,
      data: null,
      error: {
        code: 'invalid_json',
        message: 'CBM stdout is not valid JSON',
        stderr,
      },
    };
  }
  return { ok: true, tool, data };
}

async function execute(
  spawn: SpawnFn,
  binaryPath: string,
  tool: string,
  jsonArg: string,
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  maxOutputBytes: number,
  mode: 'args-file' | 'stdin' | 'raw' = 'raw',
): Promise<{ result: CbmCliResult; stderr: string }> {
  let argsFileDir: string | undefined;
  let command: string[];
  let stdinData: string | undefined;
  if (mode === 'args-file') {
    argsFileDir = mkdtempSync(join(tmpdir(), 'cbm-args-'));
    const argsFile = join(argsFileDir, 'args.json');
    writeFileSync(argsFile, jsonArg);
    command = [binaryPath, 'cli', tool, '--args-file', argsFile];
  } else if (mode === 'stdin') {
    command = [binaryPath, 'cli', tool];
    stdinData = jsonArg;
  } else command = [binaryPath, 'cli', tool, jsonArg];
  let pass: PassOutcome;
  try {
    pass = await runPass(spawn, command, cwd, env, timeoutMs, tool, stdinData);
  } finally {
    if (argsFileDir) rmSync(argsFileDir, { recursive: true, force: true });
  }
  const stderr = pass.kind === 'output' ? pass.stderr : '';
  return {
    result: resultFromPass(pass, tool, maxOutputBytes),
    stderr,
  };
}

function isUnsupportedInputMode(stderr: string): boolean {
  // 只将明确针对输入协议的诊断视为 fallback；“invalid argument”通常是业务参数错误。
  return /(?:unknown|unrecognized|unsupported|unexpected)\s+(?:option|flag)\b|(?:option|flag)\s+['`-]*(?:args-file|stdin)\b|(?:args-file|stdin)\s+(?:is not supported|unsupported|unknown)|(?:unsupported|unknown|unrecognized)\s+(?:args-file|stdin)\b/i.test(stderr);
}

function internalErrorResult(tool: string, error: unknown): CbmCliResult {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, tool, data: null, error: { code: 'internal_error', message } };
}

/**
 * 执行一次 CBM `cli <tool> <json>` 调用。
 *
 * 默认流程：
 *   1. 工作区/项目路径越界校验（含从 JSON args 提取的路径）；
 *   2. 二进制解析：显式 binaryPath 优先，其次 ensureInstalled（共享 Promise），
 *      最后 resolveBinary（binaryPath→缓存→PATH）；
 *   3. 环境变量白名单（不继承 provider token）；
 *   4. （预留）autoIndex 且注入 indexer 时，查询前先索引；
 *   5. spawn `cli <canonicalTool> <json>`（参数数组，无 shell）+ 超时；
 *   6. trace_path 因“工具不存在”失败时，回退 trace_call_path。
 */
export async function runCbmCli(
  options: CbmExecOptions,
  deps: CbmRunDeps = {},
): Promise<CbmCliResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const spawn = deps.spawn ?? crossSpawn;
  const canonical = canonicalToolName(options.tool);

  try {
  // 1. 路径越界校验
  let projectPath: string | undefined;
  try {
    const fromArgs = extractProjectPaths(options.args);
    const candidates = options.projectPath === undefined ? fromArgs : [options.projectPath, ...fromArgs];
    for (const candidate of candidates) validateProjectPath(candidate, workspaceRoot);
    projectPath = validateProjectPath(options.projectPath ?? fromArgs[0], workspaceRoot);
  } catch (e) {
    if (e instanceof CbmBoundaryError) {
      return {
        ok: false,
        tool: canonical,
        data: null,
        error: { code: 'workspace_boundary', message: e.message },
      };
    }
    return internalErrorResult(canonical, e);
  }

  // 2. 二进制解析：显式 binaryPath → ensureInstalled（共享 Promise）→ resolveBinary
  let binaryPath: string | null = null;
  if (options.binaryPath) {
    binaryPath = options.binaryPath;
  } else {
    const resolveBinary = deps.resolveBinary ?? resolveCbmBinaryPath;
    if (deps.ensureInstalled) {
      binaryPath = await deps.ensureInstalled();
    }
    if (!binaryPath) {
      binaryPath = resolveBinary({
        binaryPath: options.binaryPath,
        cacheRoot: resolveCacheRoot(options.cacheRoot),
      } as { binaryPath?: string; cacheRoot?: string });
    }
  }
  if (!binaryPath) return binaryMissingResult(canonical);

  // 3. 环境白名单
  const env = buildCbmEnv(options.env);

  // 4. （预留）自动索引
  if (deps.indexer && options.autoIndex && shouldIndexBeforeQuery(canonical)) {
    await deps.indexer.ensureIndexed(projectPath, { workspaceRoot, timeoutMs });
  }

  // 5. 按当前 CBM CLI 契约规范化最终参数。
  let normalizedArgs: unknown = options.args;
  if (canonical === INDEX_REPOSITORY_TOOL) {
    normalizedArgs = {
      repo_path: projectPath ?? workspaceRoot,
      name: deriveProjectName(workspaceRoot),
    };
  } else if (PROJECT_TOOLS.has(canonical)) {
    normalizedArgs = { ...(options.args as Record<string, unknown>), project: deriveProjectName(workspaceRoot) };
  }
  const jsonArg = JSON.stringify(normalizedArgs);
  const first = await execute(
    spawn,
    binaryPath,
    canonical,
    jsonArg,
    workspaceRoot,
    env,
    timeoutMs,
    maxOutputBytes,
    'args-file',
  );

  let result = first.result;

  // 新 CLI 优先 args-file；仅明确表示不支持该输入方式时逐级回退。
  const protocolFallback = isUnsupportedInputMode(first.stderr) ||
    (isTraceTool(options.tool) && canonical === TRACE_PATH_TOOL && isToolNotFoundOutput('', first.stderr));
  if (!result.ok && result.error?.code === 'exit_nonzero' && protocolFallback) {
    const stdinPass = await execute(spawn, binaryPath, canonical, jsonArg, workspaceRoot, env, timeoutMs, maxOutputBytes, 'stdin');
    result = stdinPass.result;
    if (!result.ok && result.error?.code === 'exit_nonzero' &&
      (isUnsupportedInputMode(stdinPass.stderr) ||
        (isTraceTool(options.tool) && canonical === TRACE_PATH_TOOL && isToolNotFoundOutput('', stdinPass.stderr)))) {
      result = (await execute(spawn, binaryPath, canonical, jsonArg, workspaceRoot, env, timeoutMs, maxOutputBytes, 'raw')).result;
    }
  }

  // 6. trace_path 旧版本 fallback：canonical 调用因“工具不存在”失败时重试 trace_call_path
  if (
    !result.ok &&
    result.error?.code === 'exit_nonzero' &&
    isTraceTool(options.tool) &&
    canonical === TRACE_PATH_TOOL &&
    isToolNotFoundOutput('', first.stderr)
  ) {
    const fb = await execute(
      spawn,
      binaryPath,
      TRACE_CALL_PATH_TOOL,
      jsonArg,
      workspaceRoot,
      env,
      timeoutMs,
      maxOutputBytes,
    );
    if (fb.result.ok || !isToolNotFoundOutput('', fb.stderr)) {
      result = fb.result;
    }
  }

  return result;
  } catch (e) {
    return internalErrorResult(canonical, e);
  }
}
