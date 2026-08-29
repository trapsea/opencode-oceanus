/**
 * dispatch-guard 测试：角色冒名拦截、同目标终态未消费断路器（TaskCoordinator 版）。
 *
 * duplicate-objective 规则读取注入的 coordinator 只读视图（鸭子类型，
 * 与 createTaskCoordinator().listTasks 语义一致），不再依赖 JobBoard。
 */
import { describe, expect, test } from 'bun:test';
import {
  deriveObjectiveKey,
  extractPersonaSubject,
  inspectDispatch,
  normalizeObjectiveText,
  runDispatchGuards,
  type DispatchGuardCoordinator,
  type DispatchGuardTask,
} from './dispatch-guard';

/** 禁用的旧术语：错误文案（报错即提示词）中一律不得出现。 */
const BANNED_TERMS = ['task_reuse', 'Job Board', 'child session'] as const;

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
    expect(v.message).toContain('task_revive');
    for (const term of BANNED_TERMS) expect(v.message).not.toContain(term);
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

/** 内联 fake coordinator：鸭子类型，仅 listByParent 只读视图。 */
function fakeCoordinator(
  tasks: Partial<DispatchGuardTask>[],
  knownParent = 'p1',
): DispatchGuardCoordinator {
  const records: DispatchGuardTask[] = tasks.map((t, i) => ({
    taskID: `t${i + 1}`,
    agent: 'momus',
    objective: '计划门禁\n只审查可执行性',
    state: 'completed',
    ...t,
  }));
  return {
    listByParent(parentSessionID: string): DispatchGuardTask[] {
      return parentSessionID === knownParent ? records : [];
    },
  };
}

describe('inspectDispatch 规则②：同目标终态未消费重派（coordinator 版）', () => {
  const evt = (input: Record<string, unknown> = {}) => ({
    sessionID: 'p1',
    input: {
      agent: 'momus',
      description: '计划门禁',
      prompt: '只审查可执行性',
      ...input,
    },
  });

  test('命中：同 parent 同 agent 终态未消费同目标 → duplicate-objective 且提示 task_result(task_id=…)', () => {
    const v = inspectDispatch(evt(), fakeCoordinator([{ taskID: 't1' }]))!;
    expect(v.rule).toBe('duplicate-objective');
    expect(v.message).toContain('task_result(task_id="t1")');
    for (const term of BANNED_TERMS) expect(v.message).not.toContain(term);
  });

  test('failed / cancelled 无未消费结果 → 放行（可重派恢复，非死胡同）', () => {
    expect(inspectDispatch(evt(), fakeCoordinator([{ state: 'failed' }]))).toBeNull();
    expect(inspectDispatch(evt(), fakeCoordinator([{ state: 'cancelled' }]))).toBeNull();
    expect(inspectDispatch(evt(), fakeCoordinator([{ state: 'uncertain' }]))).toBeNull();
  });

  test('已消费（resultConsumedAt 已写入）→ 放行', () => {
    expect(
      inspectDispatch(evt(), fakeCoordinator([{ taskID: 't1', resultConsumedAt: 123 }])),
    ).toBeNull();
  });

  test('非终态（running/uncertain）→ 放行', () => {
    expect(inspectDispatch(evt(), fakeCoordinator([{ state: 'running' }]))).toBeNull();
    expect(inspectDispatch(evt(), fakeCoordinator([{ state: 'uncertain' }]))).toBeNull();
  });

  test('显式 taskId / task_id / sessionID（续用通道）→ 放行', () => {
    const board = fakeCoordinator([{ taskID: 't1' }]);
    expect(inspectDispatch(evt({ taskId: 't1' }), board)).toBeNull();
    expect(inspectDispatch(evt({ task_id: 't1' }), board)).toBeNull();
    expect(inspectDispatch(evt({ sessionID: 't1' }), board)).toBeNull();
  });

  test('目标不同 → 放行', () => {
    expect(inspectDispatch(evt({ description: '另一个目标' }), fakeCoordinator([{ taskID: 't1' }]))).toBeNull();
  });

  test('agent 不同（含别名归一后不同）→ 放行；别名归一后相同 → 拦截', () => {
    expect(
      inspectDispatch(evt(), fakeCoordinator([{ taskID: 't1', agent: 'oracle' }])),
    ).toBeNull();
    const v = inspectDispatch(
      evt({ agent: 'explorer' }),
      fakeCoordinator([{ taskID: 't1', agent: 'explore', objective: '计划门禁\n只审查可执行性' }]),
    )!;
    expect(v.rule).toBe('duplicate-objective');
  });

  test('不同 parent 的任务不参与匹配 → 放行', () => {
    expect(inspectDispatch({ ...evt(), sessionID: 'p2' }, fakeCoordinator([{ taskID: 't1' }]))).toBeNull();
  });

  test('记录 objective 为空 → 无法比对 → 放行', () => {
    expect(inspectDispatch(evt(), fakeCoordinator([{ taskID: 't1', objective: '' }]))).toBeNull();
  });

  test('无 coordinator → 规则②静默降级放行', () => {
    expect(inspectDispatch(evt())).toBeNull();
  });

  test('coordinator 抛错 → 纯函数不抛错、fail-open 放行', () => {
    const broken: DispatchGuardCoordinator = {
      listByParent() {
        throw new Error('index unavailable');
      },
    };
    expect(inspectDispatch(evt(), broken)).toBeNull();
  });
});

describe('runDispatchGuards：命中即 throw', () => {
  test('persona 命中 throw，错误文本含规则名', () => {
    expect(() =>
      runDispatchGuards({
        sessionID: 'p',
        input: { agent: 'general', prompt: '你是 Momus' },
      }),
    ).toThrow(/persona-mismatch|角色冒名/u);
  });

  test('duplicate 命中 throw：文案指向 task_result(task_id=…) 且不含旧术语', () => {
    let message = '';
    try {
      runDispatchGuards(
        {
          sessionID: 'p1',
          input: { agent: 'momus', description: '计划门禁', prompt: '只审查可执行性' },
        },
        { coordinator: fakeCoordinator([{ taskID: 't1' }]) },
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('[duplicate-objective]');
    expect(message).toContain('task_result(task_id="t1")');
    expect(message).toContain('task_revive');
    for (const term of BANNED_TERMS) expect(message).not.toContain(term);
  });

  test('第二参数可省略（向后兼容窗口期）：不抛错', () => {
    expect(() =>
      runDispatchGuards({
        sessionID: 'p1',
        input: { agent: 'momus', description: '计划门禁', prompt: '只审查可执行性' },
      }),
    ).not.toThrow();
  });

  test('coordinator 命中路径生效：同目标终态未消费 → throw', () => {
    expect(() =>
      runDispatchGuards(
        {
          sessionID: 'p1',
          input: { agent: 'momus', description: '计划门禁', prompt: '只审查可执行性' },
        },
        { coordinator: fakeCoordinator([{ taskID: 't1', resultConsumedAt: undefined }]) },
      ),
    ).toThrow(/duplicate-objective/u);
  });
});
