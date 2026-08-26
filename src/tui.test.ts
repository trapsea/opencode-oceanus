import { describe, expect, test } from 'bun:test';
import {
  getRelatedRunningSessions,
  normalizeModel,
  shortModelName,
  sortAgentRows,
} from './tui';

describe('sidebar 模型展示', () => {
  test('缺省模型跟随会话', () => {
    expect(normalizeModel(undefined)).toBe('跟随会话');
  });

  test('保留 provider、模型名和 variant', () => {
    expect(normalizeModel({ providerID: 'openai', id: 'openai/gpt-5', variant: 'high' })).toBe(
      'openai/gpt-5#high',
    );
  });

  test('模型 id 含路径时只显示最后一段', () => {
    expect(normalizeModel({ providerID: 'github', id: 'org/model/name' })).toBe('github/name');
  });

  test('常见 provider 使用简短名称', () => {
    expect(shortModelName('anthropic/claude-sonnet')).toBe('claude-sonnet');
    expect(shortModelName('github-copilot/gpt-4o')).toBe('copilot/gpt-4o');
    expect(shortModelName('custom/model')).toBe('custom/model');
  });
});

describe('sidebar agent 排序', () => {
  test('按默认 agent 顺序排序并将未知 agent 放在末尾', () => {
    const agents = [{ id: 'fixer' }, { id: 'unknown' }, { id: 'oceanus' }, { id: 'explorer' }];

    expect(sortAgentRows(agents).map((agent) => agent.id)).toEqual([
      'oceanus',
      'explorer',
      'fixer',
      'unknown',
    ]);
  });

  test('排序不修改输入数组', () => {
    const agents = [{ id: 'fixer' }, { id: 'oceanus' }];

    sortAgentRows(agents);

    expect(agents.map((agent) => agent.id)).toEqual(['fixer', 'oceanus']);
  });
});

describe('sidebar 活跃会话隔离', () => {
  type FakeSession = { id: string; time: { created: number }; agent?: string; location: { directory: string } };

  function makeContext(options: {
    current: string;
    sessions: FakeSession[];
    family: Record<string, string[]>;
    root: Record<string, string>;
    running: Set<string>;
    location: { directory: string };
  }) {
    return {
      location: options.location,
      data: {
        session: {
          family: (id: string) => options.family[id],
          root: (id: string) => options.root[id],
          list: () => options.sessions,
          status: (id: string) => (options.running.has(id) ? 'running' : 'idle'),
        },
      },
    };
  }

  test('同一目录下其它窗口的会话不被计为活跃', () => {
    const location = { directory: '/project' };
    // 窗口 1：oceanus 会话；窗口 2：sisyphus 会话，同一目录。
    const sessions: FakeSession[] = [
      { id: 'win1-oceanus', time: { created: 1 }, agent: 'oceanus', location },
      { id: 'win2-sisyphus', time: { created: 2 }, agent: 'sisyphus', location },
    ];
    const context = makeContext({
      current: 'win1-oceanus',
      sessions,
      family: { 'win1-oceanus': ['win1-oceanus'] },
      root: { 'win1-oceanus': 'win1-oceanus', 'win2-sisyphus': 'win2-sisyphus' },
      running: new Set(['win1-oceanus', 'win2-sisyphus']),
      location,
    });

    const result = getRelatedRunningSessions(
      context as never,
      'win1-oceanus',
      new Map(),
      new Set(),
    );

    expect(result.map((session) => session.id)).toEqual(['win1-oceanus']);
  });

  test('当前会话的子会话族仍被计为活跃', () => {
    const location = { directory: '/project' };
    const sessions: FakeSession[] = [
      { id: 'oceanus-parent', time: { created: 1 }, agent: 'oceanus', location },
      { id: 'oceanus-sub', time: { created: 2 }, agent: 'fixer', location },
    ];
    const context = makeContext({
      current: 'oceanus-parent',
      sessions,
      family: { 'oceanus-parent': ['oceanus-parent', 'oceanus-sub'] },
      root: { 'oceanus-parent': 'oceanus-parent', 'oceanus-sub': 'oceanus-parent' },
      running: new Set(['oceanus-parent', 'oceanus-sub']),
      location,
    });

    const result = getRelatedRunningSessions(
      context as never,
      'oceanus-parent',
      new Map(),
      new Set(),
    );

    expect(result.map((session) => session.id).sort()).toEqual([
      'oceanus-parent',
      'oceanus-sub',
    ]);
  });

  test('同一目录、不同会话族的运行会话不会互相标记', () => {
    const location = { directory: '/project' };
    const sessions: FakeSession[] = [
      { id: 'a', time: { created: 1 }, agent: 'oceanus', location },
      { id: 'b', time: { created: 2 }, agent: 'sisyphus', location },
    ];
    const context = makeContext({
      current: 'a',
      sessions,
      family: { a: ['a'], b: ['b'] },
      root: { a: 'a', b: 'b' },
      running: new Set(['a', 'b']),
      location,
    });

    const result = getRelatedRunningSessions(context as never, 'a', new Map(), new Set());

    expect(result.map((session) => session.id)).toEqual(['a']);
  });
});
