import { describe, expect, test } from 'bun:test';
import {
  TRUNCATION_MARKER_PREFIX,
  createToolOutputTruncator,
  isAlreadyTruncated,
  truncateToolResult,
  type ToolContent,
  type ToolResult,
  type ToolTextContent,
  type ToolOutputExecuteAfterCompletedEvent,
  type ToolOutputExecuteAfterErrorEvent,
} from './tool-output-truncator';

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

/** 拼接一段带控制信息头部与尾部的大文本，用于验证控制信息保留。 */
function bigText(
  header = 'status: running\ntask: tk_ab12\nhash mismatch on path: a.txt\n',
  body = 'x',
  bodyLen = 50_000,
  footer = '\nTAIL_STATUS: done',
): string {
  return header + body.repeat(bodyLen) + footer;
}

/** 构造一个 completed after 事件。 */
function completed(
  tool: string,
  result: ToolResult,
): ToolOutputExecuteAfterCompletedEvent {
  return { tool, status: 'completed', result };
}

/** 构造一个 error after 事件。 */
function errorEvent(
  tool: string,
  error: unknown,
): ToolOutputExecuteAfterErrorEvent {
  return { tool, status: 'error', error };
}

describe('tool-output-truncator 纯函数', () => {
  test('超过默认限制的文本 content 被截断并保留头部控制信息', () => {
    const text = bigText();
    const { result, truncated, limit } = truncateToolResult(
      'read',
      { content: text },
      { defaultMaxBytes: 1000 },
    );
    expect(truncated).toBe(true);
    expect(limit).toBe(1000);
    const out = result.content as string;
    expect(bytes(out)).toBeLessThanOrEqual(1000);
    // 控制信息（status / task id / hash mismatch）位于头部，必须保留。
    expect(out).toContain('status: running');
    expect(out).toContain('tk_ab12');
    expect(out).toContain('hash mismatch');
    expect(out).toContain(TRUNCATION_MARKER_PREFIX);
  });

  test('默认保留尾部，末尾状态/控制信息不被截掉', () => {
    const text = bigText('', 'm', 20_000, '\nTAIL_STATUS: hash mismatch');
    const { result, truncated } = truncateToolResult(
      'shell',
      { content: text },
      { defaultMaxBytes: 200 },
    );
    expect(truncated).toBe(true);
    const out = result.content as string;
    expect(bytes(out)).toBeLessThanOrEqual(200);
    // 尾部控制信息必须保留。
    expect(out).toContain('hash mismatch');
  });

  test('工具级 perToolMaxBytes 覆盖默认限制', () => {
    const text = 'z'.repeat(5000);
    const { result, truncated, limit } = truncateToolResult(
      'ast_grep_search',
      { content: text },
      {
        defaultMaxBytes: 100,
        perToolMaxBytes: { ast_grep_search: 2000 },
      },
    );
    expect(truncated).toBe(true);
    expect(limit).toBe(2000);
    const out = result.content as string;
    expect(bytes(out)).toBeLessThanOrEqual(2000);
    // 证明用的是工具级限制（远大于默认 100），而非默认值。
    expect(bytes(out)).toBeGreaterThan(100);
  });

  test('未配置工具级的工具使用默认限制', () => {
    const text = 'z'.repeat(5000);
    const { limit } = truncateToolResult(
      'read',
      { content: text },
      {
        defaultMaxBytes: 100,
        perToolMaxBytes: { ast_grep_search: 2000 },
      },
    );
    expect(limit).toBe(100);
  });

  test('截断 marker 幂等：已截断结果再次截断不改变、不重复标记', () => {
    const text = bigText();
    const once = truncateToolResult('read', { content: text }, { defaultMaxBytes: 1000 });
    expect(once.truncated).toBe(true);
    const out = once.result.content as string;
    // 只出现一次 marker。
    expect(out.split(TRUNCATION_MARKER_PREFIX)).toHaveLength(2);

    const twice = truncateToolResult('read', once.result, { defaultMaxBytes: 1000 });
    expect(twice.truncated).toBe(false);
    expect(twice.result).toBe(once.result);
  });

  test('isAlreadyTruncated 检测已截断文本', () => {
    expect(isAlreadyTruncated('plain text')).toBe(false);
    expect(
      isAlreadyTruncated(`head\n${TRUNCATION_MARKER_PREFIX}: truncated 9 bytes\ntail`),
    ).toBe(true);
  });

  test('error / status 分支：截断 Hook 保留错误消息，不做截断', () => {
    const message = 'exit code 2: ' + 'e'.repeat(9000);
    const event = errorEvent('shell', { message });
    const hook = createToolOutputTruncator({ defaultMaxBytes: 100 });
    hook(event);
    // 错误/状态信息必须原样保留。
    expect(event.status).toBe('error');
    expect((event.error as { message: string }).message).toBe(message);
  });

  test('非文本 result（file content）安全透传，不做截断', () => {
    const result: ToolResult = {
      content: [{ type: 'file', uri: 'file:///a/b.txt', mime: 'text/plain' }],
    };
    const { result: out, truncated } = truncateToolResult(
      'read',
      result,
      { defaultMaxBytes: 10 },
    );
    expect(truncated).toBe(false);
    expect(out).toBe(result);
  });

  test('结构化 output / 无 content 的 result 安全透传', () => {
    const structured: ToolResult = { output: { list: ['x'.repeat(500)] } };
    const r1 = truncateToolResult('webfetch', structured, { defaultMaxBytes: 10 });
    expect(r1.truncated).toBe(false);
    expect(r1.result).toBe(structured);

    const empty: ToolResult = {};
    const r2 = truncateToolResult('read', empty, { defaultMaxBytes: 10 });
    expect(r2.truncated).toBe(false);
    expect(r2.result).toBe(empty);
  });

  test('低于限制的小文本不做截断', () => {
    const small = 'ok';
    const { result, truncated } = truncateToolResult(
      'read',
      { content: small },
      { defaultMaxBytes: 100 },
    );
    expect(truncated).toBe(false);
    expect(result.content).toBe(small);
  });

  test('限制 <=0 时不做截断', () => {
    const { truncated } = truncateToolResult(
      'read',
      { content: bigText() },
      { defaultMaxBytes: 0 },
    );
    expect(truncated).toBe(false);
  });

  test('多文本块：只截断超限块，未超限文本块与 file 块透传', () => {
    const content: ToolContent[] = [
      { type: 'text', text: 'a'.repeat(50) },
      { type: 'text', text: 'b'.repeat(5000) },
      { type: 'file', uri: 'file:///x', mime: 'text/plain' },
    ];
    const { result, truncated } = truncateToolResult(
      'read',
      { content },
      { defaultMaxBytes: 100 },
    );
    expect(truncated).toBe(true);
    const out = result.content as ToolContent[];
    // 未超限文本块完整保留。
    expect((out[0] as ToolTextContent).text).toBe('a'.repeat(50));
    // 超限文本块被截断并带 marker。
    const second = out[1] as ToolTextContent;
    expect(bytes(second.text)).toBeLessThanOrEqual(100);
    expect(second.text).toContain(TRUNCATION_MARKER_PREFIX);
    // file 块透传（不改变引用）。
    expect(out[2]).toBe(content[2]);
  });

  test('UTF-8 多字节边界不被截断（不产生替换字符）', () => {
    const text = '汉'.repeat(1000); // 每个 3 字节，共 3000 字节
    const { result, truncated } = truncateToolResult(
      'read',
      { content: text },
      { defaultMaxBytes: 50 },
    );
    expect(truncated).toBe(true);
    const out = result.content as string;
    expect(bytes(out)).toBeLessThanOrEqual(50);
    // 不能把某个中文字符截成半个字节，重新编码不得出现 U+FFFD。
    expect(out.includes('\uFFFD')).toBe(false);
  });

  test('自定义 head/tail 字节数生效', () => {
    const text = 'A'.repeat(100) + 'B'.repeat(100) + 'C'.repeat(100);
    const { result } = truncateToolResult(
      'read',
      { content: text },
      { defaultMaxBytes: 80 },
      { headBytes: 10, tailBytes: 10 },
    );
    const out = result.content as string;
    expect(bytes(out)).toBeLessThanOrEqual(80);
    // 头部保留前 10 字节（全 A），尾部保留最后 10 字节（全 C）。
    expect(out.startsWith('A'.repeat(10))).toBe(true);
    expect(out.endsWith('C'.repeat(10))).toBe(true);
  });
});

describe('tool-output-truncator Hook（execute.after）', () => {
  test('completed 事件直接改写 result.content', () => {
    const event = completed('shell', { content: bigText() });
    const hook = createToolOutputTruncator({ defaultMaxBytes: 300 });
    hook(event);
    const out = event.result.content as string;
    expect(bytes(out)).toBeLessThanOrEqual(300);
    expect(out).toContain(TRUNCATION_MARKER_PREFIX);
  });

  test('未超限的 completed 事件不改写 result（保持原引用）', () => {
    const result: ToolResult = { content: 'small' };
    const event = completed('read', result);
    const hook = createToolOutputTruncator({ defaultMaxBytes: 1000 });
    hook(event);
    expect(event.result).toBe(result);
  });

  test('error 事件绝不截断（保留 error 原文）', () => {
    const message = 'boom ' + '!'.repeat(5000);
    const event = errorEvent('read', { message });
    const hook = createToolOutputTruncator({ defaultMaxBytes: 10 });
    hook(event);
    expect((event.error as { message: string }).message).toBe(message);
  });
});
