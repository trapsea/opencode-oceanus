import { Plugin } from '@opencode-ai/plugin/tui';
import type { Context } from '@opencode-ai/plugin/tui/plugin';
import { createMemo, For, Show } from 'solid-js';
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

const OCEANUS_AGENT_NAMES = new Set<string>(ALL_AGENT_NAMES);

function normalizeModel(model: ModelRef | undefined): string {
  if (!model) return '跟随会话';

  const modelName = model.id.includes('/')
    ? model.id.split('/').at(-1) ?? model.id
    : model.id;
  const base = `${model.providerID}/${modelName}`;
  return model.variant ? `${base}#${model.variant}` : base;
}

function shortModelName(model: string): string {
  return model
    .replace(/^anthropic\//, '')
    .replace(/^openai\//, '')
    .replace(/^google\//, '')
    .replace(/^github-copilot\//, 'copilot/');
}

function getRows(context: Context, sessionID: string): AgentRow[] {
  const session = context.data.session.get(sessionID);
  const agents = context.data.location.agent.list(context.location) ?? [];

  return agents
    .filter((agent) => OCEANUS_AGENT_NAMES.has(agent.id) || OCEANUS_AGENT_NAMES.has(agent.name))
    .sort((left, right) => {
      const leftIndex = ALL_AGENT_NAMES.indexOf(left.id as (typeof ALL_AGENT_NAMES)[number]);
      const rightIndex = ALL_AGENT_NAMES.indexOf(right.id as (typeof ALL_AGENT_NAMES)[number]);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    })
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      mode: agent.mode,
      color: agent.color,
      model: agent.model,
      active: session?.agent === agent.id || session?.agent === agent.name,
    }));
}

function AgentModelPanel(props: { context: Context; sessionID: string }) {
  const theme = () => props.context.theme;
  const session = createMemo(() => props.context.data.session.get(props.sessionID));
  const rows = createMemo(() => getRows(props.context, props.sessionID));
  const active = createMemo(() => rows().find((row) => row.active));
  const activeModel = createMemo(() => active()?.model ?? session()?.model);

  return (
    <box
      flexDirection="column"
      gap={1}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="rounded"
      borderColor="#0FFFFF"
    >
      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg="#0FFFFF"><b>Oceanus Agents</b></text>
        <text fg={theme().textMuted}>model map</text>
      </box>

      <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={0}>
        <text fg={theme().textMuted}>当前</text>
        <text fg={theme().text}>
          <span style={{ fg: active()?.color ?? '#0FFFFF' }}>◆</span>{' '}
          <b>{active()?.name ?? session()?.agent ?? 'oceanus'}</b>{' '}
          <span style={{ fg: theme().textMuted }}>{shortModelName(normalizeModel(activeModel()))}</span>
        </text>
      </box>

      <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={0}>
        <Show when={rows().length > 0} fallback={<text fg={theme().textMuted}>agent 数据同步中…</text>}>
          <For each={rows()}>
            {(row) => {
              const model = createMemo(() => shortModelName(normalizeModel(row.model)));
              return (
                <box flexDirection="row" justifyContent="space-between" gap={1}>
                  <text fg={row.active ? theme().text : theme().textMuted} flexShrink={0}>
                    <span style={{ fg: row.color ?? (row.mode === 'primary' ? '#0FFFFF' : theme().textMuted) }}>
                      {row.active ? '◆' : '◇'}
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
