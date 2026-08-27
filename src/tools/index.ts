/**
 * Oceanus 新增工具的 v2 注册（tooling-9-v2-wiring）。
 *
 * 通过 `ctx.tool.transform` 注册 ast_grep_search / ast_grep_replace / hashline_edit /
 * task_status / task_result / task_cancel，并按配置过滤（默认全部启用）。
 * - AST 与 hashline 的路径必须解析到当前 session 的工作区根内。
 * - task 三件套围绕 v2 session APIs + 本地 task registry 实现。
 * - 不引入 v1 client shim；错误一律以结构化 result 返回，不抛异常。
 */
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { runSg } from './ast-grep/cli';
import { CLI_LANGUAGES, type CliLanguage, type ReplaceOptions, type SearchOptions } from './ast-grep/types';
import { isPathWithinRoot } from './ast-grep/args';
import {
  applyHashlineEditToFile,
  DEFAULT_BOUNDARY_LIMITS,
  type RawHashlineEdit,
} from './hashline-edit';
import { TaskRegistry, TaskAccessDeniedError } from './task/registry';
import type { JobBoard } from './task/job-board';
import { buildTaskMessageTool } from './task/message';
import { buildTaskReviveTool } from './task/revive';
import { isTerminalStatus, type TaskRecord } from './task/types';
import { buildCbmTools } from './cbm';
import type { IndexerHandle, IndexerRunCli } from '../cbm/indexer';
import type { CbmRunDeps } from './cbm/types';
import { isToolEnabled, getToolConfig } from '../config/utils';
import type { PluginConfig } from '../config/schema';
import { resolveWorkspaceRoot } from '../runtime/workspace';
import { createTaskSupervisor, type TaskSupervisor } from '../runtime/task-supervisor';
import { createV2SessionAdapter } from '../runtime/task-capabilities';
import {
  getTaskRegistry,
  resolveTaskHostStatus,
  cancelChildSession,
  readSessionOutcome,
} from '../runtime/task';
import type { ToolContextLike, ToolDefinition, ToolResult, ToolingContext } from '../runtime/types';

/** 注册期可选依赖（测试注入）。 */
export interface RegisterToolsOptions {
  registry?: TaskRegistry;
  /** T5 JobBoard；工具仅负责协议字段转换，调度仍由 JobBoard 执行。 */
  board?: JobBoard;
  supervisor?: TaskSupervisor;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  /** CBM 注入（测试）：替代 runCbmCli 的 CLI 执行函数。 */
  cbmRunCli?: IndexerRunCli;
  /** CBM 注入（测试）：CLI 执行依赖（spawn / resolveBinary / ensureInstalled）。 */
  cbmRunDeps?: CbmRunDeps;
  /** CBM 注入（测试）：自定义索引器。 */
  cbmIndexer?: IndexerHandle;
  /** CBM 共享缓存根目录。 */
  cbmCacheRoot?: string;
  /** 任务生命周期观测：记录生产接线实际收到的 JobBoard。 */
  taskLifecycleObserver?: (board: JobBoard) => void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function contentResult(obj: unknown): ToolResult {
  return { content: JSON.stringify(obj, null, 2) };
}
function errorResult(message: string, errorCode = 'INVALID_INPUT'): ToolResult {
  return { content: JSON.stringify({ error: message, errorCode }, null, 2) };
}

/** T5：跨 parent 越权访问统一映射为 PARENT_OWNERSHIP；其余错误原样透传。 */
function taskAccessError(e: unknown): ToolResult | undefined {
  if (e instanceof TaskAccessDeniedError) return errorResult(messageOf(e), 'PARENT_OWNERSHIP');
  return undefined;
}

/** T5：安全读取 JobBoard 上的任务（board 缺失或任务不存在时返回 undefined）。 */
function readBoardTask(board: JobBoard | undefined, taskId: string): any | undefined {
  if (!board) return undefined;
  try {
    return (board as any).get(taskId);
  } catch {
    return undefined;
  }
}
function hashlineErrorResult(pathValue: string | null, message: string, errorCode = 'INVALID_INPUT'): ToolResult {
  return contentResult({
    ok: false,
    path: pathValue,
    created: false,
    changed: false,
    before: '',
    after: '',
    diff: '',
    additions: 0,
    deletions: 0,
    noopEdits: 0,
    deduplicatedEdits: 0,
    errorCode,
    error: message,
  });
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const asBoolean = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const asStringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? (v.filter((x): x is string => typeof x === 'string') as string[]) : undefined;

function defineTool(def: {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute(input: any, context: ToolContextLike): Promise<ToolResult>;
}): ToolDefinition {
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    execute: def.execute,
  } as ToolDefinition;
}

// ─────────────────────────── AST ───────────────────────────

function buildSearchTool(wctx: ToolingContext, config: PluginConfig): ToolDefinition {
  return defineTool({
    name: 'ast_grep_search',
    description:
      '使用 AST 语法模式在代码中搜索匹配。返回结构化 JSON 匹配（file / range / text / lines）。支持 $VAR、$$$ 元变量。只读。',
    input: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'AST 语法模式，如 "console.$LOG($ARG)"' },
        lang: {
          type: 'string',
          description: '目标语言',
          enum: CLI_LANGUAGES,
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '搜索路径（默认整个工作区）；必须位于工作区内',
        },
        globs: {
          type: 'array',
          items: { type: 'string' },
          description: 'include/exclude glob（! 前缀排除）',
        },
        context: { type: 'number', description: '匹配上下文行数' },
        maxMatches: { type: 'number' },
        maxOutputBytes: { type: 'number' },
        timeoutMs: { type: 'number' },
      },
      required: ['pattern', 'lang'],
    },
    async execute(input, tctx) {
      const root = await resolveWorkspaceRoot(wctx.session, tctx.sessionID);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const pattern = asString(input?.pattern);
      const lang = asString(input?.lang);
      if (!pattern) return errorResult('pattern 必填');
      if (!lang || !CLI_LANGUAGES.includes(lang as CliLanguage)) {
        return errorResult(`lang 必填且必须是受支持语言之一`);
      }
      const cfg = getToolConfig(config, 'ast_grep_search');
      const opts: SearchOptions = {
        pattern,
        lang: lang as CliLanguage,
        paths: asStringArray(input?.paths),
        globs: asStringArray(input?.globs),
        context: asNumber(input?.context),
        workspaceRoot: root,
        maxMatches: asNumber(input?.maxMatches) ?? cfg?.maxMatches,
        maxOutputBytes: asNumber(input?.maxOutputBytes) ?? cfg?.maxOutputBytes,
        timeoutMs: asNumber(input?.timeoutMs) ?? cfg?.timeoutMs,
      };
      return contentResult(await runSg(opts));
    },
  });
}

function buildReplaceTool(wctx: ToolingContext, config: PluginConfig): ToolDefinition {
  return defineTool({
    name: 'ast_grep_replace',
    description:
      '使用 AST 语法模式查找并替换。默认 dry-run（仅预览 replacement，不改写文件）；显式 dryRun:false 才真正写入。只改写位于工作区内的文件。',
    input: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'AST 语法模式' },
        rewrite: { type: 'string', description: '替换模板，可使用 $VAR' },
        lang: { type: 'string', enum: CLI_LANGUAGES },
        paths: { type: 'array', items: { type: 'string' } },
        globs: { type: 'array', items: { type: 'string' } },
        context: { type: 'number' },
        dryRun: { type: 'boolean', description: '默认 true（预览）；false 才写入' },
        maxMatches: { type: 'number' },
        maxOutputBytes: { type: 'number' },
        timeoutMs: { type: 'number' },
      },
      required: ['pattern', 'rewrite', 'lang'],
    },
    async execute(input, tctx) {
      const root = await resolveWorkspaceRoot(wctx.session, tctx.sessionID);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const pattern = asString(input?.pattern);
      const rewrite = asString(input?.rewrite);
      const lang = asString(input?.lang);
      if (!pattern) return errorResult('pattern 必填');
      if (!rewrite) return errorResult('rewrite 必填');
      if (!lang || !CLI_LANGUAGES.includes(lang as CliLanguage)) {
        return errorResult(`lang 必填且必须是受支持语言之一`);
      }
      const cfg = getToolConfig(config, 'ast_grep_replace');
      const opts: ReplaceOptions = {
        pattern,
        rewrite,
        lang: lang as CliLanguage,
        paths: asStringArray(input?.paths),
        globs: asStringArray(input?.globs),
        context: asNumber(input?.context),
        workspaceRoot: root,
        dryRun: asBoolean(input?.dryRun) ?? cfg?.dryRun ?? true,
        maxMatches: asNumber(input?.maxMatches) ?? cfg?.maxMatches,
        maxOutputBytes: asNumber(input?.maxOutputBytes) ?? cfg?.maxOutputBytes,
        timeoutMs: asNumber(input?.timeoutMs) ?? cfg?.timeoutMs,
      };
      return contentResult(await runSg(opts));
    },
  });
}

// ─────────────────────────── hashline ───────────────────────────

function buildHashlineTool(wctx: ToolingContext, config: PluginConfig): ToolDefinition {
  return defineTool({
    name: 'hashline_edit',
    description:
      '按文件行 hash 锚点执行 replace / append / prepend，校验文件版本并返回结构化 diff。hash mismatch 时返回可操作的重新读取提示，不会静默重试。目标文件必须位于工作区内。',
    input: {
      type: 'object',
      additionalProperties: false,
      properties: {
        filePath: { type: 'string', description: '目标文件路径（相对于工作区或绝对路径）' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              op: { type: 'string', enum: ['replace', 'append', 'prepend'] },
              pos: { type: 'string', description: '行 hash 锚点' },
              end: { type: 'string', description: 'replace 结束行 hash 锚点' },
              lines: {
                anyOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
              },
            },
            required: ['op'],
          },
          description: '编辑列表',
        },
         maxFileBytes: { type: 'integer', minimum: 1 },
        delete: { type: 'boolean', description: '删除目标文件' },
        rename: { type: 'string', description: '将目标文件重命名到该路径' },
      },
       required: ['filePath'],
    },
    async execute(input, tctx) {
      const filePath = asString(input?.filePath);
      if (!filePath) return hashlineErrorResult('', 'filePath 必填');
      const edits = input?.edits;
      if ((!Array.isArray(edits) || edits.length === 0) && !input?.delete && input?.rename === undefined) {
        return hashlineErrorResult(filePath, 'edits 必须是非空数组');
      }
      const root = await resolveWorkspaceRoot(wctx.session, tctx.sessionID);
      if (!root) return hashlineErrorResult(null, '无法解析当前会话的工作区根目录', 'IO_ERROR');

      const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(root, filePath);
      const canonicalRoot = await realpath(root).catch(() => path.resolve(root));
      const canonicalTarget = await realpath(resolved).catch(() => resolved);
      if (!isPathWithinRoot(resolved, root) || !isPathWithinRoot(canonicalTarget, canonicalRoot)) {
        return hashlineErrorResult(null, `路径位于工作区之外，已拒绝: ${filePath}`, 'OUTSIDE_WORKSPACE');
      }

      const cfg = getToolConfig(config, 'hashline_edit');
      if (input?.maxFileBytes !== undefined &&
          (typeof input.maxFileBytes !== 'number' || !Number.isFinite(input.maxFileBytes) ||
           !Number.isInteger(input.maxFileBytes) || input.maxFileBytes <= 0)) {
        return hashlineErrorResult(filePath, 'maxFileBytes 必须是有限正整数');
      }
      const limits = {
        maxFileBytes: asNumber(input?.maxFileBytes) ?? cfg?.maxFileBytes ?? DEFAULT_BOUNDARY_LIMITS.maxFileBytes,
      };
      if (input?.rename !== undefined) {
       const target = path.resolve(root, input.rename);
       if (path.isAbsolute(input.rename) || !isPathWithinRoot(target, root) || !isPathWithinRoot(path.dirname(target), canonicalRoot)) {
          return hashlineErrorResult(null, `重命名目标位于工作区之外，已拒绝: ${input.rename}`, 'OUTSIDE_WORKSPACE');
        }
      }
      const result = await applyHashlineEditToFile(resolved, (edits ?? []) as RawHashlineEdit[], { limits, root, delete: input?.delete === true, rename: input?.rename });
      return contentResult(result);
    },
  });
}

// ─────────────────────────── task 三件套 ───────────────────────────

function taskRecordView(rec: TaskRecord, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    taskId: rec.id,
    label: rec.label,
    parentSessionId: rec.parentSessionId,
    childSessionId: rec.childSessionId,
    createdAt: rec.createdAt,
    lastActivityAt: rec.lastActivityAt,
    ...extra,
  };
}

function buildTaskStatusTool(
  wctx: ToolingContext,
  config: PluginConfig,
  opts: RegisterToolsOptions,
): ToolDefinition {
  return defineTool({
    name: 'task_status',
    description: '查询由本插件管理的后台子任务状态。状态优先来自宿主 session，其次为本地索引。',
    input: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '任务 id' } },
      required: ['taskId'],
    },
    async execute(input, tctx) {
      const taskId = asString(input?.taskId);
      if (!taskId) return errorResult('taskId 必填');
      const registry = opts.registry ?? getTaskRegistry();
      let rec: TaskRecord | undefined;
      try {
        rec = registry.get(taskId, tctx.sessionID);
      } catch (e) {
        return taskAccessError(e) ?? errorResult(messageOf(e));
      }
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      // T5：board 上的 generation 为准（revive 递增）；旧 generation 的事实不可作为当前状态。
      const boardTask = readBoardTask(opts.board, taskId);
      const generation = Math.max(
        rec.generation,
        typeof boardTask?.generation === 'number' ? boardTask.generation : rec.generation,
      );
      const host = await resolveTaskHostStatus(wctx.session, rec);
      return contentResult(
        taskRecordView(rec, {
          status: host.status,
          source: host.source,
          verified: host.verified,
          certainty: host.certainty,
          generation,
        }),
      );
    },
  });
}

function buildTaskResultTool(
  wctx: ToolingContext,
  config: PluginConfig,
  opts: RegisterToolsOptions,
): ToolDefinition {
  return defineTool({
    name: 'task_result',
    description: '读取已完成子任务的最终结果。只读已完成任务；未完成会返回错误。',
    input: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '任务 id' } },
      required: ['taskId'],
    },
    async execute(input, tctx) {
      const taskId = asString(input?.taskId);
      if (!taskId) return errorResult('taskId 必填');
      const registry = opts.registry ?? getTaskRegistry();
      let rec: TaskRecord | undefined;
      try {
        rec = registry.get(taskId, tctx.sessionID);
      } catch (e) {
        return taskAccessError(e) ?? errorResult(messageOf(e));
      }
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      const host = await resolveTaskHostStatus(wctx.session, rec);
      // T5：宿主事实优先级统一。
      // 1) 宿主已确认 running（或任何非终态）→ 旧 observation 的终态一律不返回。
      // 2) 宿主已确认终态 → 宿主 outcome 覆盖旧 observation。
      // 3) 宿主无法确认 → 仅当 registry 中有明确终态观察且未被 revive（generation 未过期）时回退。
      if (host.verified && !isTerminalStatus(host.status)) {
        return errorResult(
          `task ${taskId} 尚未完成（当前: ${host.status}）。task_result 只读经宿主验证或已明确观察到的终态任务。`,
        );
      }
      const boardTask = readBoardTask(opts.board, taskId);
      if (
        boardTask &&
        typeof boardTask.generation === 'number' &&
        boardTask.generation > rec.generation
      ) {
        return errorResult(
          `task ${taskId} 已被 revive（generation ${rec.generation} → ${boardTask.generation}），旧 generation 的结果不可返回；请等待新 attempt 终态。`,
          'STALE_GENERATION',
        );
      }
      const hostTerminal = host.verified && isTerminalStatus(host.status);
      const storedTerminal =
        Boolean(rec.observation) &&
        Boolean(rec.observation?.status) &&
        isTerminalStatus(rec.observation!.status!);
      if (!hostTerminal && !storedTerminal) {
        return errorResult(
          `task ${taskId} 尚未完成（当前: ${host.status}，verified:${host.verified}）。task_result 只读经宿主验证或已明确观察到的终态任务。`,
        );
      }
      if (hostTerminal) {
        const outcome = await readSessionOutcome(wctx.session, rec.childSessionId);
        return contentResult(
          taskRecordView(rec, {
            status: host.status,
            outcome,
            source: host.source,
            verified: true,
            certainty: 'authoritative',
            generation: rec.generation,
            // 宿主终态优先，但观察文本作为补充上下文一并返回。
            resultText: rec.observation?.text,
          }),
        );
      }
      return contentResult(
        taskRecordView(rec, {
          status: rec.observation!.status!,
          source: 'registry',
          verified: false,
          certainty: 'uncertain',
          generation: rec.generation,
          resultText: rec.observation?.text,
        }),
      );
    },
  });
}

function buildTaskCancelTool(
  wctx: ToolingContext,
  config: PluginConfig,
  opts: RegisterToolsOptions,
): ToolDefinition {
  return defineTool({
    name: 'task_cancel',
    description:
      '取消由本插件管理的后台子任务：中断其子 session 并验证宿主状态。调用方必须是任务的父或子 session，且可传入 parentID/childID 交叉校验 ownership。',
    input: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        parentID: { type: 'string', description: '可选；校验与任务记录的父 session 一致' },
        childID: { type: 'string', description: '可选；校验与任务记录的子 session 一致' },
      },
      required: ['taskId'],
    },
    async execute(input, tctx) {
      const taskId = asString(input?.taskId);
      if (!taskId) return errorResult('taskId 必填');
      const parentID = asString(input?.parentID);
      const childID = asString(input?.childID);
       if (opts.board) {
         try {
           const task: any = opts.board.get(taskId);
          if (task.parent_session_id !== tctx.sessionID || (parentID && parentID !== task.parent_session_id) || (childID && childID !== task.child_session_id)) return errorResult('PARENT_OWNERSHIP');
           const supervisor = opts.supervisor ?? createTaskSupervisor({ board: opts.board, session: wctx.session });
           const outcome = await supervisor.cancel(taskId);
           const fresh: any = opts.board.get(taskId);
           return contentResult({ taskId, status: fresh.state, outcome, generation: task.generation, childSessionId: task.child_session_id });
        } catch (e) { return errorResult(messageOf(e)); }
      }
      const registry = opts.registry ?? getTaskRegistry();
      let rec: TaskRecord | undefined;
      try {
        rec = registry.get(taskId, tctx.sessionID);
      } catch (e) {
        return errorResult(messageOf(e));
      }
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      if (parentID && parentID !== rec.parentSessionId) {
        return errorResult(`parentID 与任务记录不匹配`);
      }
      if (childID && childID !== rec.childSessionId) {
        return errorResult(`childID 与任务记录不匹配`);
      }
      if (!rec.childSessionId) {
        return errorResult('task 没有关联的子 session，无法取消');
      }
      const verification = await cancelChildSession(wctx.session, rec.childSessionId);
      // 只有在 interrupt 成功且验证后不再 active、outcome 明确为 interrupted/succeeded
      // 时才更新 registry 为 cancelled；否则不伪造 cancelled，返回结构化错误。
      const confirmed =
        verification.interrupted === true &&
        verification.activeNow !== true &&
        (verification.outcome === 'interrupted' || verification.outcome === 'succeeded');
      if (confirmed) {
        try {
          registry.updateStatus(taskId, tctx.sessionID, 'cancelled');
        } catch {
          /* 状态索引尽力而为，不阻断取消结果 */
        }
        return contentResult({
          taskId,
          status: 'cancelled',
          interrupted: verification.interrupted,
          outcome: verification.outcome,
          activeNow: verification.activeNow,
        });
      }
      return errorResult(
        `取消未确认: interrupt=${String(verification.interrupted)}` +
          `, outcome=${verification.outcome ?? 'unknown'}` +
          `, activeNow=${String(verification.activeNow)}`,
      );
    },
  });
}

// ─────────────────────────── 注册入口 ───────────────────────────

const TOOL_BUILDERS: ReadonlyArray<{
  name: string;
  build(ctx: ToolingContext, config: PluginConfig, opts: RegisterToolsOptions): ToolDefinition;
}> = [
  { name: 'ast_grep_search', build: buildSearchTool },
  { name: 'ast_grep_replace', build: buildReplaceTool },
  { name: 'hashline_edit', build: buildHashlineTool },
  { name: 'task_status', build: buildTaskStatusTool },
  { name: 'task_result', build: buildTaskResultTool },
  { name: 'task_cancel', build: buildTaskCancelTool },
  { name: 'task_message', build: (ctx, _config, opts) => buildTaskMessageTool(opts.board, createV2SessionAdapter(ctx.session)) },
  { name: 'task_revive', build: (ctx, _config, opts) => buildTaskReviveTool(opts.board, createV2SessionAdapter(ctx.session)) },
];

/**
 * 通过 `ctx.tool.transform` 注册全部启用的新增工具。
 * 返回 host 的 transform Registration（Promise<unknown>）。
 */
export async function registerOceanusTools(
  ctx: ToolingContext,
  config: PluginConfig,
  opts: RegisterToolsOptions = {},
): Promise<unknown> {
  if (opts.board) opts.taskLifecycleObserver?.(opts.board);
  const log = opts.logger ?? (() => {});
  const enabled = TOOL_BUILDERS.filter(({ name }) => isToolEnabled(config, name));
  // CBM CLI 兜底工具（CBM-09）：尊重 codebaseMemory.enabled / cliFallback 门控，
  // 构建失败独立容错，不阻断已有工具注册。
  let cbmTools: ReturnType<typeof buildCbmTools> = [];
  try {
    cbmTools = buildCbmTools(ctx, config, {
      runCli: opts.cbmRunCli,
      runDeps: opts.cbmRunDeps,
      indexer: opts.cbmIndexer,
      cacheRoot: opts.cbmCacheRoot,
    });
  } catch (e) {
    log('[oceanus] CBM 工具构建失败', { error: messageOf(e) });
  }
  return ctx.tool.transform((draft) => {
    for (const { name, build } of enabled) {
      try {
        draft.add(build(ctx, config, opts));
      } catch (e) {
        log(`[oceanus] 注册工具失败: ${name}`, { error: messageOf(e) });
      }
    }
    for (const tool of cbmTools) {
      try {
        draft.add(tool);
      } catch (e) {
        log(`[oceanus] 注册 CBM 工具失败: ${tool.name}`, { error: messageOf(e) });
      }
    }
  });
}
