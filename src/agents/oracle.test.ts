import { describe, expect, test } from 'bun:test';
import { createOracleAgent } from './oracle';
import { cbmSection } from '../cbm/registry';
import { REVIEW_SCENES } from '../review/scenes';

describe('oracle 基础定义', () => {
  test('工厂返回 name/mode/temperature 不变', () => {
    const definition = createOracleAgent();
    expect(definition.name).toBe('oracle');
    expect(definition.mode).toBe('subagent');
    expect(definition.temperature).toBe(0.1);
  });

  test('description 涵盖 consult/analysis 顾问场景', () => {
    const description = createOracleAgent().description;
    expect(description).toContain('consult');
    expect(description).toContain('analysis');
    expect(description).toContain('顾问');
    expect(description).toMatch(/可选分析顾问/);
  });

  test('model 传入时原样写入定义', () => {
    const model = { id: 'claude-sonnet-4', providerID: 'anthropic' };
    const definition = createOracleAgent(model);
    expect(definition.model).toBe(model);
  });
});

describe('oracle 场景路由段', () => {
  test('system 包含场景路由关键锚点', () => {
    const system = createOracleAgent().system!;
    expect(system).toContain('<oracle_scene');
    expect(system).not.toContain('[OKAY]');
    expect(system).not.toContain('[REJECT]');
    expect(system).not.toContain('Blocking Issues');
    expect(system).toContain('analysis');
    expect(system).toContain('consult');
  });

  test('场景指令底线语义：内置标准指令不可省略或削弱，只读永不失效', () => {
    const system = createOracleAgent().system!;
    expect(system).toMatch(/可选顾问/);
    expect(system).toMatch(/只读约束永不失效/);
  });

  test('analysis 场景：结构化对比且不输出门禁格式、不替代用户决策', () => {
    const system = createOracleAgent().system!;
    expect(system).toMatch(/方案对比/);
    expect(system).toMatch(/不.*输出.*\[OKAY\]|\[OKAY\].*不|误解析/);
    expect(system).toMatch(/不替代用户决策/);
  });

  test('analysis 计划审查要求结构化 findings 且保持 advisory', () => {
    const system = createOracleAgent().system!;
    expect(system).toContain('goal-backward');
    expect(system).toContain('edge_coverage');
    expect(system).toContain('required_property');
    expect(system).toContain('不输出 OKAY/REJECT 等放行 verdict');
  });

  test('consult 场景为可选顾问且声明信息缺口', () => {
    const system = createOracleAgent().system!;
    expect(system).toMatch(/默认 consult/);
    expect(system).toContain('信息缺口');
  });
});

describe('oracle 内嵌场景标准指令（0.46.1 修复：注册表 checks 不再是死代码）', () => {
  test('内嵌 analysis 完整检查清单与必附上下文', () => {
    const system = createOracleAgent().system!;
    expect(system).toContain('<oracle_scene name="analysis">');
    expect(system).toContain('**必附上下文**');
    expect(system).toContain('信息缺口');
    expect(system).toContain('spec / intake 报告路径');
    expect(system).toContain('已有的 research_brief / findings');
  });

  test('内嵌 solution-analysis 指令', () => {
    const system = createOracleAgent().system!;
    expect(system).toContain('<oracle_scene name="analysis">');
    expect(system).toContain('BACKGROUND_RESEARCH');
    expect(system).toContain('SOLUTION_ANALYSIS');
    expect(system).not.toContain('<oracle_scene name="diff-review">');
    expect(system).not.toContain('<oracle_scene name="completion-audit">');
  });

  test('visual-acceptance（observer 场景）不内嵌于 oracle', () => {
    const system = createOracleAgent().system!;
    expect(system).not.toContain('<oracle_scene name="visual-acceptance">');
  });

  test('内嵌内容与场景注册表单一来源一致', () => {
    const system = createOracleAgent().system!;
    expect(system).toContain(REVIEW_SCENES['solution-analysis']!.checks);
  });
});

describe('oracle 原人设与注入保持', () => {
  test('system 保留原顾问人设与 READ-ONLY 语义', () => {
    const system = createOracleAgent().system!;
    expect(system).toContain('战略技术顾问');
    expect(system).toContain('高难度调试');
    expect(system).toMatch(/READ-ONLY/);
    expect(system).toContain('相关时指出具体文件/行号');
  });

  test('cbmSection("oracle") 注入保持不变', () => {
    const system = createOracleAgent().system!;
    expect(system).toContain(cbmSection('oracle'));
  });
});

describe('oracle 提示词覆盖逻辑', () => {
  test('customPrompt 整体替换 system', () => {
    const definition = createOracleAgent(undefined, '自定义整体提示词');
    expect(definition.system).toBe('自定义整体提示词');
    expect(definition.system).not.toContain('战略技术顾问');
  });

  test('customAppendPrompt 追加到默认提示词之后', () => {
    const base = createOracleAgent().system!;
    const definition = createOracleAgent(undefined, undefined, '追加段落');
    expect(definition.system).toBe(`${base}\n\n追加段落`);
  });

  test('customPrompt 与 customAppendPrompt 同时提供时 customPrompt 优先', () => {
    const definition = createOracleAgent(undefined, '整体替换', '被忽略的追加');
    expect(definition.system).toBe('整体替换');
  });
});
