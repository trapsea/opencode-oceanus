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
  presentHashlineSuccess,
  type RawHashlineEdit,
} from './hashline-edit';
import { buildTaskMessageTool } from './task/message';
import { buildTaskReviveTool } from './task/revive';
import { isTerminalStatus, type TaskStatus } from './task/types';
import { buildClipboardImageTool } from './clipboard-image';
import { buildCbmTools } from './cbm';
import type { IndexerHandle, IndexerRunCli } from '../cbm/indexer';
import type { CbmRunDeps } from './cbm/types';
import { isToolEnabled, getToolConfig } from '../config/utils';
import type { PluginConfig } from '../config/schema';
import { resolveWorkspaceRoot } from '../runtime/workspace';
import type { TaskCoordinator } from '../runtime/task-coordinator';
import {
  resolveTaskHostStatus,
  cancelChildSession,
  readSessionOutcome,
  readSessionLastAssistantText,
} from '../runtime/task';
import type { ToolContextLike, ToolDefinition, ToolResult, ToolingContext } from '../runtime/types';

/** 注册期可选依赖（测试注入）。 */
export interface RegisterToolsOptions {
  /** native-session-orchestration：任务元数据协调器（task 工具必需）。 */
  coordinator?: TaskCoordinator;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  /** CBM 注入（测试）：替代 runCbmCli 的 CLI 执行函数。 */
  cbmRunCli?: IndexerRunCli;
  /** CBM 注入（测试）：CLI 执行依赖（spawn / resolveBinary / ensureInstalled）。 */
  cbmRunDeps?: CbmRunDeps;
  /** CBM 注入（测试）：自定义索引器。 */
  cbmIndexer?: IndexerHandle;
  /** CBM 共享缓存根目录。 */
  cbmCacheRoot?: string;
  /** 任务生命周期观测：记录生产接线实际收到的 coordinator。 */
  taskLifecycleObserver?: (coordinator: TaskCoordinator) => void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function contentResult(obj: unknown): ToolResult {
  return { content: JSON.stringify(obj, null, 2) };
}
function errorResult(message: string, errorCode = 'INVALID_INPUT'): ToolResult {
  return { content: JSON.stringify({ error: message, errorCode }, null, 2) };
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
    hashlineDiff: '',
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
      // 成功结果以可读文本展示（宿主 TUI 对插件工具无 diff 渲染器，GenericTool
      // 原样展示 output 文本）；失败保持结构化 JSON 便于模型读取 error/errorCode。
      if (result.ok) {
        const { text, metadata } = presentHashlineSuccess(result);
        // output 与 content 双写同一文本：宿主读取 result.output（字符串），
        // content 字符串在各版本映射下兜底，保证 TUI 与模型看到同一份 diff。
        return { output: text, content: text, metadata };
      }
      return contentResult(result);
    },
  });
}

// ─────────────────────────── task 工具（coordinator + 原生 session facade） ───────────────────────────

function taskRecordView(rec: any, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    taskId: rec.taskID,
    parentSessionId: rec.parentSessionID,
    agent: rec.agent,
    laneKey: rec.laneKey,
    generation: rec.generation,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    ...extra,
  };
}

/** 从 coordinator 查任务；缺失时返回错误 result。 */
function findTask(coordinator: TaskCoordinator, taskId: string, sessionID: string): any | undefined {
  try {
    return coordinator.listTasks(sessionID).find((t) => t.taskID === taskId);
  } catch {
    return undefined;
  }
}

/**
 * 查任务；登记缺失（bridge 未登记）时以宿主事实兜底登记后再查。
 * ensureRegistered 内部严格校验 parentID，保持按父过滤的安全边界。
 */
async function findTaskWithHostFallback(
  coordinator: TaskCoordinator,
  taskId: string,
  sessionID: string,
): Promise<any | undefined> {
  const direct = findTask(coordinator, taskId, sessionID);
  if (direct) return direct;
  // 防御性调用：测试/注入方可能提供不含 ensureRegistered 的 stub coordinator。
  if (typeof coordinator.ensureRegistered === 'function') {
    await coordinator.ensureRegistered(taskId, sessionID).catch(() => undefined);
  }
  return findTask(coordinator, taskId, sessionID);
}

function buildTaskStatusTool(
  wctx: ToolingContext,
  _config: PluginConfig,
  opts: RegisterToolsOptions,
): ToolDefinition {
  return defineTool({
    name: 'task_status',
    description: '查询由本插件登记的后台子任务状态。状态优先来自宿主原生 session（active/get.outcome），其次本地元数据；task_id 即 child session ID。',
    input: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '任务 id' } },
      required: ['taskId'],
    },
    async execute(input, tctx) {
      const taskId = asString(input?.taskId);
      if (!taskId) return errorResult('taskId 必填');
      const coordinator = opts.coordinator;
      if (!coordinator) return errorResult('coordinator 未接线', 'UNSUPPORTED');
      const rec = await findTaskWithHostFallback(coordinator, taskId, tctx.sessionID);
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      const host = await resolveTaskHostStatus(wctx.session, {
        childSessionId: rec.taskID,
        status: rec.state as TaskStatus,
      });
      return contentResult(
        taskRecordView(rec, {
          status: host.status,
          source: host.source,
          verified: host.verified,
        }),
      );
    },
  });
}

function buildTaskResultTool(
  wctx: ToolingContext,
  _config: PluginConfig,
  opts: RegisterToolsOptions,
): ToolDefinition {
  return defineTool({
    name: 'task_result',
    description: '读取已完成子任务的最终结果。仅返回经宿主原生 session 验证的终态结果；读取成功即消费该结果（放行同目标重派/续用）。',
    input: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '任务 id' } },
      required: ['taskId'],
    },
    async execute(input, tctx) {
      const taskId = asString(input?.taskId);
      if (!taskId) return errorResult('taskId 必填');
      const coordinator = opts.coordinator;
      if (!coordinator) return errorResult('coordinator 未接线', 'UNSUPPORTED');
      const rec = await findTaskWithHostFallback(coordinator, taskId, tctx.sessionID);
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      const host = await resolveTaskHostStatus(wctx.session, {
        childSessionId: rec.taskID,
        status: rec.state as TaskStatus,
      });
      if (host.verified && !isTerminalStatus(host.status)) {
        return errorResult(
          `task ${taskId} 尚未完成（当前: ${host.status}）。task_result 只读经宿主验证的终态任务。`,
        );
      }
      if (!host.verified && !isTerminalStatus(rec.state as TaskStatus)) {
        return errorResult(
          `task ${taskId} 尚无经确认的终态（本地: ${rec.state}，宿主未确认）。不返回未经确认的结果。`,
        );
      }
      const outcome = await readSessionOutcome(wctx.session, rec.taskID);
      // 宿主确认终态 → 同步回写本地元数据（避免只读后本地仍 running）。
      if (host.verified && isTerminalStatus(host.status)) {
        const mapped = host.status === 'completed' ? 'completed' : host.status === 'failed' ? 'failed' : 'cancelled';
        if (rec.state !== mapped) {
          await coordinator.markTerminal(taskId, tctx.sessionID, mapped).catch(() => undefined);
        }
      }
      // 终态结果已被读取：打消费标记，放行 dispatch-guard 的同目标重派断路器。
      // 内容回传：优先 bridge/revive 留存的 resultSummary；缺失时从宿主会话消息
      // （session.context）兜底读取最后一条 assistant 输出，解开"读取即消费却只有元数据"的死角。
      let output: string | undefined = rec.resultSummary;
      if (!output) {
        output = await readSessionLastAssistantText(wctx.session, rec.taskID).catch(() => undefined);
        if (output) {
          await coordinator
            .markTerminal(taskId, tctx.sessionID, rec.state === 'failed' ? 'failed' : 'completed', output)
            .catch(() => undefined);
        }
      }
      await coordinator.markResultConsumed(taskId, tctx.sessionID).catch(() => undefined);
      return contentResult(
        taskRecordView(rec, {
          status: host.verified ? host.status : rec.state,
          outcome,
          source: host.source,
          verified: host.verified,
          resultSummary: rec.resultSummary,
          output,
        }),
      );
    },
  });
}

function buildTaskCancelTool(
  wctx: ToolingContext,
  _config: PluginConfig,
  opts: RegisterToolsOptions,
): ToolDefinition {
  return defineTool({
    name: 'task_cancel',
    description:
      '取消由本插件登记的后台子任务：interrupt 其原生 session 并验证宿主状态。只有 interrupt 成功且验证后不再 active、outcome 明确时才标记 cancelled。',
    input: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '任务 id' } },
      required: ['taskId'],
    },
    async execute(input, tctx) {
      const taskId = asString(input?.taskId);
      if (!taskId) return errorResult('taskId 必填');
      const coordinator = opts.coordinator;
      if (!coordinator) return errorResult('coordinator 未接线', 'UNSUPPORTED');
      const rec = await findTaskWithHostFallback(coordinator, taskId, tctx.sessionID);
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      if (!rec.taskID) return errorResult('task 没有关联的子 session，无法取消');
      try {
        const verification = await cancelChildSession(wctx.session, rec.taskID);
        // 只有 interrupt 成功且验证后不再 active、outcome 明确为 interrupted/succeeded
        // 时才标记 cancelled；否则不伪造，交给 reconcile 收敛。
        if (
          verification.interrupted === true &&
          verification.activeNow !== true &&
          verification.outcome === 'interrupted'
        ) {
          await coordinator.markTerminal(taskId, tctx.sessionID, 'cancelled');
          return contentResult({ taskId, status: 'cancelled', interrupted: true, outcome: verification.outcome });
        }
        if (verification.outcome === 'succeeded' || verification.outcome === 'failed') {
          await coordinator.markTerminal(
            taskId,
            tctx.sessionID,
            verification.outcome === 'succeeded' ? 'completed' : 'failed',
          );
          return contentResult({ taskId, status: verification.outcome === 'succeeded' ? 'completed' : 'failed', interrupted: verification.interrupted, outcome: verification.outcome });
        }
        return errorResult(
          `取消未确认: interrupt=${String(verification.interrupted)}` +
            `, outcome=${verification.outcome ?? 'unknown'}` +
            `, activeNow=${String(verification.activeNow)}；状态保持原样，等待 reconcile 收敛`,
        );
      } catch (e) {
        return errorResult(messageOf(e));
      }
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
  { name: 'task_message', build: (ctx, _config, opts) => opts.coordinator ? buildTaskMessageTool(opts.coordinator, ctx.session as any) : unsupported('task_message') },
  { name: 'task_revive', build: (ctx, _config, opts) => opts.coordinator ? buildTaskReviveTool(opts.coordinator, ctx.session) : unsupported('task_revive') },
  {
    name: 'clipboard_image',
    // 剪贴板图片 → 文件（阶段一原子能力）：无 coordinator 依赖，默认启用（isToolEnabled 缺省 true）。
    build: (ctx, _config, _opts) => buildClipboardImageTool(ctx),
  },
];

/** coordinator 未接线时的占位工具：结构化报错，不静默失效。 */
function unsupported(name: string): ToolDefinition {
  return defineTool({
    name,
    description: `${name} 未接线（coordinator 缺失），调用将返回 UNSUPPORTED。`,
    input: { type: 'object' },
    async execute() {
      return errorResult(`${name} 未接线：coordinator 缺失`, 'UNSUPPORTED');
    },
  });
}

/**
 * 直接工具集合（codemode: false → 进入会话直接工具目录）。
 *
 * 宿主 registry 语义：不设置 options 的注册工具缺省落入 Code Mode catalog，
 * 只能在 `execute` 的 JS 运行时内经 `tools.<name>` 调用；subagent（fixer 等）
 * 不会主动走该路径，prompt 引导会失效（实测复现：fixer 回退宿主原生 edit）。
 * 因此面向 subagent/orchestrator 的高频工具必须显式 `codemode: false`。
 *
 * CBM 工具（buildCbmTools，独立 draft.add 循环）保持缺省 Code Mode：
 * 15+ 查询型工具以 catalog 形式提供，避免撑大每个会话的直接工具目录。
 *
 * permission 说明：不设 options.permission，宿主以工具名作为 permission
 * action，与 config/constants.ts READONLY_DEFAULT_PERMISSION 的 key
 * （如 hashline_edit/ast_grep_replace = deny）对齐，只读 agent 的
 * 写入拒绝边界经宿主 permission 系统直接生效。
 */
const DIRECT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'ast_grep_search',
  'ast_grep_replace',
  'hashline_edit',
  'task_status',
  'task_result',
  'task_cancel',
  'task_message',
  'task_revive',
  'clipboard_image',
]);

/**
 * 通过 `ctx.tool.transform` 注册全部启用的新增工具。
 * 返回 host 的 transform Registration（Promise<unknown>）。
 */
export async function registerOceanusTools(
  ctx: ToolingContext,
  config: PluginConfig,
  opts: RegisterToolsOptions = {},
): Promise<unknown> {
  if (opts.coordinator) opts.taskLifecycleObserver?.(opts.coordinator);
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
        const tool = build(ctx, config, opts);
        // 直接工具（含 unsupported 占位）在注册层统一注入 codemode:false，
        // 覆盖任何子 builder 遗漏的 options（注入点集中在包装层，
        // 不要求 task/message.ts 等子 builder 感知）。
        const options = DIRECT_TOOL_NAMES.has(name)
          ? { ...tool.options, codemode: false as const }
          : tool.options;
        draft.add({ ...tool, ...(options !== undefined ? { options } : {}) });
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
