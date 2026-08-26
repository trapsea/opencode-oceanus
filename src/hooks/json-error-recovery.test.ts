import { describe, expect, test } from 'bun:test';
import {
  JSON_ERROR_PATTERNS,
  JSON_ERROR_REMINDER,
  JSON_ERROR_REMINDER_MARKER,
  JSON_ERROR_TOOL_EXCLUDE_LIST,
  applyJsonErrorRecovery,
  appendReminder,
  extractCandidateText,
  isExcludedTool,
  matchesJsonError,
  type ExecuteAfterEvent,
  type TextContentPart,
} from './json-error-recovery';

function completedEvent(
  tool: string,
  content: unknown,
): ExecuteAfterEvent {
  return {
    tool,
    status: 'completed',
    result: { content: content as never },
  };
}

function errorEvent(tool: string, message: string): ExecuteAfterEvent {
  return { tool, status: 'error', error: { message } };
}

describe('JSON 错误模式', () => {
  test('每个模式都能命中匹配的文本', () => {
    const samples = [
      'json parse error: unexpected token',
      'failed to parse json arguments',
      'invalid json in tool arguments',
      'malformed json detected',
      'unexpected end of json input',
      'SyntaxError: Unexpected token } in JSON',
      "json error: expected '}' but got ']'",
      'json: unexpected EOF',
    ];
    expect(samples.length).toBe(JSON_ERROR_PATTERNS.length);
    for (const sample of samples) {
      expect(matchesJsonError(sample), sample).toBe(true);
    }
  });

  test('不命中普通文本', () => {
    expect(matchesJsonError('all good, nothing weird here')).toBe(false);
    expect(matchesJsonError('')).toBe(false);
  });

  test('大小写不敏感', () => {
    expect(matchesJsonError('JSON PARSE ERROR')).toBe(true);
    expect(matchesJsonError('Invalid Json')).toBe(true);
  });
});

describe('排除工具', () => {
  test('默认排除列表中的所有工具都命中 isExcludedTool', () => {
    for (const tool of JSON_ERROR_TOOL_EXCLUDE_LIST) {
      expect(isExcludedTool(tool)).toBe(true);
    }
  });

  test('大小写不敏感匹配排除工具', () => {
    expect(isExcludedTool('Bash')).toBe(true);
    expect(isExcludedTool('READ')).toBe(true);
  });

  test('排除工具即使命中 JSON 错误也不改写（不产生误报）', () => {
    for (const tool of JSON_ERROR_TOOL_EXCLUDE_LIST) {
      const result = applyJsonErrorRecovery(
        completedEvent(tool, 'json parse error: something failed'),
      );
      expect(result, tool).toBeNull();
    }
  });

  test('可通过选项额外排除工具', () => {
    expect(isExcludedTool('edit', { excludeTools: ['edit'] })).toBe(true);
    expect(
      applyJsonErrorRecovery(completedEvent('edit', 'json parse error'), {
        excludeTools: ['edit'],
      }),
    ).toBeNull();
  });

  test('未在排除列表中的工具照常处理', () => {
    expect(
      applyJsonErrorRecovery(completedEvent('write', 'json parse error')),
    ).not.toBeNull();
  });
});

describe('marker 幂等', () => {
  test('结果已包含 marker 时不再重复注入', () => {
    const event = completedEvent(
      'write',
      `some output\n${JSON_ERROR_REMINDER_MARKER}`,
    );
    expect(applyJsonErrorRecovery(event)).toBeNull();
  });

  test('数组内容中已注入恢复提示的部分也会命中 marker', () => {
    const parts: TextContentPart[] = [
      { type: 'text', text: 'json parse error' },
      { type: 'text', text: JSON_ERROR_REMINDER },
    ];
    const event = completedEvent('write', parts);
    expect(applyJsonErrorRecovery(event)).toBeNull();
  });

  test('错误信息已包含 marker 时不再重复注入', () => {
    const event = errorEvent('write', `json parse error\n${JSON_ERROR_REMINDER_MARKER}`);
    expect(applyJsonErrorRecovery(event)).toBeNull();
  });
});

describe('非字符串结果', () => {
  test('字符串内容命中 JSON 错误时改写', () => {
    const event = completedEvent('write', 'json parse error');
    const result = applyJsonErrorRecovery(event);
    expect(result).not.toBeNull();
    expect(result?.result?.content).toBe(`json parse error\n${JSON_ERROR_REMINDER}`);
  });

  test('文本部分数组命中时追加一个 text 部分', () => {
    const event = completedEvent('write', [
      { type: 'text', text: 'json parse error' },
    ]);
    const result = applyJsonErrorRecovery(event);
    const content = result?.result?.content as TextContentPart[];
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[1]).toEqual({ type: 'text', text: JSON_ERROR_REMINDER });
  });

  test('仅含非文本部分的内容安全跳过，不崩溃', () => {
    const event = completedEvent('write', [
      { type: 'text', text: 'no json issue' },
    ] as TextContentPart[]);
    expect(applyJsonErrorRecovery(event)).toBeNull();
  });

  test('content 缺失且 output 为结构化对象时安全跳过', () => {
    const event: ExecuteAfterEvent = {
      tool: 'write',
      status: 'completed',
      result: { output: { value: 42 } },
    };
    expect(applyJsonErrorRecovery(event)).toBeNull();
  });

  test('content 缺失但 output 为字符串时回退到 output 匹配', () => {
    const event: ExecuteAfterEvent = {
      tool: 'write',
      status: 'completed',
      result: { output: 'failed to parse json' },
    };
    expect(applyJsonErrorRecovery(event)).not.toBeNull();
  });
});

describe('可配置启用参数', () => {
  test('默认启用（未配置 enabled）', () => {
    expect(applyJsonErrorRecovery(completedEvent('write', 'json parse error'))).not.toBeNull();
  });

  test('enabled: true 时生效', () => {
    expect(
      applyJsonErrorRecovery(completedEvent('write', 'json parse error'), {
        enabled: true,
      }),
    ).not.toBeNull();
  });

  test('enabled: false 时即使命中 JSON 错误也不改写', () => {
    expect(
      applyJsonErrorRecovery(completedEvent('write', 'json parse error'), {
        enabled: false,
      }),
    ).toBeNull();
  });
});

describe('v2 result 改写', () => {
  test('completed 事件返回新的克隆事件，原对象不被修改', () => {
    const event = completedEvent('write', 'json parse error');
    const snapshot = event.result?.content;
    const result = applyJsonErrorRecovery(event);
    expect(result).not.toBeNull();
    // 原始事件未被修改
    expect(event.result?.content).toBe(snapshot);
    expect(event).not.toBe(result);
    expect(result?.status).toBe('completed');
  });

  test('改写的字符串内容以追加提示结尾', () => {
    const result = applyJsonErrorRecovery(completedEvent('write', 'json parse error'));
    const content = result?.result?.content as string;
    expect(content.endsWith(JSON_ERROR_REMINDER)).toBe(true);
    expect(content).toContain(JSON_ERROR_REMINDER_MARKER);
  });

  test('数组内容改写为追加一个 text 部分', () => {
    const result = applyJsonErrorRecovery(
      completedEvent('write', [{ type: 'text', text: 'json parse error' }]),
    );
    const content = result?.result?.content as TextContentPart[];
    expect(content[1].text).toContain(JSON_ERROR_REMINDER_MARKER);
  });

  test('error 状态改写 error.message', () => {
    const event = errorEvent('write', 'failed to parse json');
    const result = applyJsonErrorRecovery(event);
    expect(result?.status).toBe('error');
    expect(result?.error?.message).toContain(JSON_ERROR_REMINDER_MARKER);
    // 原错误对象未被修改
    expect(event.error?.message).toBe('failed to parse json');
  });
});

describe('appendReminder 工具函数', () => {
  test('字符串末尾追加换行提示', () => {
    expect(appendReminder('abc', 'REM')).toBe('abc\nREM');
  });

  test('空字符串直接返回提示', () => {
    expect(appendReminder('', 'REM')).toBe('REM');
  });

  test('以换行结尾的字符串直接拼接', () => {
    expect(appendReminder('abc\n', 'REM')).toBe('abc\nREM');
  });

  test('数组内容追加 text 部分', () => {
    const result = appendReminder([{ type: 'text', text: 'abc' }], 'REM');
    expect(result).toEqual([
      { type: 'text', text: 'abc' },
      { type: 'text', text: 'REM' },
    ]);
  });
});

describe('extractCandidateText', () => {
  test('字符串内容直接返回', () => {
    expect(extractCandidateText(completedEvent('write', 'hello'))).toBe('hello');
  });

  test('数组内容拼接各文本部分', () => {
    expect(
      extractCandidateText(
        completedEvent('write', [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ]),
      ),
    ).toBe('a\nb');
  });

  test('非字符串结果返回 null', () => {
    expect(
      extractCandidateText(completedEvent('write', [{ type: 'text', text: 1 as never }])),
    ).toBeNull();
  });

  test('error 状态返回 error.message', () => {
    expect(extractCandidateText(errorEvent('write', 'boom'))).toBe('boom');
  });
});
