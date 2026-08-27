import { Plugin } from '@opencode-ai/plugin/tui';
import type { SessionStatus as EventSessionStatus } from '@opencode-ai/client';
import type { Context } from '@opencode-ai/plugin/tui/plugin';
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { ALL_AGENT_NAMES } from './config/constants';
import { loadPluginConfig } from './config/loader';

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

export function normalizeModel(model: ModelRef | undefined): string {
  if (!model) return '跟随会话';

  const modelName = model.id.includes('/')
    ? model.id.split('/').at(-1) ?? model.id
    : model.id;
  const base = `${model.providerID}/${modelName}`;
  return model.variant ? `${base}#${model.variant}` : base;
}

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
 * 侧边栏模型展示优先级（纯逻辑，供 Wave 2 复用）：
 * 1. 配置 model 存在 → 显示配置，永不覆盖；
 * 2. 配置 undefined + recall 存在 → 显示 recall；
 * 3. 都无 → 跟随会话。
 */
export function resolveDisplayModel(
  configModel: ModelRef | undefined,
  recall: ModelRef | undefined,
): { display: string; recalled: boolean } {
  if (configModel) {
    return { display: bareModelName(configModel), recalled: false };
  }
  if (recall) {
    return { display: bareModelName(recall), recalled: true };
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
 * preset 指纹轮询器：低频读盘比较，指纹变化时触发一次 onChange。
 *
 * 兜底 OpenCode server 的 agent.updated 广播不带 location 导致 client 内建
 * 失效路径被跳过、事件驱动刷新可能丢失的问题——preset 变化最迟在一个
 * interval 后被发现，与事件可达性无关。
 *
 * 契约：
 * - 首次同步 read 作为基线指纹，不触发 onChange；
 * - read 抛异常或返回 undefined 时视为指纹不变（fail-open：无法区分
 *   读盘失败与"配置无 preset"，宁可少刷不多刷）；
 * - 指纹变化 → 恰好调用一次 onChange 并更新基线；
 * - 返回 dispose 清理定时器。
 */
export function createPresetWatcher(options: {
  read: () => string | undefined;
  intervalMs?: number;
  onChange: () => void;
}): () => void {
  const { read, intervalMs = 2000, onChange } = options;
  let baseline: string | undefined;
  try {
    baseline = read();
  } catch {
    baseline = undefined;
  }
  const timer = setInterval(() => {
    let next: string | undefined;
    try {
      next = read();
    } catch {
      return;
    }
    if (next === undefined || next === baseline) return;
    baseline = next;
    onChange();
  }, intervalMs);
  return () => clearInterval(timer);
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

export function getRows(context: Context, sessionID: string, localStatuses: Map<string, LocalSessionStatus>, deletedSessionIDs: Set<string>, recalls?: Record<string, ModelRef>): AgentRow[] {
  const agents = context.data.location.agent.list(context.location) ?? [];
  const activeSessions = getRelatedRunningSessions(context, sessionID, localStatuses, deletedSessionIDs);

  return sortAgentRows(agents.filter((agent) => OCEANUS_AGENT_NAMES.has(agent.id) || OCEANUS_AGENT_NAMES.has(agent.name)))
    .map((agent) => {
      const resolved = resolveDisplayModel(agent.model, recalls?.[agent.id]);
      return {
        id: agent.id,
        name: agent.name,
        mode: agent.mode,
        color: agent.color,
        model: agent.model,
        active: activeSessions.some((session) => matchesAgent(agent, session.agent)),
        display: resolved.display,
        recalled: resolved.recalled,
      };
    });
}

function AgentModelPanel(props: { context: Context; sessionID: string }) {
  const theme = () => props.context.theme;
  const [localStatuses, setLocalStatuses] = createSignal(new Map<string, LocalSessionStatus>(), { equals: false });
  const [deletedSessionIDs, setDeletedSessionIDs] = createSignal(new Set<string>(), { equals: false });
  const [dataVersion, setDataVersion] = createSignal(0);
  const [recalls, setRecalls] = createSignal<Record<string, ModelRef>>({});
  const refreshData = () => setDataVersion((version) => version + 1);
  const refreshAgents = () => {
    props.context.data.location.agent.invalidate(props.context.location);
    void props.context.data.location.agent.sync(props.context.location)
      .catch(() => undefined)
      .finally(refreshData);
  };
  onMount(() => refreshAgents());
  // preset 指纹兜底：server 的 agent.updated 广播不带 location，client 内建
  // 失效路径会被跳过；事件监听是"尽力而为"，这里保证切换后最迟一个 tick
  // 内自愈（读盘比较，同值零网络开销）。
  const disposePresetWatcher = createPresetWatcher({
    read: () => loadPluginConfig({ directory: props.context.location?.directory }).preset,
    onChange: refreshAgents,
  });
  const calibrateStatus = (sessionID?: string) => {
    if (!sessionID) {
      refreshData();
      return;
    }

    void props.context.data.session.sync(sessionID)
      .catch(() => props.context.data.session.invalidate(sessionID))
      .finally(refreshData);
  };
  const setLocalStatus = (sessionID: string, status: LocalSessionStatus) => {
    setDeletedSessionIDs((deleted) => {
      deleted.delete(sessionID);
      return deleted;
    });
    setLocalStatuses((statuses) => {
      statuses.set(sessionID, status);
      return statuses;
    });
  };
  const removeLocalStatus = (sessionID: string) => {
    setLocalStatuses((statuses) => {
      statuses.delete(sessionID);
      return statuses;
    });
    setDeletedSessionIDs((deleted) => {
      deleted.add(sessionID);
      return deleted;
    });
  };

  const cleanups = [
    props.context.data.on('agent.updated', (event) => {
      if (!event.location || sameLocation(event.location, props.context.location)) {
        refreshAgents();
      }
    }),
    props.context.data.on('session.inbox.delivered', () => {
      // /preset 命令通过 session.prompt 投递回复，此事件保证切换后 agent 列表被重新同步。
      refreshAgents();
    }),
    props.context.data.on('session.status', (event) => {
      setLocalStatus(event.data.sessionID, event.data.status);
      calibrateStatus(event.data.sessionID);
    }),
    props.context.data.on('session.execution.started', (event) => {
      setLocalStatus(event.data.sessionID, 'running');
      calibrateStatus(event.data.sessionID);
    }),
    props.context.data.on('session.execution.succeeded', (event) => {
      setLocalStatus(event.data.sessionID, 'idle');
      calibrateStatus(event.data.sessionID);
    }),
    props.context.data.on('session.execution.failed', (event) => {
      setLocalStatus(event.data.sessionID, 'idle');
      calibrateStatus(event.data.sessionID);
    }),
    props.context.data.on('session.execution.interrupted', (event) => {
      setLocalStatus(event.data.sessionID, 'idle');
      calibrateStatus(event.data.sessionID);
    }),
    props.context.data.on('session.created', (event) => calibrateStatus(event.data.sessionID)),
    props.context.data.on('session.agent.selected', (event) => {
      calibrateStatus(event.data.sessionID);

      const family = new Set(props.context.data.session.family(props.sessionID) ?? []);
      family.add(props.sessionID);
      if (!family.has(event.data.sessionID)) return;

      const agents = props.context.data.location.agent.list(props.context.location) ?? [];
      const agent = agents.find((candidate) => candidate.id === event.data.agent || candidate.name === event.data.agent);
      if (!agent) return;

      setRecalls((r) => {
        if (!r[agent.id]) return r;
        const { [agent.id]: _removed, ...rest } = r;
        return rest;
      });
    }),
    props.context.data.on('session.model.selected', (event) => {
      calibrateStatus(event.data.sessionID);

      const family = new Set(props.context.data.session.family(props.sessionID) ?? []);
      family.add(props.sessionID);
      if (!family.has(event.data.sessionID)) return;

      const agents = props.context.data.location.agent.list(props.context.location) ?? [];
      const sessionAgent = props.context.data.session.get(event.data.sessionID)?.agent;
      const agent = agents.find((candidate) => candidate.id === sessionAgent || candidate.name === sessionAgent);
      if (!agent) return;

      const next = recordRecall(recalls(), agent.id, event.data.model);
      if (next !== recalls()) setRecalls(next);
    }),
    props.context.data.on('session.moved', (event) => calibrateStatus(event.data.sessionID)),
    props.context.data.on('session.forked', (event) => calibrateStatus(event.data.sessionID)),
    props.context.data.on('session.deleted', (event) => {
      removeLocalStatus(event.data.sessionID);
      calibrateStatus(event.data.sessionID);
    }),
  ];

  onCleanup(() => {
    disposePresetWatcher();
    cleanups.forEach((cleanup) => cleanup());
  });

  const rows = createMemo(() => {
    dataVersion();
    recalls();
    return getRows(props.context, props.sessionID, localStatuses(), deletedSessionIDs(), recalls());
  });
  const hasRows = createMemo(() => rows().length > 0);

  // 当前生效 preset（用户+项目合并后）。随 dataVersion 刷新：/preset 切换后
  // session.inbox.delivered → refreshAgents → refreshData 会触发这里重新计算。
  const presetName = createMemo(() => {
    dataVersion();
    return loadPluginConfig({
      directory: props.context.location?.directory,
    }).preset;
  });

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
        <Show when={presetName()} fallback={<text>&nbsp;</text>}>
          <text fg={theme().textMuted}>{presetName()}</text>
        </Show>
      </box>

      <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={0}>
        <Show when={hasRows() || Object.keys(recalls()).length > 0} fallback={<text fg={theme().textMuted}>agent registry 同步中…</text>}>
          <For each={rows()}>
            {(row) => {
              const resolved = createMemo(() => resolveDisplayModel(row.model, recalls()[row.id]));
              return (
                <box flexDirection="row" justifyContent="space-between" gap={1}>
                  <text fg={row.active ? theme().text : theme().textMuted} flexShrink={0}>
                    <span style={{ fg: row.color ?? (row.mode === 'primary' ? SIDEBAR_ACCENT : theme().textMuted) }}>
                      {row.active ? '●' : '○'}
                    </span>{' '}
                    {row.name}
                  </text>
                  <text fg={(row.model || resolved().recalled) ? theme().text : theme().textMuted}>
                    {resolved().recalled ? '*' : ''}{resolved().display}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>
    </box>
  );
}

export async function setup(context: Context) {
  return context.ui.slot({
    append: 'sidebar.content',
    render: ({ sessionID }) => <AgentModelPanel context={context} sessionID={sessionID} />,
  });
}

export default Plugin.define({
  id: 'opencode-oceanus.tui',
  setup,
});
