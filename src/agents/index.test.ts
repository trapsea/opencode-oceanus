import { describe, expect, test } from 'bun:test';
import { createAgents, getAgentDefinitions } from './index';
import type { AgentDefinition } from './oceanus';
import { CBM_TOOLS } from '../cbm/registry';
import { READONLY_FILE_OPERATIONS_RULES, WRITABLE_FILE_OPERATIONS_RULES } from '../config/constants';
import { SISYPHUS_SKILLS } from '../skills';

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
    expect(sys).toContain('DIRECT tool');
    expect(sys).toContain('never through a Code Mode `execute` proxy');
    expect(sys).toContain('MANDATORY: for ANY targeted change to an existing file you MUST use `hashline_edit`');
    expect(sys).toContain('intentionally NOT in your toolset');
    expect(sys).toContain('read');
    expect(sys).toContain('apply_patch is executed by the host');
    expect(sys).toContain('Hook validates your `patchText`');
  });

  test('fixer 依赖编排者提供完整委派上下文，而不是自行规划', () => {
    const sys = byName('fixer');
    expect(sys).toMatch(/context|上下文/i);
    expect(sys).toContain('BLOCKED');
    expect(sys).toMatch(/parent|父 agent|orchestrator|编排/i);
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
    expect(sys).not.toMatch(/task_reuse/);
    expect(sys).not.toContain('cancel_task');
    expect(sys).toContain('`task_status`: query a managed task');
    expect(sys).toContain('`task_result`: read a task\'s final result');
    expect(sys).toContain('It succeeds only for terminal (completed) tasks');
    expect(sys).toContain('`task_cancel`: cancel a managed background task');
    expect(sys).toContain('the parent session must be your own');
  });

  test('sisyphus 使用 task_status/task_result/task_cancel 轮询且不以 registry 为宿主事实', () => {
    const sys = byName('sisyphus');
    const executeSkill =
      SISYPHUS_SKILLS.find((skill) => skill.name === 'sisyphus-execute')
        ?.content ?? '';
    // 主 prompt 已瘦身：轮询细则下沉到 sisyphus-execute skill
    expect(executeSkill).toContain('`task_status` / `task_result`');
    expect(executeSkill).toContain('`task_cancel`');
    expect(executeSkill).toContain(
      "the plugin's task metadata is only an index and never a substitute for host fact",
    );
    expect(executeSkill).toContain('host facts take priority');
  });

  test('sisyphus 方案总批准与 3 轮中断上报模板', () => {
    const sys = byName('sisyphus');
    expect(sys).toContain('方案总批准（consolidated approval）');
    expect(sys).toContain('3 轮中断上报模板（统一）');
    expect(sys).toContain('恰好 2-3 个');
    expect(sys).toContain('从该循环第一次 REJECT / 失败 / 分歧 / 缺口起算');
    expect(sys).toContain('最小修订集');
  });

  test('sisyphus/oceanus 通信协议：显式 task_status/task_result 查询，不依赖 queue 通知', () => {
    const sis = byName('sisyphus');
    expect(sis).toMatch(/[Dd]o not rely on queue notifications/);
    expect(sis).toContain('`task_status` / `task_result`');

    const oc = byName('oceanus');
    expect(oc).toMatch(/[Dd]o not rely on queue notifications/);
    expect(oc).toContain('`task_status`');
    expect(oc).toContain('`task_result`');
  });
});

describe('metis/momus 契约：默认注册与 disabled_agents 过滤', () => {
  const names = (config?: Parameters<typeof createAgents>[0]) =>
    createAgents(config).map((agent) => agent.name);

  test('默认 createAgents() 同时包含 metis 与 momus', () => {
    expect(names()).toContain('metis');
    expect(names()).toContain('momus');
  });

  test('getAgentDefinitions() 同时生成 metis 与 momus', () => {
    const definitions = getAgentDefinitions();
    expect(definitions.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['metis', 'momus']),
    );
  });

  test('disabled_agents 可单独过滤 metis 而保留 momus', () => {
    const n = names({ disabled_agents: ['metis'] });
    expect(n).not.toContain('metis');
    expect(n).toContain('momus');
  });

  test('disabled_agents 可单独过滤 momus 而保留 metis', () => {
    const n = names({ disabled_agents: ['momus'] });
    expect(n).not.toContain('momus');
    expect(n).toContain('metis');
  });

  test('disabled_agents 可同时过滤 metis 与 momus', () => {
    const n = names({ disabled_agents: ['metis', 'momus'] });
    expect(n).not.toContain('metis');
    expect(n).not.toContain('momus');
  });
});

describe('metis/momus 契约：subagent 定义与只读门禁', () => {
  const byName = (name: string) => {
    const agent = createAgents().find((a) => a.name === name);
    expect(agent).toBeDefined();
    return agent!;
  };

  test('metis 与 momus 均为 subagent', () => {
    expect(byName('metis').mode).toBe('subagent');
    expect(byName('momus').mode).toBe('subagent');
  });

  test('metis 负责方案分析，且只读、不委派、不写入', () => {
    const sys = byName('metis').system!;
    expect(sys).toMatch(/plan|analy|方案|分析/i);
    expect(sys).toMatch(/read-?only/i);
    expect(sys).toMatch(/do not delegate|no delegation|不委派/i);
    expect(sys).toMatch(/do not write|never write|不写入/i);
  });

  test('momus 负责检查/审查，且只读、不委派、不写入', () => {
    const sys = byName('momus').system!;
    expect(sys).toMatch(/check|review|inspect|检查|审查/i);
    expect(sys).toMatch(/read-?only/i);
    expect(sys).toMatch(/do not delegate|no delegation|不委派/i);
    expect(sys).toMatch(/do not write|never write|不写入/i);
  });

  test('momus REJECT 附最小修订集与分级收敛规则', () => {
    const sys = byName('momus').system!;
    expect(sys).toContain('最小修订集');
    expect(sys).toContain('BLOCKER');
    expect(sys).toContain('SUGGESTION');
    expect(sys).toContain('具体修改建议');
    expect(sys).toContain('验证方式');
    expect(sys).toMatch(/REJECT.*仅当存在 BLOCKER/);
    expect(sys).toMatch(/复审轮|N>1/);
    expect(sys).toMatch(/不得追加/);
  });

  test('metis 分析输出附建议处理方式', () => {
    const sys = byName('metis').system!;
    expect(sys).toMatch(/建议处理方式/);
    expect(sys).toMatch(/不需反向猜测|直接落实/);
  });
});

describe('只读 agent 默认 permission 契约', () => {
  const READONLY_NAMES = [
    'explorer',
    'librarian',
    'oracle',
    'observer',
    'momus',
  ];

  /** 把 permission 规则（string | pattern→action 映射）解析为某工具的最终 action */
  function action(agent: AgentDefinition, tool: string, resource?: string): string | undefined {
    const p = agent.permission;
    if (p === undefined) return undefined;
    if (typeof p === 'string') return p;
    const entry = (p as Record<string, unknown>)[tool];
    if (entry === undefined) return undefined;
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'object' && entry !== null) {
      const rules = entry as Record<string, string>;
      if (resource !== undefined && rules[resource] !== undefined) return rules[resource];
      const vals = Object.values(rules);
      if (vals.includes('allow')) return 'allow';
      if (vals.includes('deny')) return 'deny';
      return 'ask';
    }
    return undefined;
  }

  test('写入 subagent（fixer/designer）写入工具族约束', () => {
    for (const name of ['fixer', 'designer']) {
      const agent = byName(name);
      // 宿主 edit/write/apply_patch 共用 action "edit"：deny 即目录级移除
      expect(action(agent, 'edit')).toBe('deny');
      // 写入替代通道显式 allow（防宿主默认 ask 的不确定路径）
      expect(action(agent, 'hashline_edit')).toBe('allow');
      expect(action(agent, 'ast_grep_replace')).toBe('allow');
      // 其余 action 不声明 → 注册层 merge 保留宿主默认基线
      expect(action(agent, 'read')).toBeUndefined();
      expect(action(agent, 'shell')).toBeUndefined();
    }
  });

  // 显式清空 disabled_agents，确保 observer 参与（否则默认禁用不会出现在 createAgents() 结果中）
  const allAgents = () => createAgents({ disabled_agents: [] });
  const byName = (name: string) => {
    const agent = allAgents().find((a) => a.name === name);
    expect(agent).toBeDefined();
    return agent!;
  };

  test.each(READONLY_NAMES)('%s 默认放行只读工具 read/glob/grep', (name) => {
    expect(action(byName(name), 'read')).toBe('allow');
    expect(action(byName(name), 'glob')).toBe('allow');
    expect(action(byName(name), 'grep')).toBe('allow');
  });

  test.each(READONLY_NAMES)('%s 默认禁止初始化 CBM', (name) => {
    expect(action(byName(name), 'cbm_index')).toBe('deny');
  });

  test('metis 默认禁止初始化 CBM', () => {
    expect(action(byName('metis'), 'cbm_index')).toBe('deny');
  });

  test.each(READONLY_NAMES)('%s 默认显式允许查询 CBM 工具', (name) => {
    for (const tool of [
      'cbm_status',
      'cbm_search_graph',
      'cbm_trace',
      'cbm_code',
      'cbm_query',
      'cbm_detect_changes',
    ]) {
      expect(action(byName(name), tool)).toBe('allow');
    }
  });

  test.each(READONLY_NAMES)('%s 默认显式允许其它只读工具', (name) => {
    for (const tool of ['ast_grep_search', 'task_status', 'task_result']) {
      expect(action(byName(name), tool)).toBe('allow');
    }
  });

  test.each(READONLY_NAMES)('%s 默认拒绝写入与执行动作', (name) => {
    expect(action(byName(name), 'edit')).not.toBe('allow');
    expect(action(byName(name), 'write')).toBe('deny');
    expect(action(byName(name), 'apply_patch')).toBe('deny');
    expect(action(byName(name), 'ast_grep_replace')).toBe('deny');
    expect(action(byName(name), 'hashline_edit')).toBe('deny');
    expect(action(byName(name), 'todowrite')).toBe('deny');
    expect(action(byName(name), 'shell', 'git status')).toBe('allow');
    expect(action(byName(name), 'subagent')).toBe('deny');
  });

  test.each(READONLY_NAMES)('%s shell 允许只读命令并按 pattern 拒绝写入命令', (name) => {
    const agent = byName(name);
    for (const command of ['git status', 'git diff', 'git log', 'ls -la', 'grep foo file']) {
      expect(action(agent, 'shell', command)).toBe('allow');
    }
    for (const command of [
      'rm *', 'rmdir *', 'mv *', 'cp *', 'touch *', 'mkdir *', 'ln *',
      'chmod *', 'chown *', 'tee *', 'sed -i*', 'perl -i*', 'git add *',
      'git commit *', 'git push *', 'git pull *', 'git fetch *', 'git checkout *',
      'git reset *', 'git restore *', 'git clean *', 'git merge *', 'git rebase *',
      'npm install*', 'yarn add *', 'pnpm remove *', 'bun update*', '* > *',
    ]) {
      expect(action(agent, 'shell', command)).toBe('deny');
    }
  });

  test('显式只读 agent permission 覆盖默认矩阵', () => {
    const agent = createAgents({
      disabled_agents: [],
      agents: { explorer: { permission: { edit: 'allow' } } },
    }).find((item) => item.name === 'explorer');
    expect(action(agent!, 'edit')).toBe('allow');
    expect(action(agent!, 'write')).toBeUndefined();
  });

  test('显式 cbm_index 权限覆盖默认拒绝', () => {
    const agent = createAgents({ disabled_agents: [], agents: { explorer: { permission: { cbm_index: 'allow' } } } }).find((item) => item.name === 'explorer');
    expect(action(agent!, 'cbm_index')).toBe('allow');
  });

  test('keepsReadonlyAgentsFromFileOperations：只读 agent 拒绝文件操作工具', () => {
    for (const name of READONLY_NAMES) {
      expect(action(byName(name), 'hashline_edit')).toBe('deny');
    }
  });
});

describe('编排门禁：oceanus/sisyphus 路由 metis/momus', () => {
  const sysOf = (name: string) => {
    const agent = createAgents().find((a) => a.name === name);
    expect(agent).toBeDefined();
    return agent!.system!;
  };

  test('oceanus prompt 包含 metis/momus 触发语义', () => {
    const sys = sysOf('oceanus');
    expect(sys).toContain('@metis');
    expect(sys).toContain('@momus');
  });

  test('disabled 的 metis/momus 从 oceanus prompt 中移除对应路由', () => {
    const sys = createAgents({ disabled_agents: ['metis', 'momus'] }).find(
      (a) => a.name === 'oceanus',
    )!.system!;
    expect(sys).toMatch(/metis/i);
    expect(sys).not.toContain('@momus');
  });

  test('sisyphus prompt 包含 metis→momus→execute 与 momus REJECT 回 plan 门禁文案', () => {
    const sys = sysOf('sisyphus');
    expect(sys).toMatch(/metis/i);
    expect(sys).toMatch(/momus/i);
    expect(sys).toMatch(/REJECT/i);
    expect(sys).toMatch(/back to plan|back to the plan|回.*plan|重新规划|回到计划/i);
    expect(sys).toMatch(/skip|跳过/i);
    expect(sys).toMatch(/human approval|人工批准|approval/i);
  });

  test('Metis 仅在 Intake、澄清完成且主 Agent 明确需要时做方案分析', () => {
    const sys = createAgents().find((agent) => agent.name === 'metis')!.system!;
    expect(sys).toMatch(/exactly one mode|一个模式/i);
    expect(sys).toMatch(/Intake|SOLUTION_ANALYSIS/i);
    expect(sys).toMatch(/Intake.*clarification|Intake.*澄清/i);
    expect(sys).toMatch(/unresolved|未决|genuinely/i);
    expect(sys).toMatch(/explicitly requested|明确指定/);
    expect(sys).toMatch(/missing|缺少|not guess|不猜测/i);
  });

  test('Intake 不委派 Metis 做 INTAKE', () => {
    const sys = sysOf('sisyphus');
    expect(sys).toMatch(/Intake/);
    expect(sys).toMatch(/Metis.*INTAKE|INTAKE.*Metis/i);
    expect(sys).toMatch(/不得|禁止|不.*委派|do not delegate|not delegate/i);
  });

  test('Brainstorm 仅条件式委派 SOLUTION_ANALYSIS', () => {
    const sys = sysOf('sisyphus');
    expect(sys).toMatch(/Brainstorm|brainstorm/i);
    expect(sys).toMatch(/SOLUTION_ANALYSIS/);
    expect(sys).toMatch(/仅当|只有.*才|条件|when.*needed|if.*needed/i);
  });

  test('编排 Agent 声明六阶段但不展开阶段细节', () => {
    const sys = sysOf('sisyphus');
    expect(sys).toMatch(/intake.*brainstorm.*plan.*execute.*review.*finish/i);
    expect(sys).not.toMatch(/Phase 1.*澄清.*范围.*验收.*风险/i);
  });

  test('禁用 metis/momus 后 sisyphus 不指向已禁用 Agent', () => {
    const sys = createAgents({ disabled_agents: ['metis', 'momus'] }).find(
      (agent) => agent.name === 'sisyphus',
    )!.system!;
    expect(sys).toMatch(/metis.*disabled|momus.*disabled|已禁用/i);
  });

  test('禁用 sisyphus 后 oceanus 不指向已禁用 Agent', () => {
    const sys = createAgents({ disabled_agents: ['sisyphus'] }).find(
      (agent) => agent.name === 'oceanus',
    )!.system!;
    expect(sys).toMatch(/sisyphus is disabled|sisyphus.*disabled/i);
  });
});

describe('CBM-04：agent 调度契约（代码知识图谱）', () => {
  const sysOf = (name: string) => {
    const agent = createAgents().find((a) => a.name === name);
    expect(agent).toBeDefined();
    return agent!.system!;
  };

  test('oceanus prompt 包含 CBM 调度分类规则', () => {
    const sys = sysOf('oceanus');
    // 结构化检索优先 CBM，且要求带 qualified name / 文件 / 行号
    expect(sys).toMatch(/优先 CBM|CBM/);
    expect(sys).toMatch(/qualified name/);
    expect(sys).toMatch(/文件路径/);
    expect(sys).toMatch(/行号/);
    // 文本/AST/glob/Web 继续原工具，不被 CBM 取代
    expect(sys).toMatch(/grep/);
    expect(sys).toMatch(/ast_grep_search/);
    expect(sys).toMatch(/glob/);
    expect(sys).toMatch(/websearch|webfetch/);
  });

  test('oceanus prompt 委派检索时要求 CBM 证据与降级回退', () => {
    const sys = sysOf('oceanus');
    expect(sys).toMatch(/CBM 未索引|cbm_index/);
    expect(sys).toMatch(/grep/);
    expect(sys).toMatch(/read/);
  });

  test('sisyphus prompt 包含 CBM 四阶段边界且不覆盖既有门禁', () => {
    const sys = sysOf('sisyphus');
    // 四阶段各自定义 CBM 动作边界
    expect(sys).toMatch(/brainstorm/);
    expect(sys).toMatch(/plan/);
    expect(sys).toMatch(/execute/);
    expect(sys).toMatch(/review/);
    expect(sys).toMatch(/trace|impact|影响/);
    expect(sys).toMatch(/降级/);
    // 不覆盖既有 metis/momus 门禁
    expect(sys).toContain('@metis');
    expect(sys).toContain('@momus');
    expect(sys).toMatch(/REJECT/i);
  });

  test('explorer prompt 包含 CBM search→trace→code→fallback 优先级', () => {
    const sys = sysOf('explorer');
    expect(sys).toContain('cbm_search_graph');
    expect(sys).toContain('cbm_trace');
    expect(sys).toContain('cbm_code');
    expect(sys).toMatch(/qualified name/);
    expect(sys).toMatch(/行号/);
    // 保留 AST/文本 fallback 工具
    expect(sys).toContain('ast_grep_search');
    expect(sys).toContain('grep');
  });

  test('oracle prompt 包含 CBM code→trace→query/detect_changes 顺序', () => {
    const sys = sysOf('oracle');
    expect(sys).toContain('cbm_code');
    expect(sys).toContain('cbm_trace');
    expect(sys).toContain('cbm_query');
    expect(sys).toMatch(/detect_changes/);
    expect(sys).toMatch(/不确定性/);
  });

  test('librarian prompt 包含 CBM 本地交叉验证（外部仍用 Web）', () => {
    const sys = sysOf('librarian');
    expect(sys).toContain('websearch');
    expect(sys).toContain('webfetch');
    expect(sys).toContain('cbm_search_graph');
    expect(sys).toContain('cbm_code');
  });

  test('fixer prompt 包含 CBM 高风险改动前检查', () => {
    const sys = sysOf('fixer');
    expect(sys).toContain('cbm_trace');
    expect(sys).toContain('cbm_query');
    expect(sys).toMatch(/公共|public|高风险/);
  });

  test('momus prompt 包含查询型影响面预估门禁', () => {
    const sys = sysOf('momus');
    expect(sys).toMatch(/影响面/);
    expect(sys).toContain('cbm_search_graph');
    expect(sys).toContain('cbm_trace');
    expect(sys).toMatch(/REJECT/);
    expect(sys).toMatch(/plan status/);
  });

  test('metis prompt 包含查询型 CBM 检索段', () => {
    const sys = sysOf('metis');
    expect(sys).toContain('cbm_search_graph');
    expect(sys).toMatch(/查询型/);
  });

  test('sisyphus 的 momus 门禁声明查询型影响面预估', () => {
    const sys = sysOf('sisyphus');
    expect(sys).toMatch(/影响面预估/);
    expect(sys).toMatch(/plan status/);
  });
});

describe('CBM-12：agent prompt CBM 调度最终审计', () => {
  const sysOf = (name: string) => {
    const agent = createAgents().find((a) => a.name === name);
    expect(agent).toBeDefined();
    return agent!.system!;
  };

  // 与注册表（src/cbm/registry.ts 的 CBM_TOOLS）一致，禁止虚构 cbm_* 工具名
  const REGISTERED_CBM_TOOLS = CBM_TOOLS;

  const cbmToolsIn = (sys: string) =>
    [...sys.matchAll(/\bcbm_[a-z_]+/g)].map((m) => m[0]);

  test('所有 agent 引用的 cbm_* 工具名均在注册集合内', () => {
    const agents = ['oceanus', 'sisyphus', 'explorer', 'oracle', 'librarian', 'fixer', 'momus', 'metis'];
    for (const name of agents) {
      for (const t of cbmToolsIn(sysOf(name))) {
        expect(REGISTERED_CBM_TOOLS).toContain(t);
      }
    }
  });

  test('oceanus 用注册的 cbm_* 名，不用裸 canonical 名', () => {
    const sys = sysOf('oceanus');
    expect(sys).toContain('cbm_search_graph');
    expect(sys).toContain('cbm_trace');
    expect(sys).toContain('cbm_code');
    expect(sys).toContain('cbm_query');
    expect(sys).toContain('cbm_detect_changes');
    expect(sys).not.toMatch(/(?<!cbm_)search_graph/);
    expect(sys).not.toMatch(/(?<!cbm_)trace_path/);
    expect(sys).not.toMatch(/(?<!cbm_)get_code_snippet/);
    expect(sys).not.toMatch(/(?<!cbm_)query_graph/);
    expect(sys).not.toMatch(/(?<!cbm_)detect_changes/);
  });

  test('oracle 用 cbm_detect_changes 而非裸 detect_changes', () => {
    const sys = sysOf('oracle');
    expect(sys).toContain('cbm_detect_changes');
    expect(sys).not.toMatch(/(?<!cbm_)detect_changes/);
  });

  test('sisyphus CBM 阶段边界四阶段齐全且只出现一次', () => {
    const sys = sysOf('sisyphus');
    expect((sys.match(/## CBM 阶段边界/g) || []).length).toBe(1);
    for (const phase of ['brainstorm', 'plan', 'execute', 'review']) {
      expect(sys).toMatch(new RegExp(`- ${phase}:`));
    }
    expect(sys).toMatch(/降级/);
    expect(sys).toMatch(/trace|impact|影响/);
  });

  test('oceanus CBM 与 grep/AST/glob/Web 分工明确且不互相替代', () => {
    const sys = sysOf('oceanus');
    expect(sys).toMatch(/grep|search_code/); // 文本
    expect(sys).toMatch(/ast_grep_search/); // AST
    expect(sys).toMatch(/glob/); // 文件发现
    expect(sys).toMatch(/websearch|webfetch/); // Web
    expect((sys.match(/不使用 CBM 替代/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(sys).toContain('Structured code-knowledge retrieval prefers CBM');
  });

  test('CBM 证据输出统一要求 qualified name/文件路径/行号/不确定性', () => {
    for (const name of ['explorer', 'oracle', 'librarian', 'oceanus']) {
      const sys = sysOf(name);
      expect(sys).toMatch(/qualified name/);
      expect(sys).toMatch(/文件路径|file path/);
      expect(sys).toMatch(/行号|line/);
      expect(sys).toMatch(/不确定性|uncertain/);
    }
  });

  test('fixer 高风险改动前先 trace/impact，且明确为修改前动作', () => {
    const sys = sysOf('fixer');
    expect(sys).toContain('cbm_trace');
    expect(sys).toContain('cbm_query');
    expect(sys).toMatch(/高风险|公共|public/);
    expect(sys).toMatch(/修改前|before/);
  });

  test('门禁派发纪律：原生名派发禁冒充、复用优先、REJECT 循环上报（dispatch-guard 配套契约）', () => {
    const sys = sysOf('sisyphus');
    expect(sys).toMatch(/原生专家名/);
    expect(sys).toMatch(/冒充/);
    expect(sys).toMatch(/agent 参数为 `"momus"`/);
    expect(sys).toMatch(/task_revive/);
    expect(sys).toMatch(/最多 3 轮/);
    expect(sys).toMatch(/3 轮中断上报模板|停止重审循环/);
    expect(sys).toMatch(/不允许静默循环自查/);
  });

  test('工具调用协议使用结构化对象与安全字符串表达，禁止伪 TypeScript 签名', () => {
    const prompts = [
      sysOf('sisyphus'),
      sysOf('oceanus'),
      SISYPHUS_SKILLS.find((skill) => skill.name === 'sisyphus-execute')?.content ?? '',
    ];
    const combined = prompts.join('\n');

    expect(combined).toContain('subagent({ agent, description, prompt, background })');
    expect(combined).toContain('task_revive({ task_id, prompt })');
    expect(combined).toContain('\\n');
    expect(combined).toContain('引号');
    expect(combined).toContain('反斜杠');
    expect(combined).toContain('ASCII');

    expect(combined).not.toMatch(/task_revive\(task_id,\s*prompt\)/);
    expect(combined).not.toMatch(/subagent\(agent,\s*(?:lane_key:|description)/);
    expect(combined).not.toMatch(/task\(\.\.\.?,?\s*run_in_background=true\)/);
    expect(combined).not.toContain('lane_key: "<stable-key>"');
  });
});

describe('工具运行时名称对齐：宿主工具与插件工具契约', () => {
  const ALL_AGENT_NAMES = ['oceanus', 'sisyphus', 'explorer', 'librarian', 'oracle', 'designer', 'fixer', 'metis', 'momus'];
  const sysOf = (name: string) => {
    const agent = createAgents().find((a) => a.name === name);
    expect(agent).toBeDefined();
    return agent!.system!;
  };

  test('所有 agent 提示词不含臆造工具名 search_code（词边界）', () => {
    for (const name of ALL_AGENT_NAMES) {
      expect(sysOf(name)).not.toMatch(/\bsearch_code\b/);
    }
  });

  test('只读/写 RULES 注入的工具来源契约句：宿主工具直调、禁止 execute 代理', () => {
    // 非 owned agent 的契约句只能来自共享 RULES 常量，用注入方断言。
    for (const name of ['explorer', 'librarian', 'oracle', 'metis', 'momus', 'fixer', 'designer', 'oceanus']) {
      const sys = sysOf(name);
      expect(sys).toContain('host-provided');
      expect(sys).toContain('execute');
    }
    expect(READONLY_FILE_OPERATIONS_RULES).toContain('host-provided');
    expect(WRITABLE_FILE_OPERATIONS_RULES).toContain('host-provided');
    expect(READONLY_FILE_OPERATIONS_RULES).toMatch(/grep/);
    expect(WRITABLE_FILE_OPERATIONS_RULES).toMatch(/grep/);
  });

  test('explorer/fixer/librarian 明确 grep 用于文本搜索且不臆造 search 工具', () => {
    for (const name of ['explorer', 'fixer', 'librarian']) {
      const sys = sysOf(name);
      expect(sys).toMatch(/Text\/regex patterns.*grep|grep.*text|文本.*grep/i);
    }
  });
});
