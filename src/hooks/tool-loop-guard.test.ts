import { describe, expect, test } from 'bun:test';
import {
  LOOP_GUARD_MARKER,
  LOOP_GUARD_REREAD_MARKER,
  MAX_RECENT_EDITS,
  createToolLoopGuardHook,
  type ToolExecuteAfterCompletedEvent,
  type ToolLoopGuardHook,
} from './tool-loop-guard';

/** 测试统一使用的 session。 */
const SESSION = 'sess-loop-guard';

/** 单调递增的调用 id，保证 before/after 通过 callKeys 关联同一调用。 */
let idSeq = 0;

interface InvokeOptions {
  /** completed 结果文本（content 字段）；与 error 互斥，默认固定输出。 */
  readonly output?: string;
  /** 提供时模拟 error 结果（before + error after）。 */
  readonly error?: unknown;
}

/** 模拟一次完整的工具调用（before + after），返回 completed 结果对象。 */
async function invoke(
  hook: ToolLoopGuardHook,
  tool: string,
  input: unknown,
  options: InvokeOptions = {},
): Promise<ToolExecuteAfterCompletedEvent['result'] | null> {
  const id = `call-${++idSeq}`;
  await hook['tool.execute.before']({ tool, sessionID: SESSION, id, input });
  if (options.error !== undefined) {
    await hook['tool.execute.after']({
      tool,
      sessionID: SESSION,
      id,
      input,
      status: 'error',
      error: options.error,
    });
    return null;
  }
  const result: ToolExecuteAfterCompletedEvent['result'] = {
    content: options.output ?? 'same-output',
  };
  await hook['tool.execute.after']({
    tool,
    sessionID: SESSION,
    id,
    input,
    status: 'completed',
    result,
  });
  return result;
}

/** 仅执行 before，断言被硬阻塞并返回抛出的错误。 */
async function expectBlocked(
  hook: ToolLoopGuardHook,
  tool: string,
  input: unknown,
): Promise<Error> {
  let caught: unknown;
  try {
    await hook['tool.execute.before']({
      tool,
      sessionID: SESSION,
      id: `call-${++idSeq}`,
      input,
    });
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof Error)) {
    throw new Error(`期望 ${tool} 的 before 被阻塞，但未抛错`);
  }
  return caught;
}

/** 仅执行 before，断言未被阻塞。 */
async function expectAllowed(
  hook: ToolLoopGuardHook,
  tool: string,
  input: unknown,
): Promise<void> {
  await hook['tool.execute.before']({
    tool,
    sessionID: SESSION,
    id: `call-${++idSeq}`,
    input,
  });
}

/** 读取 completed 结果的文本 content；非字符串（或 error 结果）返回空串。 */
function contentText(
  result: ToolExecuteAfterCompletedEvent['result'] | null,
): string {
  if (result === null || typeof result.content !== 'string') return '';
  return result.content;
}

describe('tool-loop-guard 现有行为回归', () => {
  test('read 同参数同输出连续达到阈值后，下一次 before 被硬阻塞', async () => {
    const hook = createToolLoopGuardHook();
    const input = { path: '/c/d.ts' };
    // 默认 blockAt=5：5 次确认相同调用后 runs=5。
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', input);
    }
    const error = await expectBlocked(hook, 'read', input);
    expect(error.message).toContain('拒绝执行');
  });

  test('结果变化重置计数，合法重读不阻塞', async () => {
    const hook = createToolLoopGuardHook();
    const input = { path: '/c/d.ts' };
    // 每次输出不同：runs 永远为 1。
    for (let i = 0; i < 10; i++) {
      await invoke(hook, 'read', input, { output: `v${i}` });
    }
    await expectAllowed(hook, 'read', input);
  });

  test('达到 warnAt 时向结果追加告警文案（marker 幂等）', async () => {
    const hook = createToolLoopGuardHook();
    const input = { path: '/c/d.ts' };
    const first = await invoke(hook, 'read', input);
    expect(contentText(first)).not.toContain(LOOP_GUARD_MARKER);
    const second = await invoke(hook, 'read', input);
    expect(contentText(second)).not.toContain(LOOP_GUARD_MARKER);
    // 第 3 次（warnAt=3）开始追加告警。
    const third = await invoke(hook, 'read', input);
    expect(contentText(third)).toContain(LOOP_GUARD_MARKER);
    expect(contentText(third).split(LOOP_GUARD_MARKER)).toHaveLength(2);
  });

  test('错误结果重置计数，需要重新累计才会阻塞', async () => {
    const hook = createToolLoopGuardHook();
    const input = { path: '/c/d.ts' };
    for (let i = 0; i < 4; i++) {
      await invoke(hook, 'read', input);
    }
    // 错误结果视为结果变化：runs 重置为 1。
    await invoke(hook, 'read', input, { error: new Error('boom') });
    // error 后需要重新累计 5 次确认相同的调用，runs 才再次到达 blockAt。
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', input);
    }
    await expectBlocked(hook, 'read', input);
  });

  test('豁免工具 task 重复调用不阻塞也不追加告警', async () => {
    const hook = createToolLoopGuardHook();
    const input = { taskID: 'tk_1' };
    for (let i = 0; i < 10; i++) {
      const result = await invoke(hook, 'task', input);
      expect(contentText(result)).not.toContain(LOOP_GUARD_MARKER);
    }
  });

  test('参数变化开启新计数序列', async () => {
    const hook = createToolLoopGuardHook();
    const inputA = { path: '/a.ts' };
    const inputB = { path: '/b.ts' };
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', inputA);
    }
    // 切换到不同参数：last 指纹变化，/a.ts 的旧计数不再生效。
    for (let i = 0; i < 4; i++) {
      await invoke(hook, 'read', inputB);
    }
    await expectAllowed(hook, 'read', inputA);
  });

  test('resetSession 清空后不再阻塞', async () => {
    const hook = createToolLoopGuardHook();
    const input = { path: '/c/d.ts' };
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', input);
    }
    hook.resetSession(SESSION);
    await expectAllowed(hook, 'read', input);
  });

  test('content 为文本数组时，告警追加到最后一个文本项且不改其他项', async () => {
    const hook = createToolLoopGuardHook();
    const input = { pattern: 'x', include: '*.md' };
    for (let i = 0; i < 3; i++) {
      const id = `call-${++idSeq}`;
      await hook['tool.execute.before']({ tool: 'grep', sessionID: SESSION, id, input });
      const result: ToolExecuteAfterCompletedEvent['result'] = {
        content: [
          { type: 'text', text: 'part1' },
          { type: 'image', data: 'binary' },
        ],
      };
      await hook['tool.execute.after']({
        tool: 'grep',
        sessionID: SESSION,
        id,
        input,
        status: 'completed',
        result,
      });
      if (i === 2) {
        expect(Array.isArray(result.content)).toBe(true);
        const items = result.content as Array<{
          type: string;
          text?: string;
          data?: string;
        }>;
        expect(items).toHaveLength(2);
        expect(items[0]?.text).toContain(LOOP_GUARD_MARKER);
        // 非文本项保持不变。
        expect(items[1]).toEqual({ type: 'image', data: 'binary' });
      }
    }
  });
});

describe('tool-loop-guard 编辑后重读豁免', () => {
  test('write 成功后重读同一文件：超过阈值不阻塞且计数被重置', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    const input = { path: '/a/b.ts' };
    for (let i = 0; i < 8; i++) {
      await invoke(hook, 'read', input);
    }
    await expectAllowed(hook, 'read', input);
    // 豁免生效：无告警文案，但带编辑后重读提示。
    const last = await invoke(hook, 'read', input);
    expect(contentText(last)).not.toContain(LOOP_GUARD_MARKER);
    expect(contentText(last)).toContain(LOOP_GUARD_REREAD_MARKER);
  });

  test('write 后重读其他未编辑文件仍按原逻辑阻塞', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    const other = { path: '/c/d.ts' };
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', other);
    }
    await expectBlocked(hook, 'read', other);
  });

  test('grep 的 include 命中最近编辑文件名时豁免', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    const input = { pattern: 'foo', include: '**/b.ts' };
    for (let i = 0; i < 8; i++) {
      await invoke(hook, 'grep', input);
    }
    await expectAllowed(hook, 'grep', input);
  });

  test('grep 的 include 不命中最近编辑文件名时不豁免', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    const input = { pattern: 'foo', include: '**/*.md' };
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'grep', input);
    }
    await expectBlocked(hook, 'grep', input);
  });

  test('grep 的 path 指向最近编辑文件时豁免', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    const input = { pattern: 'foo', path: '/a/b.ts' };
    for (let i = 0; i < 8; i++) {
      await invoke(hook, 'grep', input);
    }
    await expectAllowed(hook, 'grep', input);
  });

  test('glob 的 pattern 命中最近编辑文件名时豁免', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    const input = { pattern: '**/b.ts' };
    for (let i = 0; i < 8; i++) {
      await invoke(hook, 'glob', input);
    }
    await expectAllowed(hook, 'glob', input);
  });

  test('ast_grep_replace 的 paths 数组记录多条，后续 ast_grep_search 命中豁免', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'ast_grep_replace', {
      pattern: 'console.log($A)',
      rewrite: '$A',
      lang: 'typescript',
      paths: ['/x/a.ts', '/x/b.ts'],
    });
    // ast_grep_search 不在硬阻塞集合中，豁免体现为计数不累计到告警阈值。
    const input = { pattern: 'console.log($A)', lang: 'typescript', paths: ['/x/a.ts'] };
    for (let i = 0; i < 5; i++) {
      const result = await invoke(hook, 'ast_grep_search', input);
      expect(contentText(result)).not.toContain(LOOP_GUARD_MARKER);
      expect(contentText(result)).toContain(LOOP_GUARD_REREAD_MARKER);
    }
    // 对照：未编辑路径上的重复调用仍按原逻辑在第 3 次触发告警。
    const other = { pattern: 'console.log($A)', lang: 'typescript', paths: ['/y/c.ts'] };
    await invoke(hook, 'ast_grep_search', other);
    await invoke(hook, 'ast_grep_search', other);
    const warned = await invoke(hook, 'ast_grep_search', other);
    expect(contentText(warned)).toContain(LOOP_GUARD_MARKER);
  });

  test('失败的 write 不加入 recentEdits，重读仍会阻塞', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' }, {
      error: new Error('disk full'),
    });
    const input = { path: '/a/b.ts' };
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', input);
    }
    await expectBlocked(hook, 'read', input);
  });

  test('edit 与 apply_patch 成功后同样触发重读豁免', async () => {
    const editHook = createToolLoopGuardHook();
    await invoke(editHook, 'edit', {
      path: '/a/b.ts',
      oldString: 'a',
      newString: 'b',
    });
    const editTarget = { path: '/a/b.ts' };
    for (let i = 0; i < 8; i++) {
      await invoke(editHook, 'read', editTarget);
    }
    await expectAllowed(editHook, 'read', editTarget);

    const patchHook = createToolLoopGuardHook();
    await invoke(patchHook, 'apply_patch', {
      path: '/a/b.ts',
      patchText: '*** Begin Patch\n*** End Patch',
    });
    for (let i = 0; i < 8; i++) {
      await invoke(patchHook, 'read', editTarget);
    }
    await expectAllowed(patchHook, 'read', editTarget);
  });

  test('read 的 file:// 前缀路径归一化后命中豁免', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    const input = { path: 'file:///a/b.ts' };
    for (let i = 0; i < 8; i++) {
      await invoke(hook, 'read', input);
    }
    await expectAllowed(hook, 'read', input);
  });

  test('resetForTests 清空 recentEdits', async () => {
    const hook = createToolLoopGuardHook();
    await invoke(hook, 'write', { path: '/a/b.ts', content: 'x' });
    hook.resetForTests();
    const input = { path: '/a/b.ts' };
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', input);
    }
    await expectBlocked(hook, 'read', input);
  });

  test('recentEdits 超上限时按 FIFO 淘汰最旧路径', async () => {
    const hook = createToolLoopGuardHook();
    // 写入 MAX_RECENT_EDITS + 1 个不同文件，最早的 /f/0.ts 被淘汰。
    for (let i = 0; i <= MAX_RECENT_EDITS; i++) {
      await invoke(hook, 'write', { path: `/f/${i}.ts`, content: 'x' });
    }
    const oldest = { path: '/f/0.ts' };
    for (let i = 0; i < 5; i++) {
      await invoke(hook, 'read', oldest);
    }
    await expectBlocked(hook, 'read', oldest);
    // 最新的路径仍在集合中：豁免生效。
    const newest = { path: `/f/${MAX_RECENT_EDITS}.ts` };
    for (let i = 0; i < 8; i++) {
      await invoke(hook, 'read', newest);
    }
    await expectAllowed(hook, 'read', newest);
  });
});
