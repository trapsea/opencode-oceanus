import { resolve } from 'node:path';

/**
 * apply_patch 输入检查与保守重写（tooling-7-apply-patch）。
 *
 * 目标：为 opencode v2 `execute.before` Hook 提供 apply_patch 的输入校验与
 * 保守重写。本模块只包含可验证的纯逻辑与 Hook 工厂，不负责注册
 * （注册、session→canonical root 解析在 tooling-9-v2-wiring 中完成）。
 *
 * 参考 oh-my-opencode-slim 的 apply-patch 算法思想（解析 Codex 风格
 * `*** Begin Patch ... *** End Patch`、hunk、路径边界、改写与验证），但
 * 不复制其 v1 `output.args` 写法：v2 通过读写 `event.input` 完成。
 *
 * 错误策略（fail-open / fail-closed）：
 * - fail-open：目标路径在工作区外（`blocked/outside_workspace`）；
 *   `event.input` 只读导致写回失败。二者都不抛、不改写，交由宿主处理。
 * - fail-closed：输入形状未知/无效（validation）、改写校验失败（verification）、
 *   内部异常（internal）→ 一律抛 `ApplyPatchError`，阻断工具执行。
 *
 * 保守重写只做无损、可验证的规范化：CRLF→LF、heredoc 去包裹、外层空行裁剪、
 * 结构行尾空白裁剪、header 路径 `\`→`/`。绝不改写 ` ` / `+` / `-` 内容行，
 * 并以“重写前后语义等价”作为校验闸门，任何结构变化都判为验证失败。
 */

// ─────────────────────────────── 类型 ───────────────────────────────

export type ApplyPatchErrorKind =
  | 'blocked'
  | 'validation'
  | 'verification'
  | 'internal';

export type ApplyPatchErrorCode =
  | 'outside_workspace'
  | 'malformed_patch'
  | 'verification_failed'
  | 'internal_unexpected';

export class ApplyPatchError extends Error {
  override readonly cause?: unknown;

  constructor(
    readonly kind: ApplyPatchErrorKind,
    readonly code: ApplyPatchErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'ApplyPatchError';
    this.cause = options?.cause;
  }
}

export interface PatchChunk {
  oldLines: string[];
  newLines: string[];
  /** 来自 `@@ ...` 的上下文描述，仅作诊断用途。 */
  context?: string;
  /** 出现 `*** End of File` 时为 true。 */
  eof?: boolean;
}

export type PatchHunk =
  | { type: 'add'; path: string; contents: string }
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; moveTo?: string; chunks: PatchChunk[] };

export interface ParsedPatch {
  hunks: PatchHunk[];
}

export interface RewritePatchOptions {
  /** 是否剥离 heredoc 包裹；默认 true。 */
  stripHeredoc?: boolean;
  /** 是否规范化 header 路径 `\`→`/`；默认 true。 */
  normalizePaths?: boolean;
}

export interface RewriteResult {
  patchText: string;
  changed: boolean;
}

/** v2 `execute.before` 事件的最小结构；生产事件还含 sessionID/agent/id 等字段。 */
export interface ApplyPatchHookEvent {
  tool: string;
  input: unknown;
}

export type ApplyPatchBeforeHook = (event: ApplyPatchHookEvent) => Promise<void>;

/** Hook 处理状态，供注入的 onStatus 观测。 */
export type ApplyPatchHookStatus =
  | 'rewritten'
  | 'unchanged'
  | 'failopen'
  | 'validation'
  | 'verification'
  | 'blocked'
  | 'internal';

export interface ApplyPatchHookOptions {
  /** 工作区根目录（canonical）。v2 中由 session→project 解析后注入。 */
  root: string;
  /** 改写函数，可注入以测试 fail-closed；默认 {@link rewritePatchConservatively}。 */
  rewrite?: (
    patchText: string,
    base?: ParsedPatch,
    opts?: RewritePatchOptions,
  ) => RewriteResult;
  /** 解析函数，可注入以测试；默认 {@link parsePatch}。 */
  parse?: (patchText: string) => ParsedPatch;
  /** 观测回调（测试注入 spy / 生产注入 logger）。 */
  onStatus?: (status: ApplyPatchHookStatus, data?: Record<string, unknown>) => void;
}

// ─────────────────────────────── 错误工具 ───────────────────────────────

function malformed(message: string): ApplyPatchError {
  return new ApplyPatchError('validation', 'malformed_patch', message);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asApplyPatchError(error: unknown, context: string): ApplyPatchError {
  if (error instanceof ApplyPatchError) {
    return error;
  }
  return new ApplyPatchError(
    'internal',
    'internal_unexpected',
    `${context}: internal error: ${messageOf(error)}`,
    { cause: error },
  );
}

function isOutsideWorkspace(error: unknown): boolean {
  return error instanceof ApplyPatchError && error.code === 'outside_workspace';
}

// ─────────────────────────────── 文本规范化 ───────────────────────────────

function normalizeEOL(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 剥离形如 `<<'ID'` / `cat <<ID` 的 heredoc 包裹（模型常见产物）。 */
function stripHeredoc(text: string): string {
  const match = text.match(
    /^(?:cat\s+)?<<['"]?([A-Za-z_][\w-]*)['"]?\s*\r?\n([\s\S]*?)\r?\n\s*\1\s*$/,
  );
  return match ? match[2] : text;
}

/** 裁剪文本最外层（`*** Begin Patch` 之前 / `*** End Patch` 之后）的空白行。 */
function trimOuterBlankLines(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

const HEADER_FILE_RE = /^(\*\*\* (?:Add|Delete|Update) File:\s*)(.*)$/;
const HEADER_MOVE_RE = /^(\*\*\* Move to:\s*)(.*)$/;

/**
 * 规范化结构性行（不触碰 ` ` / `+` / `-` 内容行）：
 * - header 路径 `\`→`/`；
 * - 结构性行（marker、`@@`、header）尾部空白裁剪。
 */
function normalizeHeaderPaths(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const header = line.match(HEADER_FILE_RE) ?? line.match(HEADER_MOVE_RE);
      if (header) {
        return header[1] + header[2].split('\\').join('/').trimEnd();
      }
      if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-')) {
        return line.trimEnd();
      }
      return line;
    })
    .join('\n');
}

/** 生成“可解析文本”：CRLF→LF、去 heredoc、外层空白裁剪；不做路径规范化。 */
export function preparePatchText(
  patchText: string,
  opts: RewritePatchOptions = {},
): string {
  const normalized = normalizeEOL(patchText);
  const stripped = opts.stripHeredoc === false ? normalized : stripHeredoc(normalized);
  return trimOuterBlankLines(stripped);
}

// ─────────────────────────────── 解析 ───────────────────────────────

const BEGIN_MARKER = '*** Begin Patch';
const END_MARKER = '*** End Patch';
const EOF_MARKER = '*** End of File';

/**
 * 解析 Codex 风格 apply_patch 文本。对结构严格（缺 Begin/End 标记、非法 header、
 * 非法 chunk 行 → validation 错误），对空白分隔行宽容（空行可跳过）。
 */
export function parsePatch(text: string): ParsedPatch {
  const lines = text.split('\n');
  const begin = lines.findIndex((line) => line.trimEnd() === BEGIN_MARKER);
  const end = lines.findIndex(
    (line, index) => index > begin && line.trimEnd() === END_MARKER,
  );
  if (begin === -1 || end === -1 || begin >= end) {
    throw malformed('missing *** Begin Patch / *** End Patch markers');
  }

  const hunks: PatchHunk[] = [];
  let index = begin + 1;

  while (index < end) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (line.startsWith('*** Add File:')) {
      const path = line.slice('*** Add File:'.length).trim();
      if (!path) throw malformed('Add File missing path');
      index += 1;
      const content: string[] = [];
      while (index < end) {
        const current = lines[index];
        if (current.startsWith('***')) break;
        if (current.trim() === '') {
          index += 1;
          continue;
        }
        if (!current.startsWith('+')) {
          throw malformed(`unexpected line in Add File body: ${current.length ? current : '<empty>'}`);
        }
        content.push(current.slice(1));
        index += 1;
      }
      hunks.push({ type: 'add', path, contents: content.join('\n') });
      continue;
    }

    if (line.startsWith('*** Delete File:')) {
      const path = line.slice('*** Delete File:'.length).trim();
      if (!path) throw malformed('Delete File missing path');
      hunks.push({ type: 'delete', path });
      index += 1;
      continue;
    }

    if (line.startsWith('*** Update File:')) {
      const path = line.slice('*** Update File:'.length).trim();
      if (!path) throw malformed('Update File missing path');
      index += 1;
      let moveTo: string | undefined;
      if (lines[index]?.startsWith('*** Move to:')) {
        moveTo = lines[index].slice('*** Move to:'.length).trim();
        if (!moveTo) throw malformed('Move to missing path');
        index += 1;
      }

      const chunks: PatchChunk[] = [];
      while (index < end) {
        const current = lines[index];
        if (current.startsWith('***')) break;
        if (current.trim() === '') {
          index += 1;
          continue;
        }
        if (!current.startsWith('@@')) {
          throw malformed(`expected @@ chunk in Update File ${path}`);
        }
        const context = current.slice(2).trim() || undefined;
        index += 1;

        const oldLines: string[] = [];
        const newLines: string[] = [];
        let eof = false;
        while (index < end) {
          const chunkLine = lines[index];
          if (chunkLine.startsWith('@@')) break;
          if (chunkLine.startsWith('***')) {
            if (chunkLine.trimEnd() === EOF_MARKER) {
              eof = true;
              index += 1;
            }
            break;
          }
          if (chunkLine.trim() === '') {
            index += 1;
            continue;
          }
          if (chunkLine.startsWith(' ')) {
            oldLines.push(chunkLine.slice(1));
            newLines.push(chunkLine.slice(1));
            index += 1;
            continue;
          }
          if (chunkLine.startsWith('-')) {
            oldLines.push(chunkLine.slice(1));
            index += 1;
            continue;
          }
          if (chunkLine.startsWith('+')) {
            newLines.push(chunkLine.slice(1));
            index += 1;
            continue;
          }
          throw malformed(
            `unexpected line in chunk of ${path}: ${chunkLine.length ? chunkLine : '<empty>'}`,
          );
        }
        chunks.push({ oldLines, newLines, context, eof: eof || undefined });
      }
      if (chunks.length === 0) {
        throw malformed(`Update File missing @@ chunks: ${path}`);
      }
      hunks.push({ type: 'update', path, moveTo, chunks });
      continue;
    }

    throw malformed(`unexpected line between hunks: ${line.length ? line : '<empty>'}`);
  }

  return { hunks };
}

// ─────────────────────────────── 路径边界 ───────────────────────────────

function normalizeForComparison(target: string): string {
  return target.split('\\').join('/').replace(/\/+$/, '');
}

function isWithin(root: string, candidate: string): boolean {
  const base = normalizeForComparison(root);
  const target = normalizeForComparison(candidate);
  if (target === base) return true;
  return target.startsWith(`${base}/`);
}

function collectTargets(hunk: PatchHunk): string[] {
  if (hunk.type === 'update') {
    return hunk.moveTo ? [hunk.path, hunk.moveTo] : [hunk.path];
  }
  return [hunk.path];
}

/**
 * 校验所有目标路径均落在工作区根目录内（canonicalize 后）。越界 → `blocked/outside_workspace`，
 * 由 Hook 将其作为唯一 fail-open 条件处理。
 */
export function assertAllTargetsInsideWorkspace(parsed: ParsedPatch, root: string): void {
  const canonicalRoot = resolve(root);
  for (const hunk of parsed.hunks) {
    for (const candidate of collectTargets(hunk)) {
      const resolved = resolve(canonicalRoot, candidate.split('\\').join('/'));
      if (!isWithin(canonicalRoot, resolved)) {
        throw new ApplyPatchError(
          'blocked',
          'outside_workspace',
          `apply_patch target outside workspace: ${candidate}`,
        );
      }
    }
  }
}

// ─────────────────────────────── 等价校验 ───────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizePath(path: string): string {
  return path.split('\\').join('/');
}

/** 判断两次解析在语义上是否等价（路径按 `\`→`/` 归一后比较）。 */
export function verifyRewrite(base: ParsedPatch, candidate: ParsedPatch): boolean {
  if (base.hunks.length !== candidate.hunks.length) return false;
  for (let i = 0; i < base.hunks.length; i += 1) {
    const a = base.hunks[i];
    const b = candidate.hunks[i];
    if (a.type !== b.type) return false;
    if (normalizePath(a.path) !== normalizePath(b.path)) return false;
    if (a.type === 'update') {
      if (b.type !== 'update') return false;
      if ((a.moveTo ?? undefined) !== (b.moveTo ?? undefined)) return false;
      if (a.moveTo && normalizePath(a.moveTo) !== normalizePath(b.moveTo!)) return false;
      if (a.chunks.length !== b.chunks.length) return false;
      for (let j = 0; j < a.chunks.length; j += 1) {
        if (!arraysEqual(a.chunks[j].oldLines, b.chunks[j].oldLines)) return false;
        if (!arraysEqual(a.chunks[j].newLines, b.chunks[j].newLines)) return false;
      }
    } else if (a.type === 'add') {
      if (b.type !== 'add') return false;
      if (a.contents !== b.contents) return false;
    }
  }
  return true;
}

// ─────────────────────────────── 保守重写 ───────────────────────────────

/**
 * 对 apply_patch 文本做保守（仅无损规范化）重写，并以内置等价校验为闸门。
 * 校验失败 → `verification/verification_failed`（fail-closed）。
 */
export function rewritePatchConservatively(
  patchText: string,
  base?: ParsedPatch,
  opts: RewritePatchOptions = {},
): RewriteResult {
  const prepared = preparePatchText(patchText, opts);
  const rewritten =
    opts.normalizePaths === false ? prepared : normalizeHeaderPaths(prepared);

  const baseParsed = base ?? parsePatch(prepared);

  let candidateParsed: ParsedPatch;
  try {
    candidateParsed = parsePatch(rewritten);
  } catch (error) {
    throw new ApplyPatchError(
      'verification',
      'verification_failed',
      `rewritten patch failed to parse: ${messageOf(error)}`,
      { cause: error },
    );
  }

  if (!verifyRewrite(baseParsed, candidateParsed)) {
    throw new ApplyPatchError(
      'verification',
      'verification_failed',
      'rewritten patch is not equivalent to original',
    );
  }

  return { patchText: rewritten, changed: rewritten !== patchText };
}

// ─────────────────────────────── 输入形状读写 ───────────────────────────────

/** 从 `event.input` 读取 patchText；形状未知/无效 → validation（fail-closed）。 */
export function validateApplyPatchInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw malformed('apply_patch input must be an object');
  }
  const patchText = (input as Record<string, unknown>).patchText;
  if (typeof patchText !== 'string') {
    throw malformed('apply_patch input.patchText must be a string');
  }
  return patchText;
}

/**
 * 将重写后的 patchText 写回 `event.input`（原地 + 整体替换双保险，并读回校验）。
 * 成功返回 true；只读/冻结等无法写入时返回 false（由调用方 fail-open）。
 */
export function writePatchInput(event: ApplyPatchHookEvent, patchText: string): boolean {
  const current = event.input;
  if (typeof current !== 'object' || current === null) return false;
  try {
    const next = { ...(current as Record<string, unknown>), patchText };
    Object.assign(current, next);
    (event as { input: unknown }).input = next;
    const readBack = (event as { input: unknown }).input as Record<string, unknown>;
    return typeof readBack === 'object' && readBack !== null && readBack.patchText === patchText;
  } catch {
    return false;
  }
}

// ─────────────────────────────── Hook 工厂 ───────────────────────────────

/** 工具名集合：只处理宿主补丁工具的调用。
 * 双名键控：beta 宿主为 `apply_patch`，OpenCode 2.0 builtin 为 `patch`
 * （@opencode/core@2.0.3 builtin `opencode.tool.patch`；2.0.3 会话目录实证两者
 * 均未见直接暴露，双键保守覆盖两代宿主，免疫改名窗口）。 */
export const APPLY_PATCH_TOOLS: ReadonlySet<string> = new Set(['apply_patch', 'patch']);

/**
 * 构造 v2 `execute.before` Hook。
 *
 * 流程：input 形状校验 → 解析 → 路径边界 → 保守重写 → 重写后防御性再校验 → 写回。
 * fail-open：工作区外路径、只读 `event.input` 写回失败。
 * fail-closed：validation / verification / internal → 抛 `ApplyPatchError`。
 */
export function createApplyPatchHook(options: ApplyPatchHookOptions): ApplyPatchBeforeHook {
  const { root } = options;
  const parse = options.parse ?? parsePatch;
  const rewrite = options.rewrite ?? rewritePatchConservatively;
  const onStatus = options.onStatus ?? (() => {});

  return async (event): Promise<void> => {
    if (!APPLY_PATCH_TOOLS.has(event.tool)) return;

    // 1) 输入形状校验（fail-closed）
    let patchText: string;
    try {
      patchText = validateApplyPatchInput(event.input);
    } catch (error) {
      const err = asApplyPatchError(error, 'validate apply_patch input');
      onStatus(err.kind, { code: err.code, reason: err.message });
      throw err;
    }

    // 2) 解析（fail-closed）
    let parsed: ParsedPatch;
    try {
      parsed = parse(preparePatchText(patchText));
    } catch (error) {
      const err = asApplyPatchError(error, 'parse apply_patch');
      onStatus(err.kind, { code: err.code, reason: err.message });
      throw err;
    }

    // 3) 路径边界（仅 outside_workspace fail-open）
    try {
      assertAllTargetsInsideWorkspace(parsed, root);
    } catch (error) {
      const err = asApplyPatchError(error, 'apply_patch path check');
      if (isOutsideWorkspace(err)) {
        onStatus('failopen', { code: err.code, reason: err.message });
        return;
      }
      onStatus(err.kind, { code: err.code, reason: err.message });
      throw err;
    }

    // 4) 保守重写（fail-closed）
    let result: RewriteResult;
    try {
      result = rewrite(patchText, parsed);
    } catch (error) {
      const err = asApplyPatchError(error, 'rewrite apply_patch');
      onStatus(err.kind, { code: err.code, reason: err.message });
      throw err;
    }
    if (!result.changed) {
      onStatus('unchanged');
      return;
    }

    // 5) 重写后防御性再校验（fail-closed；即使重写引入了越界路径也归为 verification）
    try {
      const reparsed = parse(result.patchText);
      assertAllTargetsInsideWorkspace(reparsed, root);
    } catch (error) {
      const err = new ApplyPatchError(
        'verification',
        'verification_failed',
        `rewritten patch failed verification: ${messageOf(error)}`,
        { cause: error },
      );
      onStatus(err.kind, { code: err.code, reason: err.message });
      throw err;
    }

    // 6) 写回（只读 → fail-open）
    if (!writePatchInput(event, result.patchText)) {
      onStatus('failopen', { reason: 'readonly event.input', failOpen: true });
      return;
    }
    onStatus('rewritten', { patchText: result.patchText });
  };
}
