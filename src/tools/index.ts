/**
 * Oceanus 新增工具的 v2 注册（tooling-9-v2-wiring）。
 *
 * 通过 `ctx.tool.transform` 注册 ast_grep_search / ast_grep_replace / clipboard_image /
 * CBM 兑底工具，并按配置过滤（默认全部启用）。
 * - 文件编辑使用宿主原生 edit / write / apply_patch（原生 diff 渲染与模型心智）；
 *   hashline 锚定通道已于 0.43.0 移除。
 * - 不引入 v1 client shim；错误一律以结构化 result 返回，不抛异常。
 */
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { runSg } from './ast-grep/cli';
import { CLI_LANGUAGES, type CliLanguage, type ReplaceOptions, type SearchOptions } from './ast-grep/types';
import { isPathWithinRoot } from './ast-grep/args';
import { buildClipboardImageTool } from './clipboard-image';
import { buildCbmTools } from './cbm';
import type { IndexerHandle, IndexerRunCli } from '../cbm/indexer';
import type { CbmRunDeps } from './cbm/types';
import { isToolEnabled, getToolConfig } from '../config/utils';
import type { PluginConfig } from '../config/schema';
import { resolveWorkspaceRoot } from '../runtime/workspace';
import type { ToolContextLike, ToolDefinition, ToolResult, ToolingContext } from '../runtime/types';

/** 注册期可选依赖（测试注入）。 */
export interface RegisterToolsOptions {
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  /** CBM 注入（测试）：替代 runCbmCli 的 CLI 执行函数。 */
  cbmRunCli?: IndexerRunCli;
  /** CBM 注入（测试）：CLI 执行依赖（spawn / resolveBinary / ensureInstalled）。 */
  cbmRunDeps?: CbmRunDeps;
  /** CBM 注入（测试）：自定义索引器。 */
  cbmIndexer?: IndexerHandle;
  /** CBM 共享缓存根目录。 */
  cbmCacheRoot?: string;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function contentResult(obj: unknown): ToolResult {
  return { content: JSON.stringify(obj, null, 2) };
}
function errorResult(message: string, errorCode = 'INVALID_INPUT'): ToolResult {
  return { content: JSON.stringify({ error: message, errorCode }, null, 2) };
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
  /** 可选 output schema（JSON Schema）。execute 返回值携带 `output` 字段时必须声明，否则宿主报 "Tool result declared output without an output schema"。 */
  output?: unknown;
  /** 可选 Tool.Options（permission 等）；注册层会按 DIRECT_TOOL_NAMES 合并 codemode:false。 */
  options?: ToolDefinition['options'];
  execute(input: any, context: ToolContextLike): Promise<ToolResult>;
}): ToolDefinition {
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    ...(def.output !== undefined ? { output: def.output } : {}),
    ...(def.options !== undefined ? { options: def.options } : {}),
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



// ─────────────────────────── 注册入口 ───────────────────────────

const TOOL_BUILDERS: ReadonlyArray<{
  name: string;
  build(ctx: ToolingContext, config: PluginConfig, opts: RegisterToolsOptions): ToolDefinition;
}> = [
  { name: 'ast_grep_search', build: buildSearchTool },
  { name: 'ast_grep_replace', build: buildReplaceTool },
  {
    name: 'clipboard_image',
    // 剪贴板图片 → 文件（阶段一原子能力）：无 coordinator 依赖，默认启用（isToolEnabled 缺省 true）。
    build: (ctx, _config, _opts) => buildClipboardImageTool(ctx),
  },
];


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
 * （如 ast_grep_replace = deny）对齐，只读 agent 的
 * 写入拒绝边界经宿主 permission 系统直接生效。
 */
const DIRECT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'ast_grep_search',
  'ast_grep_replace',
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
