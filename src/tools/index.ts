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
import { runSg } from './ast-grep/cli';
import { CLI_LANGUAGES, type CliLanguage, type ReplaceOptions, type SearchOptions } from './ast-grep/types';
import { isPathWithinRoot } from './ast-grep/args';
import {
  applyHashlineEditToFile,
  DEFAULT_BOUNDARY_LIMITS,
  type RawHashlineEdit,
} from './hashline-edit';
import { TaskRegistry } from './task/registry';
import { isTerminalStatus, type TaskRecord } from './task/types';
import { isToolEnabled, getToolConfig } from '../config/utils';
import type { PluginConfig } from '../config/schema';
import { resolveWorkspaceRoot } from '../runtime/workspace';
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
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function contentResult(obj: unknown): ToolResult {
  return { content: JSON.stringify(obj, null, 2) };
}
function errorResult(message: string): ToolResult {
  return { content: JSON.stringify({ error: message }, null, 2) };
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
      properties: {
        filePath: { type: 'string', description: '目标文件路径（相对于工作区或绝对路径）' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
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
        maxFileBytes: { type: 'number' },
      },
      required: ['filePath', 'edits'],
    },
    async execute(input, tctx) {
      const filePath = asString(input?.filePath);
      if (!filePath) return errorResult('filePath 必填');
      const edits = input?.edits;
      if (!Array.isArray(edits) || edits.length === 0) {
        return errorResult('edits 必须是非空数组');
      }
      const root = await resolveWorkspaceRoot(wctx.session, tctx.sessionID);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');

      const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(root, filePath);
      if (!isPathWithinRoot(resolved, root)) {
        return errorResult(`路径位于工作区之外，已拒绝: ${filePath}`);
      }

      const cfg = getToolConfig(config, 'hashline_edit');
      const limits = {
        maxFileBytes: asNumber(input?.maxFileBytes) ?? cfg?.maxFileBytes ?? DEFAULT_BOUNDARY_LIMITS.maxFileBytes,
      };
      const result = await applyHashlineEditToFile(resolved, edits as RawHashlineEdit[], { limits });
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
        return errorResult(messageOf(e));
      }
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      const host = await resolveTaskHostStatus(wctx.session, rec);
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
        return errorResult(messageOf(e));
      }
      if (!rec) return errorResult(`task 不存在: ${taskId}`);
      const host = await resolveTaskHostStatus(wctx.session, rec);
      // task_result 只接受"经宿主验证的终态"或"registry 中明确存储的终态观察结果"。
      // 不能把 registry 的 completed 状态本身当作宿主事实。
      const hostTerminal =
        host.verified && (host.status === 'completed' || host.status === 'failed');
      const storedTerminal =
        Boolean(rec.observation) &&
        Boolean(rec.observation?.status) &&
        isTerminalStatus(rec.observation!.status!);
      if (!hostTerminal && !storedTerminal) {
        return errorResult(
          `task ${taskId} 尚未完成（当前: ${host.status}）。task_result 只读经宿主验证或已明确观察到的终态任务。`,
        );
      }
      const outcome = await readSessionOutcome(wctx.session, rec.childSessionId);
      return contentResult(
        taskRecordView(rec, {
          status: storedTerminal ? rec.observation!.status! : host.status,
          outcome,
          source: hostTerminal ? host.source : 'registry',
          verified: host.verified,
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
  const log = opts.logger ?? (() => {});
  const enabled = TOOL_BUILDERS.filter(({ name }) => isToolEnabled(config, name));
  return ctx.tool.transform((draft) => {
    for (const { name, build } of enabled) {
      try {
        draft.add(build(ctx, config, opts));
      } catch (e) {
        log(`[oceanus] 注册工具失败: ${name}`, { error: messageOf(e) });
      }
    }
  });
}
