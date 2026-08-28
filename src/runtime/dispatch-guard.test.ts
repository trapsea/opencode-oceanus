/**
 * dispatch-guard 测试：角色冒名拦截、同目标终态未消费断路器、消费标记。
 */
import { describe, expect, test } from 'bun:test';
import {
  deriveObjectiveKey,
  extractPersonaSubject,
  inspectDispatch,
  markResultConsumed,
  normalizeObjectiveText,
  runDispatchGuards,
} from './dispatch-guard';
import { createTaskObserver } from './task-observer';

const noopLogger = () => {};

describe('extractPersonaSubject：第二人称专家指派识别', () => {
  test('中文开头「你是 Momus」', () => {
    expect(extractPersonaSubject('你是 Momus，严格只审查计划可执行性。')).toBe('momus');
  });
  test('无空格「你是Momus」也可命中', () => {
    expect(extractPersonaSubject('你是Momus')).toBe('momus');
  });
  test('英文 You are the Oracle', () => {
    expect(extractPersonaSubject('You are the Oracle. Review architecture risks.')).toBe('oracle');
  });
  test('Act as Fixer', () => {
    expect(extractPersonaSubject('Act as Fixer and apply the patch.')).toBe('fixer');
  });
  test('扮演 Explorer', () => {
    expect(extractPersonaSubject('扮演 Explorer 扫描目录结构')).toBe('explorer');
  });
  test('非专家词不命中', () => {
    expect(extractPersonaSubject('你是一个负责收据的助手')).toBeUndefined();
  });
});

describe('normalizeObjectiveText / deriveObjectiveKey', () => {
  test('折叠空白并小写化', () => {
    expect(normalizeObjectiveText('Review  Plan\n\tGate')).toBe('review plan gate');
  });
  test('deriveObjectiveKey 组合 description+prompt 并限长', () => {
    const key = deriveObjectiveKey('审查计划', 'Strict gate review');
    expect(key).toBe('审查计划 strict gate review');
    expect(deriveObjectiveKey(undefined, undefined)).toBeUndefined();
  });
});

describe('inspectDispatch 规则①：角色冒名', () => {
  const base = { sessionID: 'p1', input: {} };

  test('prompt 指名 momus 而 agent=general → 命中且给出原生名指引', () => {
    const v = inspectDispatch({
      ...base,
      input: { agent: 'general', description: 'x', prompt: '你是 Momus，严格只审查。' },
    })!;
    expect(v.rule).toBe('persona-mismatch');
    expect(v.message).toContain('agent="momus"');
    expect(v.message).toContain('task_reuse');
  });

  test('agent 与指名一致 → 放行', () => {
    expect(
      inspectDispatch({ ...base, input: { agent: 'momus', prompt: '你是 Momus，审查。' } }),
    ).toBeNull();
  });

  test('别名归一：agent=explore 与「你是 Explorer」一致放行', () => {
    expect(
      inspectDispatch({ ...base, input: { agent: 'explore', prompt: '你是 Explorer，扫描。' } }),
    ).toBeNull();
  });

  test('缺少 agent 字段时不判定（无法明确归属）', () => {
    expect(inspectDispatch({ ...base, input: { prompt: '你是 Momus' } })).toBeNull();
  });

  test('普通任务 prompt 无指派句式 → 放行', () => {
    expect(
      inspectDispatch({ ...base, input: { agent: 'fixer', prompt: '修复 build 脚本。' } }),
    ).toBeNull();
  });
});

function fakeBoard(tasks: any[]) {
  return {
    revision: 0,
    tasks: () => tasks,
    get: (id: string) => tasks.find((t) => t.task_id === id),
    async replace(rec: any) {
      const i = tasks.findIndex((t) => t.task_id === rec.task_id);
      if (i >= 0) tasks[i] = rec;
      return rec;
    },
  } as never;
}

describe('inspectDispatch 规则②：同目标终态未消费重派', () => {
  const makeTask = (over: Record<string, unknown> = {}) => ({
    task_id: 't1',
    parent_session_id: 'p1',
    agent: 'momus',
    state: 'completed',
    reconciliation: 'unreconciled',
    updated_at: 100,
    objective_key: deriveObjectiveKey('计划门禁', '只审查可执行性'),
    ...over,
  });
  const evt = (input: Record<string, unknown>) => ({
    sessionID: 'p1',
    input: { agent: 'momus', description: '计划门禁', prompt: '只审查可执行性', ...input },
  });

  test('命中：完全同目标、未读取结果 → duplicate-objective 且提示 task_result', () => {
    const v = inspectDispatch(evt({}), fakeBoard([makeTask()]))!;
    expect(v.rule).toBe('duplicate-objective');
    expect(v.message).toContain('task_result(taskId="t1")');
  });

  test('已消费（last_used_at > updated_at）→ 放行', () => {
    expect(
      inspectDispatch(evt({}), fakeBoard([makeTask({ last_used_at: 101 })])),
    ).toBeNull();
  });

  test('显式带 task_id（revive/reuse 通道）→ 放行', () => {
    expect(inspectDispatch(evt({ taskId: 't1' }), fakeBoard([makeTask()]))).toBeNull();
  });

  test('已 reconcile → 放行', () => {
    expect(
      inspectDispatch(evt({}), fakeBoard([makeTask({ reconciliation: 'reconciled' })])),
    ).toBeNull();
  });

  test('非终态（running）→ 放行', () => {
    expect(inspectDispatch(evt({}), fakeBoard([makeTask({ state: 'running' })]))).toBeNull();
  });

  test('目标不同 → 放行', () => {
    expect(
      inspectDispatch(evt({ description: '另一个目标' }), fakeBoard([makeTask()])),
    ).toBeNull();
  });

  test('旧记录缺 objective_key 时回退 objective/description 归一化匹配', () => {
    const legacy = makeTask();
    delete legacy.objective_key;
    legacy.objective = '计划门禁\n只审查可执行性';
    const v = inspectDispatch(evt({}), fakeBoard([legacy]))!;
    expect(v?.rule).toBe('duplicate-objective');
  });

  test('无 board → 完全放行', () => {
    expect(inspectDispatch(evt({}))).toBeNull();
  });
});

describe('runDispatchGuards / markResultConsumed', () => {
  test('命中即 throw，错误文本含规则名与指引', () => {
    expect(() =>
      runDispatchGuards({
        sessionID: 'p',
        input: { agent: 'general', prompt: '你是 Momus' },
      }),
    ).toThrow(/persona-mismatch[\s\S]*冒充|DispatchGuard 角色冒名拦截/u);
  });

  test('markResultConsumed 写入 last_used_at；get 失败时 fail-open 返回 false', async () => {
    const tasks = [makeSimpleTask()];
    const board = fakeBoard(tasks);
    expect(await markResultConsumed(board, 't9')).toBe(false); // 不存在
    const ok = await markResultConsumed(board, 't1');
    expect(ok).toBe(true);
    expect(typeof (tasks[0] as any).last_used_at).toBe('number');

    function makeSimpleTask() {
      return {
        task_id: 't1',
        parent_session_id: 'p',
        state: 'completed',
        reconciliation: 'unreconciled',
        updated_at: 100,
        last_board_revision: 3,
      };
    }
  });
});

describe('createTaskObserver 接线：guard 在观察写入之前生效', () => {
  function fakeRegistry() {
    const created: any[] = [];
    return {
      created,
      create(rec: any) {
        created.push(rec);
      },
      setObservation() {},
    } as never;
  }

  test('冒名调用直接 reject，registry 不建 running 任务', async () => {
    const reg = fakeRegistry();
    const observer = createTaskObserver({ registry: reg, logger: noopLogger });
    await expect(
      observer['execute.before']({
        tool: 'subagent',
        sessionID: 'p1',
        id: 'call1',
        input: { agent: 'general', description: '门禁', prompt: '你是 Momus，审查计划' },
      }),
    ).rejects.toThrow(/冒充|persona-mismatch/u);
    expect((reg as any).created).toHaveLength(0);
  });

  test('合规调用正常放行，等待明确 child session 后再创建受控任务', async () => {
    const reg = fakeRegistry();
    const observer = createTaskObserver({ registry: reg, logger: noopLogger });
    await observer['execute.before']({
      tool: 'subagent',
      sessionID: 'p1',
      id: 'call2',
      input: { agent: 'momus', description: '门禁', prompt: '严格审查可执行性，输出 OKAY 或 REJECT' },
    });
    expect((reg as any).created).toHaveLength(0);
  });

  test('duplicate 断路器经 observer 生效：board 有未消费同目标终态时 reject', async () => {
    const reg = fakeRegistry();
    const key = deriveObjectiveKey('门禁', '复审可执行性');
    const board = fakeBoard([
      {
        task_id: 'old',
        parent_session_id: 'p1',
        agent: 'momus',
        state: 'completed',
        reconciliation: 'unreconciled',
        updated_at: 100,
        objective_key: key,
      },
    ]);
    const observer = createTaskObserver({ registry: reg, board, logger: noopLogger });
    await expect(
      observer['execute.before']({
        tool: 'subagent',
        sessionID: 'p1',
        id: 'call3',
        input: { agent: 'momus', description: '门禁', prompt: '复审可执行性' },
      }),
    ).rejects.toThrow(/重派|duplicate-objective/u);
    expect((reg as any).created).toHaveLength(0);
  });
});
