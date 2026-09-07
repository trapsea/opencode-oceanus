import { describe, expect, test } from 'bun:test';
import {
  DELEGATION_BRIEF_PROMPT,
  formatDelegationBrief,
  formatOracleBrief,
  formatResearchBrief,
  getMissingOracleBriefFields,
  getMissingOracleSceneFields,
  RESEARCH_BRIEF_PROMPT,
} from './orchestrator-context';

describe('formatResearchBrief 调研简报', () => {
  test('全字段渲染：五字段锚点按序出现且包含尾部 BLOCKED 提示', () => {
    const text = formatResearchBrief({
      goal: '定位 Oceanus 编排器注册入口',
      scope: 'src/agents/、src/index.ts',
      background: '仓库改造后 subagent 默认只读调研',
      return: '事实条数上限 5，每条附文件路径/行号或 qualified name',
      deadline: '本轮内返回',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('## 调研简报');
    expect(text.indexOf('- 目标:')).toBeGreaterThan(-1);
    expect(text.indexOf('- 检索范围:')).toBeGreaterThan(text.indexOf('- 目标:'));
    expect(text.indexOf('- 背景:')).toBeGreaterThan(text.indexOf('- 检索范围:'));
    expect(text.indexOf('- 返回:')).toBeGreaterThan(text.indexOf('- 背景:'));
    expect(text.indexOf('- 软期限:')).toBeGreaterThan(text.indexOf('- 返回:'));
    expect(text).toContain('调研结果缺少文件路径/行号或 qualified name 证据时，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父级 agent。');
  });

  test('可选字段缺省：background/deadline 未提供时整行省略', () => {
    const text = formatResearchBrief({
      goal: '查询 OpenCode v2 插件 API 兼容矩阵',
      scope: 'docs/opencode-v2-compatibility.md',
      return: '事实条数上限 3',
    });
    expect(text).not.toContain('- 背景:');
    expect(text).not.toContain('- 软期限:');
    expect(text).toContain('- 目标: 查询 OpenCode v2 插件 API 兼容矩阵');
    expect(text).toContain('- 检索范围: docs/opencode-v2-compatibility.md');
    expect(text).toContain('- 返回: 事实条数上限 3');
  });

  test('数组字段以换行 join 渲染，多个数组字段均生效', () => {
    const text = formatResearchBrief({
      goal: ['问题一：入口在哪', '问题二：何时注册'],
      scope: ['src/agents/', 'src/index.ts'],
      background: ['背景 A', '背景 B'],
      return: ['事实条数上限 5', '每条附证据'],
      deadline: ['今天内', '最迟明天'],
    });
    expect(text).toContain('- 目标: 问题一：入口在哪\n问题二：何时注册');
    expect(text).toContain('- 检索范围: src/agents/\nsrc/index.ts');
    expect(text).toContain('- 背景: 背景 A\n背景 B');
    expect(text).toContain('- 返回: 事实条数上限 5\n每条附证据');
    expect(text).toContain('- 软期限: 今天内\n最迟明天');
  });

  test('RESEARCH_BRIEF_PROMPT 非空且包含「调研简报」「逃生舱」锚点', () => {
    expect(RESEARCH_BRIEF_PROMPT.length).toBeGreaterThan(0);
    expect(RESEARCH_BRIEF_PROMPT).toContain('调研简报');
    expect(RESEARCH_BRIEF_PROMPT).toContain('逃生舱');
    expect(RESEARCH_BRIEF_PROMPT).toContain('不得依赖隐含上下文');
  });

  test('结构化研究契约字段按要求渲染', () => {
    const text = formatResearchBrief({
      goal: '确认入口', scope: 'src/', return: '结构化结论',
      researchQuestion: '入口在哪里？', evidenceRequirements: '路径和行号',
      outputFields: 'claim/evidence/status/source_version/impact/open_questions/negative_findings',
      negativeSearch: '搜索不存在的旧入口', sourceVersion: 'package.json 版本',
      openQuestions: '宿主行为待确认', blockingFormat: 'STATUS: BLOCKED、QUESTIONS、IMPACT',
    });
    for (const anchor of ['- 研究问题:', '- 证据要求:', '- 输出字段:', '- 负向检索:', '- 版本锚定:', '- 未知项:', '- 阻塞格式:', 'claim、evidence、status、source_version、impact、open_questions、negative_findings']) {
      expect(text).toContain(anchor);
    }
  });
});

describe('formatDelegationBrief 回归', () => {
  test('八字段按独立小节渲染并保留尾部 BLOCKED 提示', () => {
    const text = formatDelegationBrief({
      goal: '为工具新增参数校验',
      background: '工具输入缺少校验',
      decisions: ['采用 Zod schema'],
      files: ['src/tools/example.ts'],
      forbidden: ['不得改 src/index.ts'],
      dependencies: ['依赖 config 加载完成'],
      acceptance: ['typecheck 通过'],
      tests: ['bun test'],
      risks: ['公共 API 变更影响调用方'],
    });
    expect(text).toContain('## 委派简报');
    for (const anchor of [
      '### 目标\n为工具新增参数校验',
      '### 背景\n工具输入缺少校验',
      '### 已确认决策\n采用 Zod schema',
      '### 文件归属与所有权\nsrc/tools/example.ts',
      '### 禁止事项\n不得改 src/index.ts',
      '### 依赖与结果\n依赖 config 加载完成',
      '### 验收标准\ntypecheck 通过',
      '### 验证命令\nbun test',
      '### 风险与回退\n公共 API 变更影响调用方',
    ]) {
      expect(text).toContain(anchor);
    }
    expect(text).toContain('### 目标\n为工具新增参数校验\n\n### 背景');
    expect(text).toContain('若缺少任一项，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父级 agent。');
    expect(DELEGATION_BRIEF_PROMPT).toContain('委派简报');
  });
});

describe('formatOracleBrief Oracle 调度上下文', () => {
  const complete = {
    scene: 'consult' as const,
    objective: '评估公共配置契约变更的风险', decisionNeeded: '是否采用方案 A', recommendationStatus: '暂定方案 A，需确认兼容性',
    currentPhase: 'plan', goal: '保持旧配置兼容', userIntent: '降低迁移风险', acceptanceCriteria: '旧配置继续工作',
    nonGoals: '不重构配置系统', constraints: '保持 strict TypeScript', currentState: '已有 schema 与调用方',
    changedFiles: 'src/config/schema.ts', changedSymbols: 'PluginConfig', impact: '影响所有配置读取方', callChain: 'schema -> config loader', behavior: '当前旧字段可读取',
    alternatives: '方案 A/B', selectedApproach: '方案 A', tradeoffs: '兼容性优先、实现略复杂', rejectedOptions: '直接删除旧字段',
    lockedDecisions: '保留旧字段', assumptions: '宿主仍发送旧配置', edgeCoverage: '缺失字段/旧版本', truths: '旧配置可启动', prohibitions: '不得破坏旧字段',
    evidence: 'bun test src/config/schema.test.ts exit 0', priorFindings: '无', unresolvedBlockers: '无', contextPaths: 'docs/config.md',
    expectedOutput: '结构化 findings 与推荐', stateHead: 'abc1234', diffScope: 'src/config/schema.ts', evidenceFreshness: 'fresh',
  };

  test('完整 Brief 输出背景、证据与只读边界', () => {
    const text = formatOracleBrief(complete);
    expect(text).toContain('## Oracle Brief');
    expect(text).toContain('### 需求与范围');
    expect(text).toContain('### 当前状态与影响面');
    expect(text).toContain('state_head: abc1234');
    expect(text).toContain('- read_only: true');
    expect(text).toContain('- no_verdict: true');
    expect(getMissingOracleBriefFields(complete)).toEqual([]);
    expect(getMissingOracleSceneFields(complete)).toEqual([]);
  });

  test('缺失必填背景时显式报告信息缺口，不允许静默猜测', () => {
    const missing = getMissingOracleBriefFields({ scene: 'analysis', objective: '方案分析' });
    expect(missing).toContain('decisionNeeded');
    expect(missing).toContain('contextPaths');
    expect(formatOracleBrief({ ...complete, evidence: '' })).toContain('信息缺口: evidence');
    expect(getMissingOracleSceneFields({ ...complete, scene: 'diff-review', diffScope: '' })).toContain('diffScope');
  });
});
