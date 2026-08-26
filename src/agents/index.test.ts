import { describe, expect, test } from 'bun:test';
import { createAgents } from './index';

describe('agent override 映射', () => {
  test('映射 v2 AgentDefinition 支持的字段', () => {
    const configured = createAgents({
      agents: {
        explorer: {
          model: 'openai/gpt-5#high',
          temperature: 0.4,
          prompt: '自定义系统提示词',
          description: '自定义描述',
          color: '#123456',
        },
      },
    }).find((agent) => agent.name === 'explorer');

    expect(configured).toMatchObject({
      model: { id: 'gpt-5', providerID: 'openai', variant: 'high' },
      temperature: 0.4,
      system: '自定义系统提示词',
      description: '自定义描述',
      color: '#123456',
    });
  });

  test('映射 options、displayName、permission 和 orchestratorPrompt', () => {
    const configured = createAgents({
      agents: {
        fixer: {
          model: [{ id: 'anthropic/claude-sonnet-4', variant: 'low' }],
          variant: 'high',
          skills: ['one'],
          mcps: ['two'],
          options: { effort: 'max' },
          displayName: '显示名',
          orchestratorPrompt: '编排提示词',
          permission: { read: 'allow' },
        },
      },
    }).find((agent) => agent.name === 'fixer');

    expect(configured).toMatchObject({
      model: {
        id: 'claude-sonnet-4',
        providerID: 'anthropic',
        variant: 'high',
      },
      displayName: '显示名',
      options: { effort: 'max' },
      orchestratorPrompt: '编排提示词',
      permission: { read: 'allow' },
    });
    expect(configured).toMatchObject({ skills: ['one'], mcps: ['two'] });
  });
});

describe('agent prompt 工具对齐（tooling-10）', () => {
  const byName = (name: string) => {
    const agent = createAgents().find((a) => a.name === name);
    expect(agent).toBeDefined();
    return agent!.system!;
  };

  test('explorer 只引用只读工具并禁用写工具', () => {
    const sys = byName('explorer');
    expect(sys).toContain('ast_grep_search is a READ-ONLY structural search');
    expect(sys).toMatch(/Never call ast_grep_replace, hashline_edit, or apply_patch/);
    expect(sys).toMatch(/Only read-only tools: grep, glob, read, ast_grep_search/);
  });

  test('fixer 描述写工具保护语义', () => {
    const sys = byName('fixer');
    expect(sys).toContain('ast_grep_replace is dry-run by default');
    expect(sys).toContain('explicitly pass `dryRun: false`');
    expect(sys).toContain('hashline_edit anchors edits to per-line hashes');
    expect(sys).toContain('read');
    expect(sys).toContain('apply_patch is executed by the host');
    expect(sys).toContain('Hook validates your `patchText`');
  });

  test('librarian 不虚构 context7/gh_grep 为原生工具', () => {
    const sys = byName('librarian');
    expect(sys).toContain('webfetch');
    expect(sys).toContain('websearch');
    expect(sys).toContain(
      'There are no native Oceanus tools named context7 or gh_grep',
    );
  });

  test('oceanus 不出现未注册工具并补齐 task 三件套语义', () => {
    const sys = byName('oceanus');
    expect(sys).not.toMatch(/task_message|task_revive/);
    expect(sys).not.toContain('cancel_task');
    expect(sys).toContain('`task_status`: query a managed task');
    expect(sys).toContain('`task_result`: read a task\'s final result');
    expect(sys).toContain('It succeeds only for terminal (completed) tasks');
    expect(sys).toContain('`task_cancel`: cancel a managed background task');
    expect(sys).toContain('the parent session must be your own');
  });

  test('sisyphus 使用 task_status/task_result/task_cancel 轮询且不以 registry 为宿主事实', () => {
    const sys = byName('sisyphus');
    expect(sys).toContain('`task_status` / `task_result`');
    expect(sys).toContain('`task_cancel`');
    expect(sys).toContain(
      'the local task registry is only an index and never a substitute for host fact',
    );
    expect(sys).toContain('`task_result` returns data only for terminal');
  });
});
