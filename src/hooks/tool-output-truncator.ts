/**
 * Tool output truncator（工具输出截断）。
 *
 * 在工具返回超大文本时把输出限制在固定字节上限内，避免超大结果撑爆模型上下文。
 * 参考 oh-my-openagent 的动态 truncator 设计，但首期不引入模型 token 依赖：
 * 采用「固定字节上限 + 头/尾保留」的静态策略，不查询模型/不估算 token。
 *
 * 行为与安全边界：
 * - 工具级限制（perToolMaxBytes）覆盖默认限制（defaultMaxBytes）。
 * - 只截断文本（text content 与字符串 output）：控制信息（status / task
 *   id / diff / hash mismatch）常出现在头部，因此默认保留约 80% 头部 +
 *   20% 尾部，保证开头与结尾的控制标记不被截掉。
 * - 截断 marker 幂等：已含 marker 的文本不再重复截断，避免叠标记。
 * - 字符串 result.output（如 hashline enhancer 写入的宿主输出）与
 *   content 使用同一限制与 marker 语义；结构化 output 保持原样透传。
 * - 非文本 result（file content、结构化 output、无文本）安全透传，绝不改动。
 * - error / status 分支由 Hook 层跳过，错误消息原样保留，绝不被截断。
 * - 只提供纯逻辑 + Hook 处理器，不做注册；适配 v2 的 execute.after 事件形状
 *   （@opencode-ai/plugin 的 ToolHooks["execute.after"]）。
 */

/** 截断 marker 前缀，用于幂等检测与模型侧识别。 */
export const TRUNCATION_MARKER_PREFIX = '[oceanus:tool-output-truncated]';

/** 极限小上限（小于此长度时无法同时容纳 marker 与内容）时使用的紧凑 marker。 */
const MIN_MARKER = `\n[${TRUNCATION_MARKER_PREFIX}]\n`;

/** OpenCode v2 `Tool.Content`（text 分支）的结构化镜像，避免在纯逻辑中依赖 effect schema。 */
export interface ToolTextContent {
  readonly type: 'text';
  readonly text: string;
}

/** OpenCode v2 `Tool.Content`（file 分支）的结构化镜像。 */
export interface ToolFileContent {
  readonly type: 'file';
  readonly uri: string;
  readonly mime: string;
  readonly name?: string;
}

export type ToolContent = ToolTextContent | ToolFileContent;

/** OpenCode v2 `Tool.Result` 的结构化镜像。 */
export interface ToolResult {
  readonly output?: unknown;
  readonly content?: string | ReadonlyArray<ToolContent>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** 截断限制：默认上限 + 工具级覆盖。 */
export interface ToolOutputTruncatorLimits {
  /** 默认每个文本块的最大字节数（UTF-8）。 */
  readonly defaultMaxBytes: number;
  /** 按工具名覆盖（字节）。 */
  readonly perToolMaxBytes?: Readonly<Record<string, number>>;
}

/** 头/尾保留字节数。未指定时按 limit 的 80% / 20% 分配。 */
export interface ToolOutputTruncatorOptions {
  readonly headBytes?: number;
  readonly tailBytes?: number;
}

/** truncateToolResult 的返回结构。 */
export interface TruncateToolResultOutput {
  /** 截断后的 result；未截断时返回原引用。 */
  readonly result: ToolResult;
  /** 本次调用是否发生了截断。 */
  readonly truncated: boolean;
  /** 本次调用生效的限制（工具级或默认）。 */
  readonly limit: number;
}

const utf8Length = (text: string): number => Buffer.byteLength(text, 'utf8');

/** 取文本头部 n 字节，不截断多字节字符。 */
function headUtf8(text: string, n: number): string {
  if (n <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= n) return text;
  let end = n;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // 回退到字符边界
  return buf.subarray(0, end).toString('utf8');
}

/** 取文本尾部 n 字节，不截断多字节字符。 */
function tailUtf8(text: string, n: number): string {
  if (n <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= n) return text;
  let start = buf.length - n;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString('utf8');
}

/** 构造带截断字节数的 marker。 */
function buildMarker(truncatedBytes: number): string {
  return `\n[${TRUNCATION_MARKER_PREFIX}: truncated ${truncatedBytes} bytes]\n`;
}

/** 判断文本是否已被截断（含 marker）。 */
export function isAlreadyTruncated(text: string): boolean {
  return text.includes(TRUNCATION_MARKER_PREFIX);
}

/** 解析某工具生效的限制。 */
function resolveLimit(tool: string, limits: ToolOutputTruncatorLimits): number {
  // 别名：hashline 策略下锚定编辑工具以内置名 `edit` 注册，配置 key 仍是
  // hashline_edit——按别名回查，保证 perToolMaxBytes 配置继续生效。
  const per = limits.perToolMaxBytes?.[tool] ?? (tool === 'edit' ? limits.perToolMaxBytes?.['hashline_edit'] : undefined);
  if (typeof per === 'number' && per > 0) return per;
  return limits.defaultMaxBytes;
}

/**
 * 截断单个文本块到指定 limit，返回新文本与是否发生截断。
 * marker 幂等：若文本已含 marker，则保持原样、truncated=false。
 */
function truncateTextBlock(
  text: string,
  limit: number,
  opts: ToolOutputTruncatorOptions | undefined,
): { text: string; truncated: boolean } {
  const originalBytes = utf8Length(text);
  if (originalBytes <= limit || isAlreadyTruncated(text)) {
    return { text, truncated: false };
  }

  // 预留 marker 空间：用「原始字节数」的位数估算，保证最终总量不超限。
  const fullReserve = utf8Length(buildMarker(originalBytes));
  let marker = buildMarker(originalBytes);
  let budget = limit - fullReserve;
  if (budget < 0) {
    // 上限太小放不下带计数的 marker，退化为紧凑 marker。
    marker = MIN_MARKER;
    budget = Math.max(0, limit - utf8Length(MIN_MARKER));
  }

  const head = Math.min(opts?.headBytes ?? Math.floor(budget * 0.8), budget);
  const tail = Math.min(opts?.tailBytes ?? Math.floor(budget * 0.2), budget - head);
  const kept = head + tail;

  if (marker !== MIN_MARKER) {
    // 用真实截断字节数重建（位数 ≤ 原始字节数，不会突破预留空间）。
    marker = buildMarker(originalBytes - kept);
  }

  const headPart = headUtf8(text, head);
  const tailPart = tailUtf8(text, tail);
  return { text: `${headPart}${marker}${tailPart}`, truncated: true };
}

/** 判断内容块是否为文本块。 */
function isTextContent(block: ToolContent): block is ToolTextContent {
  return (
    typeof block === 'object' &&
    block !== null &&
    block.type === 'text' &&
    typeof (block as ToolTextContent).text === 'string'
  );
}

/** truncateToolResult 内部用于记录需要覆写的 result 字段。 */
type ResultPatch = {
  readonly output?: string;
  readonly content?: string | ReadonlyArray<ToolContent>;
};

/**
 * 对工具结果做输出截断（纯函数）。
 * - 字符串 output（hashline 化的宿主输出）按同一限制截断；结构化 output
 *   （非字符串）保持原样。
 * - content 为字符串或文本块数组时才可能截断；file 块、结构化 output 与
 *   无文本的 result 一律安全透传（返回原引用）。
 * - 返回新 result（仅在发生截断时新建对象），绝不原地修改入参。
 */
export function truncateToolResult(
  tool: string,
  result: ToolResult,
  limits: ToolOutputTruncatorLimits,
  opts?: ToolOutputTruncatorOptions,
): TruncateToolResultOutput {
  const limit = resolveLimit(tool, limits);
  if (limit <= 0) return { result, truncated: false, limit };

  let patch: ResultPatch | undefined;

  // 字符串 output 分支：与 content 共用同一 limit 与 marker 语义；
  // 结构化（非字符串）output 不进入此分支，保持原样透传。
  if (typeof result.output === 'string') {
    const out = truncateTextBlock(result.output, limit, opts);
    if (out.truncated) patch = { ...patch, output: out.text };
  }

  const content = result.content;
  if (typeof content === 'string') {
    const out = truncateTextBlock(content, limit, opts);
    if (out.truncated) patch = { ...patch, content: out.text };
  } else if (Array.isArray(content)) {
    let changed = false;
    const next = content.map((block) => {
      if (!isTextContent(block)) return block; // file / 未知形状：透传
      const out = truncateTextBlock(block.text, limit, opts);
      if (out.truncated) changed = true;
      return out.truncated ? { ...block, text: out.text } : block;
    });
    if (changed) patch = { ...patch, content: next };
  }

  // 其它非文本形状：安全透传。
  if (!patch) return { result, truncated: false, limit };
  return { result: { ...result, ...patch }, truncated: true, limit };
}

/** v2 execute.after 事件（completed 分支）的结构化镜像。result 可变，Hook 就地改写。 */
export interface ToolOutputExecuteAfterCompletedEvent {
  readonly tool: string;
  readonly status: 'completed';
  result: ToolResult;
}

/** v2 execute.after 事件（error 分支）的结构化镜像。 */
export interface ToolOutputExecuteAfterErrorEvent {
  readonly tool: string;
  readonly status: 'error';
  readonly error: unknown;
}

export type ToolOutputExecuteAfterEvent =
  | ToolOutputExecuteAfterCompletedEvent
  | ToolOutputExecuteAfterErrorEvent;

/** execute.after 截断 Hook：就地改写 completed 事件的 result。 */
export type ToolOutputTruncateHook = (event: ToolOutputExecuteAfterEvent) => void;

/**
 * 创建 execute.after 截断 Hook 处理器。
 * - error / 非 completed 分支直接返回：错误与状态信息绝不截断。
 * - completed 分支就地改写 event.result（由纯函数返回新对象）。
 * - 处理器为同步、fail-open：截断逻辑失败不应阻断宿主工具结果。
 */
export function createToolOutputTruncator(
  limits: ToolOutputTruncatorLimits,
  opts?: ToolOutputTruncatorOptions,
): ToolOutputTruncateHook {
  return (event: ToolOutputExecuteAfterEvent): void => {
    if (event.status !== 'completed' || !event.result) return;
    const { result, truncated } = truncateToolResult(
      event.tool,
      event.result,
      limits,
      opts,
    );
    if (truncated) event.result = result;
  };
}
