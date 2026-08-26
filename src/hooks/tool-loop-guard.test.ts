import { describe, expect, test } from 'bun:test';
import {
  buildLoopGuardWarning,
  createToolLoopGuardHook,
  LOOP_GUARD_BLOCK_AT,
  LOOP_GUARD_MARKER,
  LOOP_GUARD_WARN_AT,
  type ToolExecuteAfterEvent,
  type ToolExecuteBeforeEvent,
  type ToolLoopGuardHook,
} from './tool-loop-guard';

let seq = 0;
function nextID(): string {
  return `call-${++seq}`;
}

/** 构造 v2 形状的 before 事件。 */
function before(
  sessionID: string,
  tool: string,
  input: unknown,
  id = nextID(),
): ToolExecuteBeforeEvent {
  return { tool, sessionID, id, input };
}

/** 构造 v2 形状的 completed after 事件。 */
function afterCompleted(
  sessionID: string,
  tool: string,
  input: unknown,
  result: { output?: unknown; content?: string | ReadonlyArray<unknown> },
  id = nextID(),
): ToolExecuteAfterEvent {
  return { tool, sessionID, id, input, status: 'completed', result };
}

/** 构造 v2 形状的 error after 事件。 */
function afterError(
  sessionID: string,
  tool: string,
  input: unknown,
  id = nextID(),
): ToolExecuteAfterEvent {
  return { tool, sessionID, id, input, status: 'error', error: new Error('boom') };
}

/**
 * 执行一次完整调用：before + completed after 使用同一个 id
 * （与 v2 运行时行为一致：同一调用的 before/after 共享 id）。
 */
async function runCompleted(
  hook: ToolLoopGuardHook,
  sessionID: string,
  tool: string,
  input: unknown,
  result: { output?: unknown; content?: string | ReadonlyArray<unknown> },
): Promise<void> {
  const id = nextID();
  await hook['tool.execute.before'](before(sessionID, tool, input, id));
  await hook['tool.execute.after'](afterCompleted(sessionID, tool, input, result, id));
}

/** 执行一次完整调用：before + error after 使用同一个 id。 */
async function runError(
  hook: ToolLoopGuardHook,
  sessionID: string,
  tool: string,
  input: unknown,
): Promise<void> {
  const id = nextID();
  await hook['tool.execute.before'](before(sessionID, tool, input, id));
  await hook['tool.execute.after'](afterError(sessionID, tool, input, id));
}

describe('tool-loop-guard', () => {
  test('相同参数+相同结果连续达到 WARN_AT 时向 content 追加告警', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_WARN_AT; i++) {
      await runCompleted(hook, 's1', 'read', args, { content: 'file-a' });
    }
    // 再发一次 identical 调用以拿到 result 引用断言告警文案。
    const result: { output?: unknown; content?: string | ReadonlyArray<unknown> } =
      { content: 'file-a' };
    await runCompleted(hook, 's1', 'read', args, result);
    expect(String(result.content)).toContain(LOOP_GUARD_MARKER);
  });

  test('相同参数+相同结果达到 BLOCK_AT 时 before 抛错拒绝', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT; i++) {
      await runCompleted(hook, 's2', 'read', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('s2', 'read', args)),
    ).rejects.toThrow(/Refusing to execute/);
  });

  test('未达 BLOCK_AT（WARN_AT 与 BLOCK_AT 之间）不拒绝', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT - 1; i++) {
      await runCompleted(hook, 's3', 'read', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('s3', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('结果变化重置 run，不会累计到阻塞', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT - 1; i++) {
      await runCompleted(hook, 's4', 'read', args, { output: 'v1' });
    }
    // 结果变化：重置 run 到 1。
    await runCompleted(hook, 's4', 'read', args, { output: 'v2-CHANGED' });
    // 再做 3 次相同：重置后 run = 1,2,3,4 < BLOCK_AT。
    for (let i = 0; i < LOOP_GUARD_WARN_AT - 1; i++) {
      await runCompleted(hook, 's4', 'read', args, { output: 'v2-CHANGED' });
    }
    // 若未重置，累计会超过 BLOCK_AT 而必然拒绝；重置后 run=4 < 5，不拒绝。
    await expect(
      hook['tool.execute.before'](before('s4', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('参数变化重置 run', async () => {
    const hook = createToolLoopGuardHook();
    await runCompleted(hook, 's5', 'read', { path: 'a.txt' }, { output: 'same' });
    await runCompleted(hook, 's5', 'read', { path: 'a.txt' }, { output: 'same' });
    // 参数变化。
    await runCompleted(hook, 's5', 'read', { path: 'b.txt' }, { output: 'same' });
    await expect(
      hook['tool.execute.before'](before('s5', 'read', { path: 'b.txt' })),
    ).resolves.toBeUndefined();
  });

  test('并发 before 不提前计数：仅 after 推进', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    const befores = await Promise.all(
      Array.from({ length: 5 }, () => hook['tool.execute.before'](before('s6', 'read', args))),
    );
    expect(befores).toHaveLength(5);
    await expect(
      hook['tool.execute.before'](before('s6', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('task_status/task_result/task_cancel 完全豁免', async () => {
    const hook = createToolLoopGuardHook();
    for (const tool of ['task_status', 'task_result', 'task_cancel']) {
      const args = { id: 'job-1' };
      for (let i = 0; i < 10; i++) {
        await runCompleted(hook, 's7', tool, args, { output: 'same' });
      }
      await expect(
        hook['tool.execute.before'](before('s7', tool, args)),
      ).resolves.toBeUndefined();
    }
  });

  test('非阻塞工具（如 websearch）只告警不阻塞', async () => {
    const hook = createToolLoopGuardHook();
    const args = { query: 'x' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT + 2; i++) {
      await runCompleted(hook, 's8', 'websearch', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('s8', 'websearch', args)),
    ).resolves.toBeUndefined();
  });

  test('before 抛错时 after error 分支重置 run，不向阻塞累计', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT + 3; i++) {
      await runError(hook, 's9', 'read', args);
    }
    await expect(
      hook['tool.execute.before'](before('s9', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('resetSession 清除 session 状态，重新累计', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT; i++) {
      await runCompleted(hook, 's10', 'read', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('s10', 'read', args)),
    ).rejects.toThrow(/Refusing/);
    hook.resetSession('s10');
    await expect(
      hook['tool.execute.before'](before('s10', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('会话相互独立，计数按 session 隔离', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT; i++) {
      await runCompleted(hook, 'sA', 'read', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('sA', 'read', args)),
    ).rejects.toThrow(/Refusing/);
    await expect(
      hook['tool.execute.before'](before('sB', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('参数指纹对键顺序不敏感（等价调用计为相同）', async () => {
    const hook = createToolLoopGuardHook();
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT; i++) {
      const args = i % 2 === 0 ? { a: 1, b: 2 } : { b: 2, a: 1 };
      await runCompleted(hook, 's11', 'read', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('s11', 'read', { b: 2, a: 1 })),
    ).rejects.toThrow(/Refusing/);
  });

  test('日志注入 spy 可观测告警/阻塞事件', async () => {
    const logs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const hook = createToolLoopGuardHook({
      log: (msg, meta) => logs.push({ msg, meta }),
    });
    const args = { path: 'a.txt' };
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT; i++) {
      await runCompleted(hook, 's12', 'read', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('s12', 'read', args)),
    ).rejects.toThrow();
    const blockLog = logs.find((l) => l.msg.includes('blocked'));
    expect(blockLog).toBeDefined();
    expect(blockLog?.meta?.sessionID).toBe('s12');
    expect(blockLog?.meta?.tool).toBe('read');
  });

  test('自定义 warnAt：更早告警，文案使用实际 warnAt', async () => {
    const hook = createToolLoopGuardHook({ warnAt: 2 });
    const args = { path: 'a.txt' };
    const result: { output?: unknown; content?: string | ReadonlyArray<unknown> } = {
      content: 'file-a',
    };
    await runCompleted(hook, 's-warn', 'read', args, { content: 'file-a' });
    await runCompleted(hook, 's-warn', 'read', args, result);
    expect(String(result.content)).toContain(LOOP_GUARD_MARKER);
    // 文案中嵌入实际的 warnAt=2。
    expect(String(result.content)).toContain('identical arguments 2 times');
    // 默认阈值 3 下第 2 次不应告警。
    const def = createToolLoopGuardHook();
    const defResult: { output?: unknown; content?: string | ReadonlyArray<unknown> } = {
      content: 'file-a',
    };
    await runCompleted(def, 's-def', 'read', args, { content: 'file-a' });
    await runCompleted(def, 's-def', 'read', args, defResult);
    expect(String(defResult.content)).not.toContain(LOOP_GUARD_MARKER);
  });

  test('自定义 blockAt：更早拒绝；默认 blockAt 下相同调用数不拒绝', async () => {
    const hook = createToolLoopGuardHook({ blockAt: 2 });
    const args = { path: 'a.txt' };
    await runCompleted(hook, 's-block', 'read', args, { output: 'same' });
    await runCompleted(hook, 's-block', 'read', args, { output: 'same' });
    await expect(
      hook['tool.execute.before'](before('s-block', 'read', args)),
    ).rejects.toThrow(/Refusing to execute/);

    const def = createToolLoopGuardHook();
    await runCompleted(def, 's-def2', 'read', args, { output: 'same' });
    await runCompleted(def, 's-def2', 'read', args, { output: 'same' });
    await expect(
      def['tool.execute.before'](before('s-def2', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('自定义 maxSessions：FIFO 裁剪，被淘汰 session 状态被清理', async () => {
    const hook = createToolLoopGuardHook({ maxSessions: 1 });
    const args = { path: 'a.txt' };
    // sA 累计到阻塞阈值。
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT; i++) {
      await runCompleted(hook, 'sA', 'read', args, { output: 'same' });
    }
    await expect(
      hook['tool.execute.before'](before('sA', 'read', args)),
    ).rejects.toThrow(/Refusing/);
    // sB 进入并触发裁剪（size > maxSessions → 淘汰最旧 sA）。
    await runCompleted(hook, 'sB', 'read', args, { output: 'same' });
    // sA 已被淘汰 → 不再拒绝。
    await expect(
      hook['tool.execute.before'](before('sA', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('自定义阈值：告警后达到 blockAt 仍会拒绝', async () => {
    const hook = createToolLoopGuardHook({ warnAt: 1, blockAt: 2 });
    const args = { path: 'a.txt' };
    const result: { output?: unknown; content?: string | ReadonlyArray<unknown> } = {
      output: 'same',
    };
    await runCompleted(hook, 's-cfg', 'read', args, result);
    expect(String(result.output)).toContain(LOOP_GUARD_MARKER);
    await runCompleted(hook, 's-cfg', 'read', args, { output: 'same' });
    await expect(
      hook['tool.execute.before'](before('s-cfg', 'read', args)),
    ).rejects.toThrow(/Refusing/);
  });

  test('非法/边界阈值安全归一化为默认值', async () => {
    const args = { path: 'a.txt' };
    // warnAt=0 / 负数 / 非整数 → 回落默认 3：第 2 次不应告警。
    for (const badWarnAt of [0, -3, 1.5, Number.NaN, Infinity]) {
      const hook = createToolLoopGuardHook({ warnAt: badWarnAt });
      const r: { output?: unknown; content?: string | ReadonlyArray<unknown> } = {
        content: 'file-a',
      };
      await runCompleted(hook, 's-bad', 'read', args, { content: 'file-a' });
      await runCompleted(hook, 's-bad', 'read', args, r);
      expect(String(r.content)).not.toContain(LOOP_GUARD_MARKER);
      hook.resetForTests();
    }
    // blockAt=0 / 负数 → 回落默认 5：4 次不拒绝。
    for (const badBlockAt of [0, -5, 2.7, Number.NaN]) {
      const hook = createToolLoopGuardHook({ blockAt: badBlockAt });
      for (let i = 0; i < LOOP_GUARD_BLOCK_AT - 1; i++) {
        await runCompleted(hook, 's-bad2', 'read', args, { output: 'same' });
      }
      await expect(
        hook['tool.execute.before'](before('s-bad2', 'read', args)),
      ).resolves.toBeUndefined();
      hook.resetForTests();
    }
    // maxSessions=0 / 负数 / 非整数 → 回落默认，不崩溃。
    const hook = createToolLoopGuardHook({ maxSessions: 0 });
    await runCompleted(hook, 's-m0', 'read', args, { output: 'same' });
    await expect(
      hook['tool.execute.before'](before('s-m0', 'read', args)),
    ).resolves.toBeUndefined();
  });

  test('task_* 系列工具豁免不受自定义阈值影响', async () => {
    const hook = createToolLoopGuardHook({ warnAt: 1, blockAt: 1 });
    for (const tool of ['task_status', 'task_result', 'task_cancel']) {
      const args = { id: 'job-1' };
      for (let i = 0; i < 20; i++) {
        await runCompleted(hook, 's-task', tool, args, { output: 'same' });
      }
      await expect(
        hook['tool.execute.before'](before('s-task', tool, args)),
      ).resolves.toBeUndefined();
    }
  });

  test('文本数组 content：达到 WARN_AT 时向文本项追加告警', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    // 每个调用用独立数组对象，模拟 v2 常见 [{type:'text',text}]。
    const item = () => ({
      type: 'text',
      text: 'file-a',
      extra: 'keep', // 非标准字段也应原样保留
    });
    for (let i = 0; i < LOOP_GUARD_WARN_AT; i++) {
      await runCompleted(hook, 's-arr', 'read', args, { content: [item()] });
    }
    const result: { content?: string | ReadonlyArray<unknown> } = {
      content: [item()],
    };
    await runCompleted(hook, 's-arr', 'read', args, result);
    const items = result.content as ReadonlyArray<unknown>;
    expect(items).toHaveLength(1);
    expect(String((items[0] as { text: string }).text)).toContain(LOOP_GUARD_MARKER);
    // 非标准字段保持不变。
    expect((items[0] as { extra: string }).extra).toBe('keep');
  });

  test('文本已含 marker 时幂等：不重复追加', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    const item = () => ({ type: 'text', text: `${LOOP_GUARD_MARKER}\nalready warned` });
    const result: { content?: string | ReadonlyArray<unknown> } = { content: [item()] };
    for (let i = 0; i < LOOP_GUARD_WARN_AT + 2; i++) {
      await runCompleted(hook, 's-dup', 'read', args, result);
    }
    const text = (result.content as ReadonlyArray<{ text: string }>)[0].text;
    expect(text.split(LOOP_GUARD_MARKER).length - 1).toBe(1);
  });

  test('混合非文本项：只改最后一个文本项，非文本项原样保留', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    const make = (): ReadonlyArray<unknown> => [
      { type: 'text', text: 'part1' },
      { type: 'image', data: 'img-1' },
      { type: 'text', text: 'part2' },
    ];
    for (let i = 0; i < LOOP_GUARD_WARN_AT; i++) {
      await runCompleted(hook, 's-mix', 'read', args, { content: make() });
    }
    const result: { content?: string | ReadonlyArray<unknown> } = { content: make() };
    await runCompleted(hook, 's-mix', 'read', args, result);
    const items = result.content as ReadonlyArray<unknown>;
    expect(items).toHaveLength(3);
    // 第一个文本项保持不变，非文本项原样。
    expect(String((items[0] as { text: string }).text)).not.toContain(LOOP_GUARD_MARKER);
    expect(items[1]).toEqual({ type: 'image', data: 'img-1' });
    // 告警追加到最后一个文本项。
    expect(String((items[2] as { text: string }).text)).toContain(LOOP_GUARD_MARKER);
  });

  test('文本数组为空或没有文本项时 fail-open，不抛错', async () => {
    const hook = createToolLoopGuardHook();
    const args = { path: 'a.txt' };
    // 空数组。
    const emptyResult: { content?: string | ReadonlyArray<unknown> } = { content: [] };
    for (let i = 0; i < LOOP_GUARD_WARN_AT + 2; i++) {
      await runCompleted(hook, 's-empty', 'read', args, emptyResult);
    }
    expect(emptyResult.content).toEqual([]);

    // 只有非文本项。
    const onlyNonText: { content?: string | ReadonlyArray<unknown> } = {
      content: [{ type: 'image', data: 'img-1' }],
    };
    // append 侧 fail-open：即便没有文本项，after 也照常完成、不抛错；
    // 计数仍正常累计，达到 BLOCK_AT 后 read 工具照常被阻断。
    for (let i = 0; i < LOOP_GUARD_BLOCK_AT; i++) {
      await runCompleted(hook, 's-nontext', 'read', args, onlyNonText);
    }
    expect(onlyNonText.content).toEqual([{ type: 'image', data: 'img-1' }]);
    await expect(
      hook['tool.execute.before'](before('s-nontext', 'read', args)),
    ).rejects.toThrow(/Refusing to execute/);
  });

  test('buildLoopGuardWarning 文案随 warnAt 变化', () => {
    expect(buildLoopGuardWarning(3)).toContain('identical arguments 3 times');
    expect(buildLoopGuardWarning(7)).toContain('identical arguments 7 times');
    expect(buildLoopGuardWarning(7)).not.toContain('identical arguments 3 times');
  });
});
