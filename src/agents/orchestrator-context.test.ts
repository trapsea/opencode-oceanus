import { describe, expect, test } from 'bun:test';
import {
  DELEGATION_BRIEF_PROMPT,
  formatDelegationBrief,
  formatResearchBrief,
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
});

describe('formatDelegationBrief 回归', () => {
  test('八字段完整渲染与尾部 BLOCKED 提示保持不变', () => {
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
      '- 目标: 为工具新增参数校验',
      '- 背景: 工具输入缺少校验',
      '- 已确认决策: 采用 Zod schema',
      '- 文件归属: src/tools/example.ts',
      '- 禁止事项: 不得改 src/index.ts',
      '- 依赖/结果: 依赖 config 加载完成',
      '- 验收: typecheck 通过',
      '- 测试命令: bun test',
      '- 风险: 公共 API 变更影响调用方',
    ]) {
      expect(text).toContain(anchor);
    }
    expect(text).toContain('若缺少任一项，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父级 agent。');
    expect(DELEGATION_BRIEF_PROMPT).toContain('委派简报');
  });
});
