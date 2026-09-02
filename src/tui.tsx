import { Plugin } from '@opencode-ai/plugin/tui';
import type { SessionStatus as EventSessionStatus } from '@opencode-ai/client';
import type { Context } from '@opencode-ai/plugin/tui/plugin';
import type { JSX } from '@opentui/solid';
import { watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { ALL_AGENT_NAMES, AGENT_ALIASES } from './config/constants';
import { loadPluginConfig } from './config/loader';
import { getUserPresetConfigPath, readUserConfig } from './config/presets';

type ModelRef = {
  id: string;
  providerID: string;
  variant?: string;
};

type AgentRow = {
  id: string;
  name: string;
  mode: string;
  color?: string;
  model?: ModelRef;
  active: boolean;
  display?: string;
  recalled?: boolean;
};

type ContextSessionStatus = ReturnType<Context['data']['session']['status']>;
type LocalSessionStatus = ContextSessionStatus | EventSessionStatus;

const OCEANUS_AGENT_NAMES = new Set<string>(ALL_AGENT_NAMES);
const SIDEBAR_ACCENT = '#0FFFFF';

export function shortModelName(model: string): string {
  return model
    .replace(/^anthropic\//, '')
    .replace(/^openai\//, '')
    .replace(/^google\//, '')
    .replace(/^github-copilot\//, 'copilot/');
}

/**
 * 侧边栏模型展示：基于 ModelRef 结构去掉 provider，只显示模型名（+variant）。
 * 与 shortModelName 的区别：这里直接按 providerID 字段剥离，而非字符串前缀猜测，
 * 因此 deepseek/ollama 等任意 provider 都不再显示前缀。
 */
export function bareModelName(model: ModelRef | undefined): string {
  if (!model) return '跟随会话';

  const modelName = model.id.includes('/')
    ? model.id.split('/').at(-1) ?? model.id
    : model.id;
  return model.variant ? `${modelName}#${model.variant}` : modelName;
}

/**
 * 侧边栏模型展示优先级：
 * 1. recall（该 agent 最近一次实际使用的模型，含会话内 /models 或派生时
 *    的 switchModel）存在 → 显示 live 模型并带 `*` 标记——oceanus/sisyphus
 *    等主 agent 会自主切换模型，live 状态优先于配置文件；
 * 2. recall 无 + 配置 model 存在 → 显示配置；
 * 3. 都无 → 跟随会话。
 */
export function resolveDisplayModel(
  configModel: ModelRef | undefined,
  recall: ModelRef | undefined,
): { display: string; recalled: boolean } {
  if (recall) {
    return { display: bareModelName(recall), recalled: true };
  }
  if (configModel) {
    return { display: bareModelName(configModel), recalled: false };
  }
  return { display: '跟随会话', recalled: false };
}

/**
 * 记录最近一次使用的 model（不可变，供 Wave 2 复用）。
 * - model 为 undefined → 不覆盖已有 recall，返回原引用；
 * - 同 agent 相同 model（按 id/providerID/variant 值比较）→ 返回原引用；
 * - 否则更新该 agent 的 recall（最近一次使用胜出），返回新对象。
 */
export function recordRecall(
  recalls: Record<string, ModelRef>,
  agentID: string,
  model: ModelRef | undefined,
): Record<string, ModelRef> {
  if (!model) return recalls;

  const existing = recalls[agentID];
  const sameModel =
    existing &&
    existing.id === model.id &&
    existing.providerID === model.providerID &&
    existing.variant === model.variant;

  if (sameModel) return recalls;

  return { ...recalls, [agentID]: model };
}

export function sortAgentRows<T extends { id: string }>(agents: T[]): T[] {
  return [...agents].sort((left, right) => {
    const leftIndex = ALL_AGENT_NAMES.indexOf(left.id as (typeof ALL_AGENT_NAMES)[number]);
    const rightIndex = ALL_AGENT_NAMES.indexOf(right.id as (typeof ALL_AGENT_NAMES)[number]);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
}

/**
 * preset 指纹监听器：优先 fs.watch 事件驱动（去抖 100ms），低频轮询兜底。
 *
 * 兜底原因：某些文件系统（NFS/容器挂载）上 fs.watch 不可靠或根本不触发；
 * 轮询继续按 intervalMs 比较，同值零副作用，两者共用同一条指纹比较逻辑，
 * 不会重复触发 onChange。
 *
 * 契约：
 * - 首次同步 read 作为基线指纹，不触发 onChange；
 * - read 抛异常或返回 undefined 时视为指纹不变（fail-open：无法区分
 *   读盘失败与"配置无 preset"，宁可少刷不多刷）；
 * - 指纹变化 → 恰好调用一次 onChange 并更新基线；
 * - 返回 dispose 清理定时器与 watcher。
 */
export function createPresetWatcher(options: {
  read: () => string | undefined;
  intervalMs?: number;
  /** 提供时启用 fs.watch 事件驱动（推荐传用户级配置文件路径）。 */
  watchPath?: string;
  onChange: () => void;
}): () => void {
  const { read, intervalMs = 2000, watchPath, onChange } = options;
  let baseline: string | undefined;
  try {
    baseline = read();
  } catch {
    baseline = undefined;
  }
  const compare = () => {
    let next: string | undefined;
    try {
      next = read();
    } catch {
      return;
    }
    if (next === undefined || next === baseline) return;
    baseline = next;
    onChange();
  };
  const timer = setInterval(compare, intervalMs);
  let watcher: ReturnType<typeof watch> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  if (watchPath) {
    try {
      // 监听目录而非文件：原子写（tmp + rename）会替换 inode，直接 watch
      // 文件在 rename 后会与目标脱钩（后续变更丢失）；watch 目录 + 按
      // 文件名过滤对 rename/create/write 都稳定触发。
      const directory = dirname(watchPath);
      const fileName = basename(watchPath);
      const schedule = () => {
        // 原子写（tmp+rename）会触发多次事件；去抖后比较指纹，同值不触发。
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = undefined;
          compare();
        }, 100);
      };
      watcher = watch(directory, (_event, changedFile) => {
        // 目录级事件需过滤：只关心目标配置文件本身与其 tmp 中间文件（rename
        // 两端都可能以不同名字出现）。
        if (!changedFile || changedFile === fileName || changedFile.startsWith(`.${fileName}.`)) {
          schedule();
        }
      });
      watcher.on('error', () => {
        // watch 失败（目录被删/FS 不支持）→ 仅剩轮询兜底。
        try {
          watcher?.close();
        } catch {
          /* noop */
        }
        watcher = undefined;
      });
    } catch {
      // watch 不可用 → 轮询兜底。
      watcher = undefined;
    }
  }
  return () => {
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    try {
      watcher?.close();
    } catch {
      /* noop */
    }
  };
}

/**
 * 读取当前生效 preset：仅读用户级全局配置顶层 `preset`，
 * 与 /preset 命令的写入目标（用户级）保持一致。
 * 读取失败或未配置时返回 undefined（宁可少刷不多刷）。
 */
export function readActivePresetName(options?: { configDir?: string }): string | undefined {
  try {
    const preset = readUserConfig(getUserPresetConfigPath(options?.configDir)).preset;
    return typeof preset === 'string' ? preset : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 读取当前生效配置（含 preset 合并）中各 agent 的模型，解析为 ModelRef。
 * 直接读盘、同步、无网络——preset 切换瞬间即可用于 sidebar 展示，
 * 不必等待 server 侧 agent registry 重建。读取失败返回空表（回落 registry）。
 */
export function readConfigAgentModels(directory: string): Record<string, ModelRef> {
  try {
    const agents = loadPluginConfig({ directory }).agents ?? {};
    const result: Record<string, ModelRef> = {};
    for (const [name, override] of Object.entries(agents)) {
      const model = override?.model;
      let id: string | undefined;
      let variant: string | undefined;
      if (typeof model === 'string') {
        id = model;
      } else if (Array.isArray(model) && model.length > 0) {
        const first = model[0];
        if (typeof first === 'string') id = first;
        else {
          id = first?.id;
          if (typeof first?.variant === 'string') variant = first.variant;
        }
      }
      if (!id || !id.includes('/')) continue;
      if (override?.variant && !variant) variant = override.variant;
      const [providerID, ...rest] = id.split('/');
      if (!rest.length) continue;
      result[AGENT_ALIASES[name] ?? name] = {
        id,
        providerID,
        variant: variant || undefined,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function sameLocation(left: { directory: string; workspaceID?: string } | undefined, right: { directory: string; workspaceID?: string } | undefined): boolean {
  if (!left || !right) return false;
  return left.directory === right.directory && left.workspaceID === right.workspaceID;
}

function matchesAgent(agent: { id: string; name: string }, agentID: string | undefined): boolean {
  return agent.id === agentID || agent.name === agentID;
}

function isRunningStatus(status: LocalSessionStatus): boolean {
  return typeof status === 'string' ? status === 'running' : status.type !== 'idle';
}

export function getRelatedRunningSessions(context: Context, sessionID: string, localStatuses: Map<string, LocalSessionStatus>, deletedSessionIDs: Set<string>) {
  const familyIDs = new Set(context.data.session.family(sessionID) ?? []);
  familyIDs.add(sessionID);

  const rootID = context.data.session.root(sessionID);

  // 仅统计当前会话及其子会话族，避免同一目录下其它窗口的会话把 agent 标记为活跃。
  return context.data.session.list()
    .filter((session) => {
      if (deletedSessionIDs.has(session.id)) return false;

      const isFamilySession = familyIDs.has(session.id) || context.data.session.root(session.id) === rootID;
      if (!isFamilySession) return false;

      const status = localStatuses.get(session.id) ?? context.data.session.status(session.id);
      return isRunningStatus(status);
    })
    .sort((left, right) => left.time.created - right.time.created);
}

export function getRows(context: Context, sessionID: string, localStatuses: Map<string, LocalSessionStatus>, deletedSessionIDs: Set<string>, recalls?: Record<string, ModelRef>, configModels?: Record<string, ModelRef>) {
  const agents = listAgents(context);
  const activeSessions = getRelatedRunningSessions(context, sessionID, localStatuses, deletedSessionIDs);

  return sortAgentRows(agents.filter((agent) => OCEANUS_AGENT_NAMES.has(agent.id) || OCEANUS_AGENT_NAMES.has(agent.name)))
    .map((agent) => {
      const resolved = resolveDisplayModel(agent.model, recalls?.[agent.id]);
      // 配置（含 preset 合并，直接读盘）优先于 registry 快照：preset 切换
      // 瞬间即显示新模型，不等 server 侧 registry 重建；registry 重建后两者收敛。
      const configModel = configModels?.[agent.id] ?? configModels?.[agent.name];
      const resolvedDisplay = configModel
        ? resolveDisplayModel(configModel, recalls?.[agent.id])
        : resolved;
      return {
        id: agent.id,
        name: agent.name,
        mode: agent.mode,
        color: agent.color,
        model: configModel ?? agent.model,
        active: activeSessions.some((session) => matchesAgent(agent, session.agent)),
        display: resolvedDisplay.display,
        recalled: resolvedDisplay.recalled,
      };
    });
}

/**
 * 面板可变状态与刷新机制（beta-18721+ 宿主契约）：
 *
 * 宿主 SlotHost 把 claim 的 render 作为 Solid 组件一次性挂载（反编译证据：
 * `Zl(a.render, Use(s))`），只在 claim 集合变化、slot 重挂载或 slot input
 * （仅 `{sessionID}`）变化时重新执行；`renderer.requestRender()` 只调度一帧
 * 重绘，不会重跑组件函数。因此"普通可变状态 + requestRender"不再触发面板
 * 重算（表现为 ● 活跃标记长期滞留，切会话/侧栏重挂载才刷新）。
 *
 * 现行机制：宿主插件运行时把 `solid-js`/`@opentui/solid` 别名到宿主自身
 * 实例，插件的信号与宿主共享同一 reactive graph。事件合并刷新时递增 tick
 * 信号，keyed Show 的 when getter 读取 tick 建立依赖，tick 变化即整树重建。
 * 旧宿主/测试环境无 solid-js 时 fail-open 回退为纯 requestRender 模式。
 */
interface PanelState {
  /** 最近一次 render 的 sessionID（事件过滤用，render 入口更新）。 */
  sessionID: string;
  localStatuses: Map<string, LocalSessionStatus>;
  deletedSessionIDs: Set<string>;
  recalls: Record<string, ModelRef>;
  presetName: string | undefined;
  configModels: Record<string, ModelRef>;
  /** tick 信号驱动器；undefined 表示宿主无共享 solid 实例（回退模式）。 */
  reactivity?: PanelReactivity;
}

/**
 * 宿主共享 solid 实例的最小结构化表面（避免硬依赖 solid-js 类型）。
 * solid-js 为 optional peer，缺失时不得影响插件加载，故经动态 import 探测。
 */
type SolidModuleSurface = {
  createSignal: <T>(initial: T) => [() => T, (update: (prev: T) => T) => T];
  createComponent: (component: unknown, props: unknown) => JSX.Element;
  Show: unknown;
};

interface PanelReactivity {
  /** 递增 tick：触发 keyed Show 重建整棵面板树。 */
  bump: () => void;
  /** 包裹静态 JSX 构建器：when getter 读取 tick 建立依赖，变化时重建 children。 */
  dynamic: (build: () => JSX.Element) => JSX.Element;
}

/** 探测宿主共享 solid 实例；不可用时返回 undefined（fail-open 回退）。 */
export async function loadPanelReactivity(injected?: SolidModuleSurface): Promise<PanelReactivity | undefined> {
  // solid-js 的 node/worker 导出条件指向 server 构建（SSR，信号无响应式），
  // 客户端真实响应式在 dist/solid.js（@opentui/solid 同款导入路径）。加载顺序：
  // 1. 显式 client 子路径：裸宿主/测试环境可用；
  // 2. 裸 'solid-js'：opencode2 宿主别名表（"solid-js" → 宿主共享实例）拦截
  //    该 specifier，子路径反而不被重写；
  // 3. 两者皆失败（旧宿主无 solid-js）→ undefined 回退 requestRender 模式。
  const tryImport = async (specifier: string): Promise<SolidModuleSurface | undefined> => {
    try {
      const mod = (await import(specifier)) as unknown as SolidModuleSurface;
      return typeof mod.createSignal === 'function' && typeof mod.createComponent === 'function'
        ? mod
        : undefined;
    } catch {
      return undefined;
    }
  };
  const solid = injected ?? (await tryImport('solid-js/dist/solid.js')) ?? (await tryImport('solid-js'));
  if (
    !solid ||
    typeof solid.createSignal !== 'function' ||
    typeof solid.createComponent !== 'function'
  ) {
    return undefined;
  }
  // tick 从 1 起：keyed Show 的 when 为 falsy 时不渲染 children。
  const [readTick, writeTick] = solid.createSignal(1);
  return {
    bump: () => {
      writeTick((tick) => tick + 1);
    },
    dynamic: (build) =>
      solid.createComponent(solid.Show, {
        keyed: true,
        get when() {
          return readTick();
        },
        // 必须声明形参：solid 只把 child.length > 0 的函数视为 render prop，
        // keyed 模式下 when 变化时以新 tick 值重复调用（零参函数会被原样
        // 返回、不求值）。
        children: (_tickValue: number) => build(),
      }),
  };
}

interface PanelWire {
  dispose: () => void;
}

function wirePanel(context: Context, reactivity?: PanelReactivity): PanelWire {
  // 热重载代际护栏：宿主按 mtime 重载插件时可能不清理旧代际的订阅，
  // 监听器会随代际堆积（事件被重复处理）。globalThis 上保留当前代际的
  // dispose，新代际启动前先释放旧代际，保证同进程只有一代存活。
  const holder = globalThis as typeof globalThis & { __oceanusPanelWire?: () => void };
  holder.__oceanusPanelWire?.();
  holder.__oceanusPanelWire = undefined;
  const state: PanelState = {
    sessionID: '',
    localStatuses: new Map(),
    deletedSessionIDs: new Set(),
    recalls: {},
    presetName: readActivePresetName(),
    configModels: {},
    reactivity,
  };
  const directory = () => context.location?.directory ?? process.cwd();

  // ── 刷新合并（coalescing）──
  // 事件（status/execution/inbox/model 等）在流式任务中高频到达；若每个
  // 事件都触发"读盘×2 + session.sync + 全量重绘"，开销随事件数线性放大。
  // 这里把刷新合并到 trailing 窗口：一批事件只做一次读盘与重绘；preset
  // 切换等需要即时反馈的路径调用 flushNow() 立即执行。
  const FLUSH_DELAY_MS = 80;
  const dirtySessions = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushScheduled = false;
  const runFlush = async () => {
    flushScheduled = false;
    flushTimer = undefined;
    state.presetName = readActivePresetName();
    state.configModels = readConfigAgentModels(directory());
    const pending = [...dirtySessions];
    dirtySessions.clear();
    const commit = () => {
      // tick 信号优先：宿主共享 reactive graph 里重建面板树（beta-18721+
      // 契约）；requestRender 兜底旧宿主/无 solid 实例时的重绘请求。
      state.reactivity?.bump();
      try {
        context.renderer?.requestRender?.();
      } catch {
        /* 渲染器不可用时忽略（下次宿主重绘自然带上） */
      }
    };
    // 先立即渲染一次：事件回调已同步更新 localStatuses，无需等网络。
    commit();
    // 等待 session.sync 把新/变更会话的 info（agent 字段、parentID 家族关系）
    // 写入 host store 后再补一次渲染；否则本次渲染读到的 session.list()
    // 可能缺少刚创建的子会话，● 标记要等下一个事件才出现。
    const sync = context.data?.session?.sync;
    if (!sync || pending.length === 0) return;
    await Promise.allSettled(
      pending.map((sessionID) =>
        Promise.resolve(sync(sessionID)).catch(() => undefined),
      ),
    );
    commit();
  };
  const flushNow = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    runFlush();
  };
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    flushTimer = setTimeout(() => {
      // trailing 窗口内最后一批事件落地时执行。
      runFlush();
    }, FLUSH_DELAY_MS);
  };
  const refreshAgents = () => {
    // 旧实现在组件 onMount 中调用；部分宿主/测试的 agent 集合可能缺少
    // invalidate/sync，逐项防御，缺失时仅刷新本地状态。
    const agentCollection = context.data?.location?.agent as
      | { invalidate?: (l: unknown) => void; sync?: (l: unknown) => Promise<void> }
      | undefined;
    try {
      agentCollection?.invalidate?.(context.location);
    } catch {
      /* noop */
    }
    void agentCollection?.sync?.(context.location)
      ?.catch(() => undefined)
      .finally(scheduleFlush);
  };

  const pendingRefreshes = new Set<ReturnType<typeof setTimeout>>();
  const refreshAgentsLater = (delayMs: number) => {
    const timer = setTimeout(() => {
      pendingRefreshes.delete(timer);
      refreshAgents();
    }, delayMs);
    pendingRefreshes.add(timer);
  };

  // preset 指纹监听：fs.watch 事件驱动（去抖 100ms）+ 1s 轮询兜底。
  // 变化时：立即 refreshData（配置直读，不等 server registry），再刷新
  // agent 列表，并在 server 侧 registry 重建窗口后补一次。
  const disposePresetWatcher = createPresetWatcher({
    read: () => readActivePresetName(),
    intervalMs: 1000,
    watchPath: getUserPresetConfigPath(),
    onChange: () => {
      flushNow();
      refreshAgents();
      refreshAgentsLater(3000);
    },
  });

  const calibrateStatus = (sessionID?: string) => {
    if (!sessionID) {
      scheduleFlush();
      return;
    }
    // 会话数据校准合并进刷新窗口：sync 网络请求随批次执行，不逐事件发起。
    dirtySessions.add(sessionID);
    scheduleFlush();
  };
  const setLocalStatus = (sessionID: string, status: LocalSessionStatus) => {
    state.deletedSessionIDs.delete(sessionID);
    state.localStatuses.set(sessionID, status);
  };
  const removeLocalStatus = (sessionID: string) => {
    state.localStatuses.delete(sessionID);
    state.deletedSessionIDs.add(sessionID);
  };

  // 宿主/测试环境可能缺少事件总线：on 缺失时注册为 noop，其余能力不受影响。
  const onData = (type: string, handler: (event: any) => void): (() => void) => {
    const on = (context.data as
      | { on?: (type: string, handler: (event: any) => void) => (() => void) | undefined }
      | undefined
    )?.on;
    return on ? on(type, handler) ?? (() => {}) : () => {};
  };
  const cleanups = [
    onData('agent.updated', (event) => {
      if (!event.location || sameLocation(event.location, context.location)) {
        refreshAgents();
      }
    }),
    // 子会话创建即纳入同步窗口：session.list() 初始不含新会话，等 host store
    // 自行 sync 是异步且无同步点的；订阅 session.created 让插件在创建瞬间就
    // 把它加入 dirtySessions 并触发 flush，● 活跃标记随之及时点亮。
    onData('session.created', (event) => {
      calibrateStatus(event.data.sessionID);
    }),
    onData('session.inbox.delivered', (event) => {
      // 输入被投递即视为该会话进入执行；同时触发轻量数据刷新。
      setLocalStatus(event.data.sessionID, 'running');
      calibrateStatus(event.data.sessionID);
    }),
    onData('session.idle', (event) => {
      // 宿主判定会话空闲（执行结束的权威信号），立即清除 running 标记。
      setLocalStatus(event.data.sessionID, 'idle');
      calibrateStatus(event.data.sessionID);
    }),
    onData('session.status', (event) => {
      setLocalStatus(event.data.sessionID, event.data.status);
      calibrateStatus(event.data.sessionID);
    }),
    onData('session.execution.started', (event) => {
      setLocalStatus(event.data.sessionID, 'running');
      calibrateStatus(event.data.sessionID);
    }),
    // subagent（后台会话）结束时不一定广播 session.idle，execution 终态
    // 事件是清除 ● running 标记的必要信号，不能省。
    onData('session.execution.succeeded', (event) => {
      setLocalStatus(event.data.sessionID, 'idle');
      calibrateStatus(event.data.sessionID);
    }),
    onData('session.execution.failed', (event) => {
      setLocalStatus(event.data.sessionID, 'idle');
      calibrateStatus(event.data.sessionID);
    }),
    onData('session.execution.interrupted', (event) => {
      setLocalStatus(event.data.sessionID, 'idle');
      calibrateStatus(event.data.sessionID);
    }),
    onData('session.agent.selected', (event) => {
      calibrateStatus(event.data.sessionID);

      const family = new Set(listSessionFamily(context, state.sessionID));
      family.add(state.sessionID);
      if (!family.has(event.data.sessionID)) return;

      const agent = listAgents(context).find(
        (candidate) => candidate.id === event.data.agent || candidate.name === event.data.agent,
      );
      if (!agent) return;

      if (state.recalls[agent.id]) {
        const { [agent.id]: _removed, ...rest } = state.recalls;
        state.recalls = rest;
        }
    }),
    onData('session.model.selected', (event) => {
      calibrateStatus(event.data.sessionID);

      const family = new Set(listSessionFamily(context, state.sessionID));
      family.add(state.sessionID);
      if (!family.has(event.data.sessionID)) return;

      const sessionAgent = (context.data?.session as { get?: (id: string) => { agent?: string } | undefined } | undefined)
        ?.get?.(event.data.sessionID)?.agent;
      const agent = listAgents(context).find(
        (candidate) => candidate.id === sessionAgent || candidate.name === sessionAgent,
      );
      if (!agent) return;

      const next = recordRecall(state.recalls, agent.id, event.data.model);
      if (next !== state.recalls) {
        state.recalls = next;
        }
    }),
    onData('session.deleted', (event) => {
      removeLocalStatus(event.data.sessionID);
      calibrateStatus(event.data.sessionID);
    }),
  ];

  panelStateOf.set(context, state);

  refreshAgents();

  const dispose = () => {
    if (flushTimer) clearTimeout(flushTimer);
    disposePresetWatcher();
    pendingRefreshes.forEach((timer) => clearTimeout(timer));
    pendingRefreshes.clear();
    cleanups.forEach((cleanup) => cleanup());
    panelStateOf.delete(context);
    if (holder.__oceanusPanelWire === dispose) holder.__oceanusPanelWire = undefined;
  };
  holder.__oceanusPanelWire = dispose;
  return { dispose };
}

/** context → 面板状态映射（setup 与 slot render 之间共享）。 */
const panelStateOf = new WeakMap<Context, PanelState>();

/** 防御式读取 agent 列表（测试/老宿主缺少集合时返回空）。 */
interface SidebarAgent {
  id: string;
  name: string;
  mode?: string;
  color?: string;
  model?: ModelRef;
}

function listAgents(context: Context): SidebarAgent[] {
  const collection = context.data?.location?.agent as
    | { list?: (location: unknown) => SidebarAgent[] | undefined }
    | undefined;
  try {
    return collection?.list?.(context.location) ?? [];
  } catch {
    return [];
  }
}

/** 防御式读取会话族（测试/老宿主缺少 session API 时返回空）。 */
function listSessionFamily(context: Context, sessionID: string): string[] {
  const session = context.data?.session as
    | { family?: (id: string) => string[] | undefined }
    | undefined;
  try {
    return session?.family?.(sessionID) ?? [];
  } catch {
    return [];
  }
}

/**
 * 静态 JSX 构建：读取最新状态重建整棵树（无表达式级响应式——Bun 的 TSX
 * 转换急切求值 props/children，响应式由 PanelReactivity 的 keyed Show 承担）。
 */
function buildPanelTree(context: Context, state: PanelState): JSX.Element {
  const theme = context.theme;
  const rows = getRows(
    context,
    state.sessionID,
    state.localStatuses,
    state.deletedSessionIDs,
    state.recalls,
    state.configModels,
  );
  const hasRows = rows.length > 0 || Object.keys(state.recalls).length > 0;

  return (
    <box
      flexDirection="column"
      gap={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={SIDEBAR_ACCENT}><b>Oceanus</b></text>
        {state.presetName ? (
          <text fg={theme.textMuted}>{state.presetName}</text>
        ) : (
          <text>&nbsp;</text>
        )}
      </box>

      <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={0}>
        {hasRows ? (
          rows.map((row) => {
            const resolved = resolveDisplayModel(row.model, state.recalls[row.id]);
            return (
              <box flexDirection="row" justifyContent="space-between" gap={1}>
                <text fg={row.active ? theme.text : theme.textMuted} flexShrink={0}>
                  <span style={{ fg: row.color ?? (row.mode === 'primary' ? SIDEBAR_ACCENT : theme.textMuted) }}>
                    {row.active ? '●' : '○'}
                  </span>{' '}
                  {row.name}
                </text>
                <text fg={(row.model || resolved.recalled) ? theme.text : theme.textMuted}>
                  {resolved.recalled ? '*' : ''}{resolved.display}
                </text>
              </box>
            );
          })
        ) : (
          <text fg={theme.textMuted}>agent registry 同步中…</text>
        )}
      </box>
    </box>
  );
}

/**
 * render 入口：有共享 solid 实例时用 keyed Show 包裹（tick 变化整树重建），
 * 否则直接静态构建（旧宿主回退，依赖 requestRender 触发的重挂载路径）。
 */
function renderPanel(context: Context, state: PanelState): JSX.Element {
  const build = () => buildPanelTree(context, state);
  return state.reactivity ? state.reactivity.dynamic(build) : build();
}

export async function setup(context: Context) {
  const reactivity = await loadPanelReactivity();
  const wire = wirePanel(context, reactivity);
  const disposeSlot = context.ui.slot({
    append: 'sidebar.content',
    render: ({ sessionID }) => {
      const state = panelStateOf.get(context);
      if (state) state.sessionID = sessionID;
      return state ? renderPanel(context, state) : <box />;
    },
  });
  return () => {
    disposeSlot();
    wire.dispose();
  };
}

export default Plugin.define({
  id: 'opencode-oceanus.tui',
  setup,
});
