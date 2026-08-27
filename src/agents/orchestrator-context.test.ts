import { describe, expect, test } from 'bun:test';
import { createAgents } from './index';

describe('编排上下文与委派协议', () => {
  const system = (name: string) => {
    const agent = createAgents().find((item) => item.name === name);
    expect(agent).toBeDefined();
    return agent!.system!;
  };

  test('Delegation Brief 必须完整传递目标、背景、决策、Files、禁区、依赖、验收和测试命令', () => {
    const sys = system('oceanus');
    for (const field of [
      '目标', '背景', '决策', 'Files', '禁区', '依赖', '验收', '测试命令',
    ]) {
      expect(sys).toContain(field);
    }
    expect(sys).toMatch(/Delegation Brief/);
  });

  test('Job Board 摘要包含任务身份、状态、worker 和结果摘要', () => {
    const sys = system('oceanus');
    expect(sys).toMatch(/Background Job Board/);
    expect(sys).toMatch(/task.?id|任务.*id/i);
    expect(sys).toMatch(/state|状态/i);
    expect(sys).toMatch(/worker|session|agent/i);
    expect(sys).toMatch(/summary|摘要/i);
  });

  test('父 agent 恢复子 agent 时复用 session，并在恢复后重新核对上下文与状态', () => {
    const sys = system('oceanus');
    expect(sys).toMatch(/parent|父/i);
    expect(sys).toMatch(/resume|恢复/i);
    expect(sys).toMatch(/task_id/);
    expect(sys).toMatch(/reconcile|核对|校验/i);
  });

  test('任务终态以 task_status/task_result 查询确认，不依赖 queue 通知', () => {
    const sys = system('oceanus');
    expect(sys).toMatch(/[Dd]o not rely on queue notifications/);
    expect(sys).toMatch(/`task_status`/);
    expect(sys).toMatch(/`task_result`/);
  });

  test('子 agent 不直接向用户提问，必须把阻塞反馈给父 agent', () => {
    for (const name of ['explorer', 'librarian', 'oracle', 'fixer']) {
      const sys = system(name);
      expect(sys).toMatch(/do not ask.*user|不要.*用户.*问|父 agent.*阻塞|parent.*blocked/i);
    }
  });
});
