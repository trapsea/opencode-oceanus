import { Plugin } from '@opencode-ai/plugin/tui';
import type { SessionStatus as EventSessionStatus } from '@opencode-ai/client';
import type { Context } from '@opencode-ai/plugin/tui/plugin';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { ALL_AGENT_NAMES } from './config/constants';

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

export function sortAgentRows<T extends { id: string }>(agents: T[]): T[] {
  return [...agents].sort((left, right) => {
    const leftIndex = ALL_AGENT_NAMES.indexOf(left.id as (typeof ALL_AGENT_NAMES)[number]);
    const rightIndex = ALL_AGENT_NAMES.indexOf(right.id as (typeof ALL_AGENT_NAMES)[number]);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
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

function getRows(context: Context, sessionID: string, localStatuses: Map<string, LocalSessionStatus>, deletedSessionIDs: Set<string>): AgentRow[] {
  const agents = context.data.location.agent.list(context.location) ?? [];
  const activeSessions = getRelatedRunningSessions(context, sessionID, localStatuses, deletedSessionIDs);

  return sortAgentRows(agents.filter((agent) => OCEANUS_AGENT_NAMES.has(agent.id) || OCEANUS_AGENT_NAMES.has(agent.name)))
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      mode: agent.mode,
      color: agent.color,
      model: agent.model,
      active: activeSessions.some((session) => matchesAgent(agent, session.agent)),
    }));
}

function AgentModelPanel(props: { context: Context; sessionID: string }) {
  const theme = () => props.context.theme;
  const [localStatuses, setLocalStatuses] = createSignal(new Map<string, LocalSessionStatus>(), { equals: false });
  const [deletedSessionIDs, setDeletedSessionIDs] = createSignal(new Set<string>(), { equals: false });
  const [dataVersion, setDataVersion] = createSignal(0);
  const refreshData = () => setDataVersion((version) => version + 1);
  const refreshAgents = () => {
    props.context.data.location.agent.invalidate(props.context.location);
    void props.context.data.location.agent.sync(props.context.location)
      .catch(() => undefined)
      .finally(refreshData);
  };
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
    props.context.data.on('session.agent.selected', (event) => calibrateStatus(event.data.sessionID)),
    props.context.data.on('session.model.selected', (event) => calibrateStatus(event.data.sessionID)),
    props.context.data.on('session.moved', (event) => calibrateStatus(event.data.sessionID)),
    props.context.data.on('session.forked', (event) => calibrateStatus(event.data.sessionID)),
    props.context.data.on('session.deleted', (event) => {
      removeLocalStatus(event.data.sessionID);
      calibrateStatus(event.data.sessionID);
    }),
  ];

  onCleanup(() => {
    cleanups.forEach((cleanup) => cleanup());
  });

  const rows = createMemo(() => {
    dataVersion();
    return getRows(props.context, props.sessionID, localStatuses(), deletedSessionIDs());
  });
  const hasRows = createMemo(() => rows().length > 0);

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
      </box>

      <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={0}>
        <Show when={hasRows()} fallback={<text fg={theme().textMuted}>agent registry 同步中，暂按会话模型降级</text>}>
          <For each={rows()}>
            {(row) => {
              const model = createMemo(() => shortModelName(normalizeModel(row.model)));
              return (
                <box flexDirection="row" justifyContent="space-between" gap={1}>
                  <text fg={row.active ? theme().text : theme().textMuted} flexShrink={0}>
                    <span style={{ fg: row.color ?? (row.mode === 'primary' ? SIDEBAR_ACCENT : theme().textMuted) }}>
                      {row.active ? '●' : '○'}
                    </span>{' '}
                    {row.name}
                  </text>
                  <text fg={row.model ? theme().text : theme().textMuted}>{model()}</text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>
    </box>
  );
}

export default Plugin.define({
  id: 'opencode-oceanus.tui',
  async setup(context) {
    await context.data.location.agent.sync(context.location).catch(() => undefined);

    return context.ui.slot({
      append: 'sidebar.content',
      render: ({ sessionID }) => <AgentModelPanel context={context} sessionID={sessionID} />,
    });
  },
});
