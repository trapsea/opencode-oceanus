import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  applyActiveSnapshot,
  createPresetWatcher,
  decideCalibration,
  getRelatedRunningSessions,
  getRows,
  loadPanelReactivity,
  readActivePresetName,
  readConfigAgentModels,
  recordRecall,
  resolveDisplayModel,
  setup,
  sortAgentRows,
  bareModelName,
  normalizeAgentKey,
} from './tui';
import { ALL_AGENT_NAMES } from './config/constants';

type FakeSession = { id: string; time: { created: number }; agent?: string; location: { directory: string } };

function makeContext(options: {
  current: string;
  sessions: FakeSession[];
  family: Record<string, string[]>;
  root: Record<string, string>;
  running: Set<string>;
  location: { directory: string };
  agents?: Array<{ id: string; name: string; mode: string }>;
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
      location: {
        agent: {
          list: () => options.agents ?? [],
        },
      },
    },
  };
}

describe('sidebar 模型展示', () => {
  test('bareModelName 不显示 provider（任意 provider 均剥离）', () => {
    expect(bareModelName(undefined)).toBe('跟随会话');
    expect(bareModelName({ providerID: 'openai', id: 'openai/gpt-5', variant: 'high' })).toBe(
      'gpt-5#high',
    );
    expect(bareModelName({ providerID: 'deepseek', id: 'deepseek/deepseek-chat' })).toBe(
      'deepseek-chat',
    );
    expect(bareModelName({ providerID: 'ollama', id: 'ollama/qwen2.5' })).toBe('qwen2.5');
    expect(bareModelName({ providerID: 'github-copilot', id: 'github-copilot/gpt-4o' })).toBe(
      'gpt-4o',
    );
  });
});

describe('sidebar agent 排序', () => {
  test('sidebar 白名单不含已删除的 metis/momus 且覆盖全部现行 agent', () => {
    expect(ALL_AGENT_NAMES).toEqual(
      expect.arrayContaining([
        'oceanus',
        'sisyphus',
        'prometheus',
        'explorer',
        'librarian',
        'oracle',
        'observer',
        'designer',
        'fixer',
      ]),
    );
    expect(ALL_AGENT_NAMES).not.toContain('metis');
    expect(ALL_AGENT_NAMES).not.toContain('momus');
  });

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

  test('root 未同步（undefined）时不把其它未同步会话误判为同族', () => {
    const location = { directory: '/project' };
    // root 表为空：当前会话与其它会话的 root 都是 undefined。
    const sessions: FakeSession[] = [
      { id: 'cur', time: { created: 1 }, agent: 'oceanus', location },
      { id: 'other-window', time: { created: 2 }, agent: 'sisyphus', location },
    ];
    const context = makeContext({
      current: 'cur',
      sessions,
      family: { cur: ['cur'] },
      root: {},
      running: new Set(['cur', 'other-window']),
      location,
    });

    const result = getRelatedRunningSessions(context as never, 'cur', new Map(), new Set());

    // undefined === undefined 不得成立：只统计 family 内的 cur，不误亮 sisyphus。
    expect(result.map((session) => session.id)).toEqual(['cur']);
  });

  test('session.agent 大小写差异仍能点亮（经 getRows 验证）', () => {
    const location = { directory: '/project' };
    const sessions: FakeSession[] = [
      { id: 's1', time: { created: 1 }, agent: 'Explorer', location },
    ];
    const context = makeContext({
      current: 's1',
      sessions,
      family: { s1: ['s1'] },
      root: { s1: 's1' },
      running: new Set(['s1']),
      location,
      agents: [
        { id: 'explorer', name: 'Explorer', mode: 'subagent' },
        { id: 'oracle', name: 'Oracle', mode: 'subagent' },
      ],
    });

    const rows = getRows(context as never, 's1', new Map(), new Set());
    const explorer = rows.find((row) => row.id === 'explorer');
    const oracle = rows.find((row) => row.id === 'oracle');
    expect(explorer?.active).toBe(true);
    expect(oracle?.active).toBe(false);
  });
});

describe('resolveDisplayModel 模型展示优先级', () => {
  const configModel = { id: 'anthropic/claude-sonnet', providerID: 'anthropic', variant: 'high' };
  const recallModel = { id: 'openai/gpt-5', providerID: 'openai', variant: 'low' };

  test('recall（live 模型）存在：display=recall、recalled=true，live 优先于配置', () => {
    expect(resolveDisplayModel(configModel, recallModel)).toEqual({
      display: 'gpt-5#low',
      recalled: true,
    });
  });

  test('recall 无 + 配置 model 存在：display=配置、recalled=false', () => {
    expect(resolveDisplayModel(configModel, undefined)).toEqual({
      display: 'claude-sonnet#high',
      recalled: false,
    });
  });

  test('都无：display=跟随会话、recalled=false', () => {
    expect(resolveDisplayModel(undefined, undefined)).toEqual({
      display: '跟随会话',
      recalled: false,
    });
  });

  test('仅 recall 存在：display=recall、recalled=true', () => {
    expect(resolveDisplayModel(undefined, recallModel)).toEqual({
      display: 'gpt-5#low',
      recalled: true,
    });
  });
});

describe('recordRecall 去重与最近一次胜出', () => {
  const agentA = { id: 'explorer', providerID: 'anthropic', variant: 'high' };

  test('undefined 不覆盖已有 recall，返回原引用', () => {
    const recalls = { explorer: agentA };
    expect(recordRecall(recalls, 'explorer', undefined)).toBe(recalls);
    expect(recordRecall(recalls, 'explorer', undefined)).toEqual(recalls);
  });

  test('同 agent 相同 model（新实例、按值全等）返回原引用', () => {
    const recalls = { explorer: agentA };
    const identicalNewInstance = { id: 'explorer', providerID: 'anthropic', variant: 'high' };
    expect(recordRecall(recalls, 'explorer', identicalNewInstance)).toBe(recalls);
  });

  test('同 agent 不同 model 更新为最近一次', () => {
    const recalls = { explorer: agentA };
    const newer = { id: 'openai/gpt-5', providerID: 'openai', variant: 'low' };
    const result = recordRecall(recalls, 'explorer', newer);
    expect(result).not.toBe(recalls);
    expect(result.explorer).toBe(newer);
  });

  test('不同 agent 互不影响', () => {
    const recalls = { explorer: agentA };
    const other = { id: 'fixer', providerID: 'deepseek' };
    const result = recordRecall(recalls, 'fixer', other);
    expect(result.explorer).toBe(agentA);
    expect(result.fixer).toBe(other);
  });
});

describe('getRows agent 白名单过滤', () => {
  const location = { directory: '/project' };

  test('非 ALL_AGENT_NAMES 的 agent 被过滤', () => {
    const agents = [
      { id: 'oceanus', name: 'oceanus', mode: 'primary' },
      { id: 'unknown-agent', name: 'Unknown Agent', mode: 'primary' },
    ];
    const sessions: Array<{
      id: string;
      time: { created: number };
      agent?: string;
      location: { directory: string };
    }> = [{ id: 's1', time: { created: 1 }, agent: 'oceanus', location }];

    const context = makeContext({
      current: 's1',
      sessions,
      family: { s1: ['s1'] },
      root: { s1: 's1' },
      running: new Set(['s1']),
      location,
      agents,
    });

    const rows = getRows(context as never, 's1', new Map(), new Set());
    expect(rows.map((row) => row.id)).toEqual(['oceanus']);
    expect(rows.some((row) => row.id === 'unknown-agent')).toBe(false);
  });
});

describe('sidebar preset 指纹轮询', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test('preset 变化触发 onChange；同值、undefined、dispose 后均不触发', async () => {
    let value: string | undefined = 'a';
    let calls = 0;
    const dispose = createPresetWatcher({
      read: () => value,
      intervalMs: 10,
      onChange: () => {
        calls += 1;
      },
    });

    // 基线期：值未变不触发
    await sleep(35);
    expect(calls).toBe(0);

    // 指纹变化 → 恰好一次
    value = 'b';
    await sleep(35);
    expect(calls).toBe(1);

    // 同值不触发（零开销承诺）
    value = 'b';
    await sleep(35);
    expect(calls).toBe(1);

    // undefined 视为指纹不变（fail-open：无法区分读失败与无配置）
    value = undefined;
    await sleep(35);
    expect(calls).toBe(1);

    // dispose 后彻底停止
    dispose();
    value = 'c';
    await sleep(35);
    expect(calls).toBe(1);
  });

  test('read 抛异常视为指纹不变，恢复后同值也不补触发', async () => {
    let shouldThrow = false;
    let calls = 0;
    const dispose = createPresetWatcher({
      read: () => {
        if (shouldThrow) throw new Error('read failed');
        return 'x';
      },
      intervalMs: 10,
      onChange: () => {
        calls += 1;
      },
    });

    await sleep(25);
    expect(calls).toBe(0);

    shouldThrow = true;
    await sleep(30);
    expect(calls).toBe(0);

    // 异常解除后读到相同指纹 → 不触发
    shouldThrow = false;
    await sleep(30);
    expect(calls).toBe(0);
    dispose();
  });
});

describe('readActivePresetName 用户级 preset 读取', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'oceanus-tui-preset-'));
    temporaryDirectories.push(directory);
    return directory;
  }

  test('用户级 opencode-oceanus.jsonc 顶层 preset → 返回该值', async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, 'opencode-oceanus.jsonc'),
      JSON.stringify(
        { preset: 'openai', presets: { openai: { agents: {} } } },
        null,
        2,
      ),
    );

    expect(readActivePresetName({ configDir: directory })).toBe('openai');
  });

  test('空目录（无用户级配置）→ undefined', async () => {
    const directory = await temporaryDirectory();

    expect(readActivePresetName({ configDir: directory })).toBeUndefined();
  });
});

describe('sidebar setup 非阻塞', () => {
  test('永不 resolve 的 agent.sync 不阻塞 setup，slot 仍即时挂载', async () => {
    const neverResolve = new Promise<never>(() => {});
    let mounted = false;
    const context = {
      ui: {
        slot: (opts: unknown) => {
          mounted = true;
          return opts;
        },
      },
      // 若未来有人在 setup 中 await agent.sync，此永不 resolve 的 promise 会挂住 setup。
      data: {
        location: { agent: { sync: () => neverResolve } },
      },
    };

    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('setup blocked on agent.sync')), 200),
    );
    const result = await Promise.race([setup(context as never), timer]);

    expect(mounted).toBe(true);
    expect(result).toBeDefined();
  });
});

describe('panel reactivity（宿主共享 solid tick 驱动）', () => {
  test('loadPanelReactivity 返回 bump/dynamic；bump 触发 keyed Show 重复执行 build', async () => {
    // 裸 'solid-js' 在 node 条件下解析为无响应式的 server 构建；显式注入
    // client 构建（与 @opentui/solid 相同的 dist/solid.js 路径）验证机制。
    const clientSolid = (await import('solid-js/dist/solid.js')) as unknown as {
      createRoot: (fn: () => void) => (() => void) | undefined;
      createRenderEffect: (fn: () => void) => void;
    };
    const reactivity = await loadPanelReactivity(
      clientSolid as never,
    );
    expect(reactivity).toBeDefined();
    expect(typeof reactivity!.bump).toBe('function');
    expect(typeof reactivity!.dynamic).toBe('function');

    let builds = 0;
    clientSolid.createRoot(() => {
      // 模拟宿主插入路径：tracked 作用域内读取 keyed Show 返回的 memo。
      clientSolid.createRenderEffect(() => {
        const tree = reactivity!.dynamic(() => {
          builds += 1;
          return undefined as never;
        });
        if (typeof tree === 'function') (tree as () => unknown)();
      });
    });
    expect(builds).toBe(1);

    reactivity!.bump();
    reactivity!.bump();
    expect(builds).toBe(3);
  });

  test('solid-js 不可用时 fail-open 返回 undefined（回退 requestRender 模式）', async () => {
    const reactivity = await loadPanelReactivity({} as never);
    expect(reactivity).toBeUndefined();
  });
});

describe('readConfigAgentModels 配置直读模型解析', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function withUserConfig(configSource: string): Promise<string> {
    process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'oceanus-cfg-')).then((d) => {
      dirs.push(d);
      return d;
    });
    const dir = await mkdtemp(join(tmpdir(), 'oceanus-dir-'));
    dirs.push(dir);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(process.env.XDG_CONFIG_HOME, 'opencode'), { recursive: true });
    await writeFile(join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode-oceanus.jsonc'), configSource);
    return dir;
  }

  test('解析 preset 合并后的各 agent 模型（字符串/数组/variant/别名）', async () => {
    const directory = await withUserConfig(
      JSON.stringify({
        preset: 'p',
        presets: {
          p: {
            oceanus: { model: 'prov/main-model' },
            oracle: { model: [{ id: 'prov/first', variant: 'high' }, 'prov/second'] },
            explore: { model: 'prov/aliased' },
            fixer: { model: 'no-slash' },
            librarian: {},
          },
        },
      }),
    );

    const models = readConfigAgentModels(directory);
    expect(models.oceanus).toEqual({ id: 'prov/main-model', providerID: 'prov', variant: undefined });
    expect(models.oracle).toEqual({ id: 'prov/first', providerID: 'prov', variant: 'high' });
    // legacy 别名 explore → explorer
    expect(models.explorer).toEqual({ id: 'prov/aliased', providerID: 'prov', variant: undefined });
    expect(models.fixer).toBeUndefined();
    expect(models.librarian).toBeUndefined();
    delete process.env.XDG_CONFIG_HOME;
  });

  test('无配置时返回空表', async () => {
    const directory = await withUserConfig('{}');
    expect(readConfigAgentModels(directory)).toEqual({});
    delete process.env.XDG_CONFIG_HOME;
  });
});


describe('normalizeAgentKey agent 标识规范化', () => {
  test('别名与大小写归一；未知名原样小写返回', () => {
    expect(normalizeAgentKey('Explorer')).toBe('explorer');
    expect(normalizeAgentKey('explore')).toBe('explorer');
    expect(normalizeAgentKey('ORACLE')).toBe('oracle');
    expect(normalizeAgentKey(undefined)).toBeUndefined();
    expect(normalizeAgentKey('custom-agent')).toBe('custom-agent');
  });
});

describe('decideCalibration 校准决策（host status 恒 idle 不再反向误杀）', () => {
  const now = 1_000_000_000;
  const staleRunningMs = 10 * 60 * 1000;

  test('host 恒 idle（现行宿主 data.status 缺省 ?? "idle"）且本地 running 新鲜 → keep，不反向清除', () => {
    // 回归主 bug：旧实现会把刚由 session.status busy 事件点亮的 running
    // 反向校正为 host 'idle'，导致第二次任务 ● 完全不再点亮。
    expect(
      decideCalibration({
        localRunning: true,
        hostRunning: false,
        lastEventAt: now - 1000,
        now,
        staleRunningMs,
      }),
    ).toBe('keep');
  });

  test('host 缺失（undefined）时 running 新鲜 → keep', () => {
    expect(
      decideCalibration({
        localRunning: true,
        hostRunning: undefined,
        lastEventAt: now - 1000,
        now,
        staleRunningMs,
      }),
    ).toBe('keep');
  });

  test('running 超过 staleRunningMs 无任何该会话事件 → clear-stale（滞留兜底）', () => {
    expect(
      decideCalibration({
        localRunning: true,
        hostRunning: false,
        lastEventAt: now - staleRunningMs - 1,
        now,
        staleRunningMs,
      }),
    ).toBe('clear-stale');
  });

  test('running 但无时间戳记录 → keep（不误杀未知时序）', () => {
    expect(
      decideCalibration({
        localRunning: true,
        hostRunning: false,
        lastEventAt: undefined,
        now,
        staleRunningMs,
      }),
    ).toBe('keep');
  });

  test('本地未亮 + host 明确 running → bump-running（正向补亮漏事件窗口）', () => {
    expect(
      decideCalibration({
        localRunning: false,
        hostRunning: true,
        lastEventAt: now - 1000,
        now,
        staleRunningMs,
      }),
    ).toBe('bump-running');
  });

  test('本地未亮 + host idle/缺失 → keep', () => {
    for (const hostRunning of [false, undefined]) {
      expect(
        decideCalibration({
          localRunning: false,
          hostRunning,
          lastEventAt: now - 1000,
          now,
          staleRunningMs,
        }),
      ).toBe('keep');
    }
  });
});

describe('panel reactivity 响应式自检', () => {
  test('信号不触发 effect（server 构建特征）→ 拒绝返回 undefined', async () => {
    let runs = 0;
    const fakeSolid = {
      createSignal: <T,>(_initial: T) => {
        let value = _initial;
        const read = () => value;
        const write = (update: (prev: T) => T) => {
          value = update(value);
          // server 构建特征：写入不通知任何订阅者。
        };
        return [read, write] as [() => T, (update: (prev: T) => T) => T];
      },
      createComponent: () => undefined,
      Show: {},
      createRoot: (fn: () => unknown) => {
        fn();
        return () => {};
      },
      createEffect: (fn: () => void) => {
        runs += 1;
        fn();
      },
    };
    const reactivity = await loadPanelReactivity(fakeSolid as never);
    expect(reactivity).toBeUndefined();
    expect(runs).toBeGreaterThan(0);
  });

  test('缺省 createEffect/createRoot 的注入表面跳过自检仍被接受（旧契约）', async () => {
    const minimal = {
      createSignal: <T,>(initial: T) => {
        let value = initial;
        return [
          () => value,
          (update: (prev: T) => T) => {
            value = update(value);
          },
        ] as [() => T, (update: (prev: T) => T) => T];
      },
      createComponent: () => undefined,
      Show: {},
    };
    const reactivity = await loadPanelReactivity(minimal as never);
    expect(reactivity).toBeDefined();
    expect(typeof reactivity!.bump).toBe('function');
  });
});

describe('宿主 store 驱动刷新（beta-prime observer）', () => {
  test('零事件下宿主状态更新触发面板重建（点亮与熄灭双向）', async () => {
    // bun test 环境下 loadPanelReactivity 第二候选命中 client solid（裸名在
    // node 条件解析 server 构建被自检拒绝），与真实宿主共享实例机制等价：
    // 同一 graph 内 effect 读宿主 data 域（solid store）驱动 bump。
    // 沙箱实验对照（2026-09-11，真实 dist 产物）：无 observer 时 store 更新后
    // 面板重建 0 次；有 observer 则重建且点亮/熄灭双向传播。
    const solidClient = (await import('solid-js/dist/solid.js')) as unknown as {
      createSignal: <T>(initial: T) => [() => T, (update: (prev: T) => T) => T];
      createRoot: (fn: (dispose: () => void) => unknown) => unknown;
    };
    let listReads = 0;
    const sessions: FakeSession[] = [
      { id: 'root1', agent: 'oceanus', time: { created: 1 }, location: { directory: '/w' } },
      { id: 'child1', agent: 'explorer', time: { created: 2 }, location: { directory: '/w' } },
    ];
    // mock data 域必须读 signal（等价宿主读 solid store），依赖才能建立。
    const [active, setActive] = solidClient.createSignal<Record<string, string>>({
      root1: 'idle',
      child1: 'idle',
    });
    const agents = [
      { id: 'oceanus', name: 'oceanus', mode: 'primary' },
      { id: 'explorer', name: 'explorer', mode: 'subagent' },
    ];
    let renderFn: ((input: { sessionID: string }) => unknown) | undefined;
    const context = {
      location: { directory: '/w' },
      theme: { text: '#fff', textMuted: '#888' },
      renderer: { requestRender() {} },
      app: { version: 't', channel: 't' },
      client: {},
      ui: {
        slot: (opts: { render: (input: { sessionID: string }) => unknown }) => {
          renderFn = opts.render;
          return () => {};
        },
      },
      data: {
        on: () => () => {},
        session: {
          list: () => {
            listReads += 1;
            return sessions;
          },
          get: (id: string) => sessions.find((session) => session.id === id),
          root: (id: string) => (id === 'child1' ? 'root1' : id),
          family: (id: string) => (id === 'root1' ? ['root1', 'child1'] : [id]),
          status: (id: string) => active()[id] ?? 'idle',
          sync: () => Promise.resolve(),
          invalidate() {},
          pending: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          message: { list: () => [], get: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
          permission: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          form: { list: () => [], sync: () => Promise.resolve(), invalidate() {}, reply() {}, cancel() {} },
        },
        project: { list: () => [], get: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
        shell: { list: () => [], get: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
        location: {
          default: () => ({ directory: '/w' }),
          sync: () => Promise.resolve(),
          invalidate() {},
          vcs: { info: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
          agent: { list: () => agents, sync: () => Promise.resolve(), invalidate() {} },
          command: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          integration: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          mcp: {
            server: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
            resource: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          },
          model: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          provider: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          reference: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          skill: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
        },
      },
    };
    const dispose = await setup(context as never);
    try {
      // 不挂载真面板树（keyed Show children 会走真 jsxDEV，测试环境无
      // OpenTUI renderer 会抛错——真实宿主有 renderer 不受影响）。observer
      // 在 wirePanel 内独立挂载，其读取面重跑即证明「store 更新 → effect
      // → bump」链路；keyed Show 重建行为由既有 reactivity 用例覆盖。
      // 等 observer effect 首跑建立依赖（solid effect 微任务级调度）。
      await new Promise((resolve) => setTimeout(resolve, 20));
      const before = listReads;
      // 模拟宿主 store 更新（execution 事件写入宿主 store / server.connected
      // 重灌），插件侧零事件——唯一重跑源应是 beta-prime observer。
      setActive({ root1: 'idle', child1: 'running' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(listReads).toBeGreaterThan(before);

      // 熄灭方向：store 回到 idle 后计算面收敛（getRows 纯计算，不碰 jsxDEV）。
      setActive({ root1: 'idle', child1: 'idle' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const rows = getRows(context as never, 'root1', new Map(), new Set());
      expect(rows.find((row) => row.id === 'explorer')?.active).toBe(false);
      setActive({ root1: 'idle', child1: 'running' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const litRows = getRows(context as never, 'root1', new Map(), new Set());
      expect(litRows.find((row) => row.id === 'explorer')?.active).toBe(true);
    } finally {
      await dispose();
    }
  });
});

describe('权威快照正向补亮（alpha：steer 事件缺口）', () => {
  test('run 进行中 steer 输入无 execution 事件时，active 快照补亮点亮', async () => {
    // beta-19296 受控实测（2026-09-11）：run 进行中以 steer 语义提交的输入
    // 只发 session.inbox.enqueued，不发 execution.started / inbox.delivered
    // ——localStatuses 与 host store 双 idle 而 server 端 run 实际在跑。
    // 唯一正确事实源是 /api/session/active 权威快照（client.session.active）。
    const solidClient = (await import('solid-js/dist/solid.js')) as unknown as {
      createSignal: <T>(initial: T) => [() => T, (update: (prev: T) => T) => T];
    };
    const [active] = solidClient.createSignal<Record<string, string>>({
      root1: 'idle',
      child1: 'idle',
    });
    const sessions: FakeSession[] = [
      { id: 'root1', agent: 'oceanus', time: { created: 1 }, location: { directory: '/w' } },
      { id: 'child1', agent: 'explorer', time: { created: 2 }, location: { directory: '/w' } },
    ];
    const agents = [
      { id: 'oceanus', name: 'oceanus', mode: 'primary' },
      { id: 'explorer', name: 'explorer', mode: 'subagent' },
    ];
    const handlers = new Map<string, (event: unknown) => void>();
    let activeSnapshot: Record<string, { type: 'running' }> = {};
    let renderCalls = 0;
    const context = {
      location: { directory: '/w' },
      theme: { text: '#fff', textMuted: '#888' },
      renderer: {
        requestRender() {
          renderCalls += 1;
        },
      },
      app: { version: 't', channel: 't' },
      client: {
        session: {
          active: () => Promise.resolve(activeSnapshot),
        },
      },
      ui: { slot: () => () => {} },
      data: {
        on: (type: string, handler: (event: unknown) => void) => {
          handlers.set(type, handler);
          return () => {};
        },
        session: {
          list: () => sessions,
          get: (id: string) => sessions.find((session) => session.id === id),
          root: (id: string) => (id === 'child1' ? 'root1' : id),
          family: (id: string) => (id === 'root1' ? ['root1', 'child1'] : [id]),
          status: (id: string) => active()[id] ?? 'idle',
          sync: () => Promise.resolve(),
          invalidate() {},
          pending: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          message: { list: () => [], get: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
          permission: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          form: { list: () => [], sync: () => Promise.resolve(), invalidate() {}, reply() {}, cancel() {} },
        },
        project: { list: () => [], get: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
        shell: { list: () => [], get: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
        location: {
          default: () => ({ directory: '/w' }),
          sync: () => Promise.resolve(),
          invalidate() {},
          vcs: { info: () => undefined, sync: () => Promise.resolve(), invalidate() {} },
          agent: { list: () => agents, sync: () => Promise.resolve(), invalidate() {} },
          command: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          integration: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          mcp: {
            server: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
            resource: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          },
          model: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          provider: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          reference: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
          skill: { list: () => [], sync: () => Promise.resolve(), invalidate() {} },
        },
      },
    };
    const dispose = await setup(context as never);
    try {
      // 初始：无任何事件、快照为空 → 不亮。
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(
        getRows(context as never, 'root1', new Map(), new Set()).find((row) => row.id === 'explorer')?.active,
      ).toBe(false);

      // steer 缺口场景：server 端 child1 在跑（权威快照），但插件侧零执行
      // 事件、host store 也 idle。server.connected 触发快照补亮。
      activeSnapshot = { child1: { type: 'running' } };
      handlers.get('server.connected')?.({});
      // scheduleFlush 的 80ms trailing 窗口后 commit → requestRender。
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(renderCalls).toBeGreaterThan(0);

      // 校正结果可直接观察：纯函数 applyActiveSnapshot 已把 child1 写为
      // running（与上述管线共用同一实现）。
      const localStatuses = new Map<string, unknown>();
      expect(applyActiveSnapshot(
        { localStatuses, deletedSessionIDs: new Set<string>() },
        Object.keys(activeSnapshot),
        new Map<string, number>(),
        Date.now(),
      )).toBe(true);
      expect(localStatuses.get('child1')).toBe('running');
      // 已 running 的会话不再变更（幂等，changed=false）。
      expect(applyActiveSnapshot(
        { localStatuses, deletedSessionIDs: new Set<string>() },
        Object.keys(activeSnapshot),
        new Map<string, number>(),
        Date.now(),
      )).toBe(false);
    } finally {
      await dispose();
    }
  });
});
