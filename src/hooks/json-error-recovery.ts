/**
 * JSON 参数错误识别与恢复提示（json-error-recovery）。
 *
 * 移植自 oh-my-opencode-slim 的 json-error-recovery hook，但按 Oceanus 原生 v2
 * `tool.execute.after` 的事件形状重写：hook 只接收单个 event 参数，结果文本位于
 * `event.result.content`（字符串或文本部分数组），错误文本位于 `event.error.message`。
 * 不再复制 v1 的 `(input, output)` 双参数形状，也不在此模块内实现注册（注册交由
 * Wave 2 的 v2 Tool/Hook wiring 负责）。
 *
 * 该模块是纯逻辑，可独立测试：识别排除工具、JSON 错误模式、重复 marker（幂等）、
 * 非字符串结果，以及可配置的启用开关。
 */

/** 默认排除在 JSON 错误检查之外的工具（与 slim 保持一致，命中即跳过）。 */
export const JSON_ERROR_TOOL_EXCLUDE_LIST = [
  'bash',
  'read',
  'glob',
  'webfetch',
  'gh_grep_searchgithub',
] as const;

/** JSON 错误模式集合（移植自 slim，用于匹配工具结果/错误中的 JSON 语法错误）。 */
export const JSON_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /json parse error/i,
  /failed to parse json/i,
  /invalid json/i,
  /malformed json/i,
  /unexpected end of json input/i,
  /syntaxerror:\s*unexpected token.*json/i,
  /json[^\n]*expected '\}'/i,
  /json[^\n]*unexpected eof/i,
];

/** 恢复提示的幂等 marker：若目标文本已包含该 marker，则不再重复注入。 */
export const JSON_ERROR_REMINDER_MARKER =
  '[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]';

/** 标准化恢复提示模板（移植自 slim）。 */
export const JSON_ERROR_REMINDER = `
[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]

You sent invalid JSON arguments. The system could not parse your tool call.
STOP and do this NOW:

1. LOOK at the error message above to see what was expected vs what you sent.
2. CORRECT your JSON syntax (missing braces, unescaped quotes, trailing commas, etc).
3. RETRY the tool call with valid JSON.

DO NOT repeat the exact same invalid call.
`;

/** 可配置参数：enabled 全局开关、excludeTools 额外排除工具。 */
export interface JsonErrorRecoveryOptions {
  /** 全局开关；未配置或 undefined 时默认启用。设为 false 时完全不生效。 */
  readonly enabled?: boolean;
  /** 额外排除的工具名（大小写不敏感），与默认排除列表合并。 */
  readonly excludeTools?: ReadonlyArray<string>;
}

/** 文本内容部分（与 v2 Tool.Result.Content 的 text 分支结构一致的最小契约）。 */
export interface TextContentPart {
  readonly type: 'text';
  readonly text: string;
}

/** 结果内容：单个字符串或文本部分数组（v2 的非字符串结果形态）。 */
export type ResultContent = string | ReadonlyArray<TextContentPart>;

/**
 * v2 `tool.execute.after` 事件的最小结构契约。
 * 生产代码中该事件由 @opencode-ai/plugin 提供，这里仅镜像运行时可观察的字段，
 * 使模块可以在不依赖 plugin 内部导出路径的前提下被纯单元测试覆盖。
 */
export interface ExecuteAfterEvent {
  readonly tool: string;
  readonly status: 'completed' | 'error';
  readonly result?: {
    readonly content?: ResultContent;
    readonly output?: unknown;
    readonly metadata?: unknown;
  };
  readonly error?: {
    readonly message?: string;
    readonly error?: unknown;
  };
}

/** 恢复动作：命中 JSON 错误时的改写结果。 */
export interface JsonErrorRecoveryAction {
  /** 幂等 marker。 */
  readonly marker: string;
  /** 待追加的恢复提示。 */
  readonly reminder: string;
}

/** 判定工具是否应被排除（大小写不敏感，支持选项内额外排除）。 */
export function isExcludedTool(
  tool: string,
  options?: JsonErrorRecoveryOptions,
): boolean {
  const excluded = new Set<string>([
    ...JSON_ERROR_TOOL_EXCLUDE_LIST,
    ...(options?.excludeTools ?? []),
  ]);
  return excluded.has(tool.toLowerCase());
}

/** 从事件中提取用于匹配的候选文本；无法得到字符串（如非文本结果）时返回 null。 */
export function extractCandidateText(event: ExecuteAfterEvent): string | null {
  if (event.status === 'error') {
    return typeof event.error?.message === 'string' ? event.error.message : null;
  }
  const content = event.result?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter((part): part is TextContentPart => typeof part?.text === 'string')
      .map((part) => part.text);
    return texts.length > 0 ? texts.join('\n') : null;
  }
  // content 缺失时回退到字符串 output；结构化（非字符串）output 视为无法匹配。
  return typeof event.result?.output === 'string' ? event.result.output : null;
}

/** 文本是否命中任一 JSON 错误模式。 */
export function matchesJsonError(text: string): boolean {
  return JSON_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/** 在现有内容末尾追加恢复提示，返回改写后的内容（用于 v2 result 改写）。 */
export function appendReminder(content: string, reminder: string): string;
export function appendReminder(
  content: ReadonlyArray<TextContentPart>,
  reminder: string,
): ReadonlyArray<TextContentPart>;
export function appendReminder(
  content: ResultContent,
  reminder: string,
): ResultContent;
export function appendReminder(
  content: ResultContent,
  reminder: string,
): ResultContent {
  if (typeof content === 'string') {
    if (content.length === 0) {
      return reminder;
    }
    return content.endsWith('\n') ? content + reminder : `${content}\n${reminder}`;
  }
  if (Array.isArray(content)) {
    return [...content, { type: 'text', text: reminder }];
  }
  return content;
}

/**
 * 主入口：对 v2 `execute.after` 事件执行 JSON 错误恢复。
 *
 * 返回改写的克隆事件（completed 改写 `result.content`，error 改写 `error.message`），
 * 未命中（排除工具、全局禁用、非字符串结果、marker 已存在、无匹配）时返回 null。
 * 不修改原始事件对象。
 */
export function applyJsonErrorRecovery(
  event: ExecuteAfterEvent,
  options?: JsonErrorRecoveryOptions,
): ExecuteAfterEvent | null {
  if (options?.enabled === false) {
    return null;
  }
  if (isExcludedTool(event.tool, options)) {
    return null;
  }

  const text = extractCandidateText(event);
  if (text === null) {
    return null;
  }
  // marker 幂等：目标文本已包含恢复提示，避免重复注入。
  if (text.includes(JSON_ERROR_REMINDER_MARKER)) {
    return null;
  }
  if (!matchesJsonError(text)) {
    return null;
  }

  const action: JsonErrorRecoveryAction = {
    marker: JSON_ERROR_REMINDER_MARKER,
    reminder: JSON_ERROR_REMINDER,
  };

  if (event.status === 'error') {
    const message = event.error?.message ?? '';
    return {
      ...event,
      error: { ...event.error, message: appendReminder(message, action.reminder) },
    };
  }

  const content: ResultContent = event.result?.content ?? '';
  return {
    ...event,
    result: {
      ...event.result,
      content: appendReminder(content, action.reminder),
    },
  };
}
