import path from 'node:path';
import type { ReplaceOptions, SearchOptions } from './types';

/**
 * 工作区路径边界违规。当请求的搜索路径解析后位于工作区根目录之外时抛出。
 */
export class WorkspaceBoundaryError extends Error {
  constructor(
    readonly requested: string,
    readonly workspaceRoot: string,
  ) {
    super(
      `Path "${requested}" is outside the workspace root "${workspaceRoot}" and was rejected.`,
    );
    this.name = 'WorkspaceBoundaryError';
  }
}

const GLOB_METACHARACTERS = /[*?[\]{}]/;

/**
 * 返回路径中用于导航（解析真实目录）的前缀，去掉 glob 元字符段。
 * 例如 `src/**\/*.ts` → `src`；无 glob 时返回原路径。
 */
function navigablePrefix(p: string): string {
  const globIndex = p.search(GLOB_METACHARACTERS);
  if (globIndex === -1) return p;
  const beforeGlob = p.slice(0, globIndex);
  const lastSlash = Math.max(beforeGlob.lastIndexOf('/'), beforeGlob.lastIndexOf('\\'));
  if (lastSlash === -1) return '';
  return p.slice(0, lastSlash);
}

/** 判断 candidate（可能是相对/绝对/含 glob 的路径）是否位于 root 内。 */
export function isPathWithinRoot(candidate: string, root: string): boolean {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, navigablePrefix(candidate));
  const rel = path.relative(rootResolved, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface ResolvedWorkspacePaths {
  /** 传给 CLI 的路径参数（保持调用方写法，相对于 workspaceRoot 解析）。 */
  paths: string[];
  /** spawn 的工作目录。 */
  cwd: string;
}

/**
 * 校验并解析工作区路径。
 * - 未提供 paths 时默认 `[' . ']`。
 * - 任一路径逃逸出 workspaceRoot 时抛出 {@link WorkspaceBoundaryError}。
 */
export function resolveWorkspacePaths(
  paths: string[] | undefined,
  workspaceRoot: string,
): ResolvedWorkspacePaths {
  const root = path.resolve(workspaceRoot);
  const requested = paths && paths.length > 0 ? paths : ['.'];
  for (const p of requested) {
    if (!isPathWithinRoot(p, root)) {
      throw new WorkspaceBoundaryError(p, root);
    }
  }
  return { paths: requested, cwd: root };
}

export type SgPassMode = 'report' | 'apply';

/**
 * 构建 ast-grep CLI 参数。
 *
 * `report`：始终带 `--json=compact`，用于读取结构化结果。
 * `apply`：替换时去掉 json，加 `--update-all` 真正写入文件。
 *
 * 注意（关键）：在 ast-grep 0.45.x 中，`--json=compact` 与 `--update-all`
 * 并存时**不会写入文件**（退化为 dry-run 输出）。因此 apply 必须走无 json 的
 * 独立一遍，见 cli.ts 的 runSg。
 */
export function buildSgArgs(options: SearchOptions, mode: SgPassMode): string[] {
  const args = ['run', '-p', options.pattern, '--lang', options.lang];
  const rewrite = 'rewrite' in options ? (options as ReplaceOptions).rewrite : undefined;
  const isReplace = rewrite != null;

  if (mode === 'apply') {
    if (!isReplace) {
      throw new Error('apply mode requires a replace rewrite');
    }
    args.push('-r', rewrite!, '--update-all');
    if (options.context && options.context > 0) {
      args.push('-C', String(options.context));
    }
    for (const g of options.globs ?? []) args.push('--globs', g);
    const paths = options.paths && options.paths.length > 0 ? options.paths : ['.'];
    args.push(...paths);
    return args;
  }

  // report 模式
  args.push('--json=compact');
  if (isReplace) {
    args.push('-r', rewrite!);
  }
  if (options.context && options.context > 0) {
    args.push('-C', String(options.context));
  }
  for (const g of options.globs ?? []) args.push('--globs', g);
  const paths = options.paths && options.paths.length > 0 ? options.paths : ['.'];
  args.push(...paths);
  return args;
}

/** 是否是需要写入文件的替换请求（dryRun 显式为 false）。 */
export function shouldApplyChanges(
  options: SearchOptions,
): options is SearchOptions & { rewrite: string; dryRun: false } {
  return (
    'rewrite' in options &&
    options.rewrite != null &&
    'dryRun' in options &&
    options.dryRun === false
  );
}
