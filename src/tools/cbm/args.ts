import path from 'node:path';
import {
  CBM_ENV_WHITELIST,
  TRACE_CALL_PATH_TOOL,
  TRACE_PATH_TOOL,
} from './types';

/**
 * CBM CLI 执行器的参数纯函数：路径边界、工具名归一化、环境白名单。
 *
 * CBM-03：只做纯函数转换与校验，不做网络/文件 IO，便于跨平台注入测试。
 */

/** 项目路径越界违规。请求的路径解析后位于 workspace root 之外时抛出。 */
export class CbmBoundaryError extends Error {
  constructor(
    readonly requested: string,
    readonly workspaceRoot: string,
  ) {
    super(
      `Path "${requested}" is outside the workspace root "${workspaceRoot}" and was rejected.`,
    );
    this.name = 'CbmBoundaryError';
  }
}

/** 判断 candidate 是否位于 root 内（相对/绝对路径统一按 root 解析）。 */
export function isPathWithinRoot(candidate: string, root: string): boolean {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, candidate);
  const rel = path.relative(rootResolved, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 校验项目路径。未提供/空串返回 undefined；位于 root 内返回规范化绝对路径；
 * 越界抛出 {@link CbmBoundaryError}。
 */
export function validateProjectPath(
  projectPath: string | undefined,
  workspaceRoot: string,
): string | undefined {
  if (projectPath === undefined || projectPath === '') return undefined;
  if (!isPathWithinRoot(projectPath, workspaceRoot)) {
    throw new CbmBoundaryError(projectPath, workspaceRoot);
  }
  return path.resolve(workspaceRoot, projectPath);
}

/** 从工具 JSON args 中提取项目/仓库路径字段（防御：即使调用方只传 args 也能校验越界）。 */
export function extractProjectPath(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ['repository_path', 'project_path', 'path', 'workspace_root']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/** 归一化工具名：trace_call_path → trace_path（canonical）。 */
export function canonicalToolName(tool: string): string {
  if (tool === TRACE_CALL_PATH_TOOL) return TRACE_PATH_TOOL;
  return tool;
}

/** 该工具名是否属于 trace 家族（支持旧版本 trace_call_path fallback）。 */
export function isTraceTool(tool: string): boolean {
  return tool === TRACE_PATH_TOOL || tool === TRACE_CALL_PATH_TOOL;
}

/** 从 CLI 输出中判断是否为“工具不存在”类错误（触发 trace_call_path fallback）。 */
export function isToolNotFoundOutput(stdout: string, stderr: string): boolean {
  const hay = `${stdout}\n${stderr}`;
  return /(unknown tool|invalid tool|unrecognized (tool|subcommand)|no such tool|tool .* not found|command not found)/i.test(
    hay,
  );
}

/** 敏感环境变量键：token/secret/password/api key/auth 等，从子进程环境剥离。 */
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|api[_-]?key|access[_-]?key|auth|credential|session|cookie|bearer|private[_-]?key)/i;

export function isSensitiveEnvKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * 构建子进程环境白名单。
 *
 * - 只从 base（默认 process.env）复制 {@link CBM_ENV_WHITELIST} 中的项，
 *   因此 provider token（OPENAI_API_KEY / ANTHROPIC_API_KEY 等）天然不会被继承；
 * - 在结果上叠加调用方显式覆盖（如 CBM_CACHE_DIR），敏感键会被剥离（纵深防御）。
 */
export function buildCbmEnv(
  overrides: Record<string, string | undefined> = {},
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of CBM_ENV_WHITELIST) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && !isSensitiveEnvKey(key)) env[key] = value;
  }
  return env;
}
