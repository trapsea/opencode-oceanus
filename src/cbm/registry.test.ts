/**
 * CBM 规则注册表契约测试（RED→GREEN）。
 *
 * 单一来源收敛：工具名清单、共享示例、三阶段生命周期主线（intake 首次初始化 →
 * plan 自查影响面 → review 刷新并复查）、各角色 CBM 段落与公共边界句。
 */
import { describe, expect, test } from 'bun:test';
import {
  CBM_BOUNDARY_NOTE,
  CBM_EVIDENCE_NOTE,
  CBM_LIFECYCLE,
  CBM_QUERY_EXAMPLES,
  CBM_TOOLS,
  cbmSection,
  type CbmRole,
} from './registry';

const REGISTERED = [
  'cbm_status',
  'cbm_index',
  'cbm_search_graph',
  'cbm_trace',
  'cbm_code',
  'cbm_query',
  'cbm_detect_changes',
];

/** 文本中出现的所有 cbm_* 工具名必须都已注册，且不得出现裸（无 cbm_ 前缀）内部名。 */
function expectRegisteredToolsOnly(text: string): void {
  for (const match of text.matchAll(/\bcbm_[a-z_]+\b/g)) {
    expect(REGISTERED).toContain(match[0]);
  }
  expect(text).not.toMatch(/(?<!cbm_)search_graph/);
  expect(text).not.toMatch(/(?<!cbm_)trace_path/);
  expect(text).not.toMatch(/(?<!cbm_)get_code_snippet/);
  expect(text).not.toMatch(/(?<!cbm_)query_graph/);
  expect(text).not.toMatch(/(?<!cbm_)detect_changes/);
}

describe('CBM_TOOLS 注册清单', () => {
  test('七个注册工具、全部 cbm_ 前缀、顺序稳定', () => {
    expect([...CBM_TOOLS]).toEqual(REGISTERED);
    expect(new Set(CBM_TOOLS).size).toBe(CBM_TOOLS.length);
    for (const name of CBM_TOOLS) expect(name.startsWith('cbm_')).toBe(true);
  });
});

describe('共享示例与公共边界句', () => {
  test('CBM_QUERY_EXAMPLES 使用 OrderHandler 示例族', () => {
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_search_graph(query=".*OrderHandler.*"');
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_trace(symbol="pkg.OrderHandler"');
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_code(qualified_name="pkg.OrderHandler"');
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_query(query="MATCH ... RETURN ...")');
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_detect_changes(since="HEAD~1")');
    expectRegisteredToolsOnly(CBM_QUERY_EXAMPLES);
  });

  test('CBM_BOUNDARY_NOTE 声明文本/AST/文件/Web 不用 CBM 替代', () => {
    expect(CBM_BOUNDARY_NOTE).toMatch(/grep/);
    expect(CBM_BOUNDARY_NOTE).toMatch(/ast_grep_search/);
    expect(CBM_BOUNDARY_NOTE).toMatch(/glob/);
    expect(CBM_BOUNDARY_NOTE).toMatch(/websearch|webfetch/);
    expect(CBM_BOUNDARY_NOTE).toMatch(/不用 CBM 替代|不使用 CBM 替代/);
  });

  test('CBM_EVIDENCE_NOTE 要求 qualified name/路径/行号/不确定性与 fail-open', () => {
    expect(CBM_EVIDENCE_NOTE).toMatch(/qualified name/);
    expect(CBM_EVIDENCE_NOTE).toMatch(/文件路径/);
    expect(CBM_EVIDENCE_NOTE).toMatch(/行号/);
    expect(CBM_EVIDENCE_NOTE).toMatch(/不确定性/);
    expect(CBM_EVIDENCE_NOTE).toMatch(/fail-open/i);
  });
});

describe('CBM_LIFECYCLE 三阶段主线', () => {
  const lifecycle = typeof CBM_LIFECYCLE === 'string' ? CBM_LIFECYCLE : CBM_LIFECYCLE.full;

  test('阶段条目齐全（intake/discuss/plan/execute/review/finish）', () => {
    for (const phase of ['intake', 'discuss', 'plan', 'execute', 'review', 'finish']) {
      expect(lifecycle).toMatch(new RegExp(`- ${phase}:`));
    }
  });

  test('阶段一：intake 负责首次初始化且 fail-open', () => {
    expect(lifecycle).toMatch(/- intake:[\s\S]{0,160}cbm_index/);
    expect(lifecycle).toMatch(/首次初始化|仅尝试一次/);
    expect(lifecycle).toMatch(/fail-open/i);
  });

  test('阶段二：Plan 自查 impact_estimate，Oracle advisory 可选', () => {
    expect(lifecycle).toMatch(/plan[\s\S]{0,400}impact_estimate/);
    expect(lifecycle).toMatch(/cbm_search_graph[\s\S]{0,80}cbm_trace/);
    expect(lifecycle).toMatch(/advisory/);
    expect(lifecycle).toMatch(/plan status|plan 状态/);
    expect(lifecycle).toMatch(/不重建索引|只.*查询|仅.*查询/);
    expect(lifecycle).toMatch(/不确定性/);
  });

  test('阶段三：review 按需刷新并复查影响面（刷新 → 排查 → 对比 → 降级证据）', () => {
    expect(lifecycle).toMatch(/- review:[\s\S]{0,400}cbm_index/);
    expect(lifecycle).toMatch(/再次排查|重新排查/);
    expect(lifecycle).toMatch(/cbm_detect_changes/);
    expect(lifecycle).toMatch(/对比/);
    expect(lifecycle).toMatch(/预估/);
    expect(lifecycle).toMatch(/降级/);
  });

  test('收尾：finish 不调用 CBM；skill 不得覆盖边界', () => {
    expect(lifecycle).toMatch(/- finish:[\s\S]{0,80}不调用 CBM/);
    expect(lifecycle).toMatch(/不能覆盖/);
    expectRegisteredToolsOnly(lifecycle);
  });
});

describe('cbmSection 角色段落', () => {
  const ROLES: CbmRole[] = ['explorer', 'oracle', 'fixer', 'librarian'];

  test('四个角色段落齐全', () => {
    for (const role of ROLES) {
      const section = cbmSection(role);
      expect(section.length).toBeGreaterThan(40);
      expectRegisteredToolsOnly(section);
    }
  });

  test('explorer：查询型允许、禁止 cbm_index、优先级序列与证据句', () => {
    const section = cbmSection('explorer');
    expect(section).toContain('cbm_status');
    expect(section).toContain('cbm_search_graph');
    expect(section).toContain('cbm_trace');
    expect(section).toContain('cbm_code');
    expect(section).toMatch(/禁止.*cbm_index|cbm_index.*禁止/);
    expect(section).toMatch(/ast_grep_search/);
  });

  test('oracle：code→trace→query/detect_changes 分析顺序', () => {
    const section = cbmSection('oracle');
    expect(section).toContain('cbm_code');
    expect(section).toContain('cbm_trace');
    expect(section).toContain('cbm_query');
    expect(section).toMatch(/cbm_detect_changes/);
    expect(section).toMatch(/不确定性/);
  });

  test('fixer：高风险公共符号修改前 trace/query 影响面，普通机械修改不强制', () => {
    const section = cbmSection('fixer');
    expect(section).toContain('cbm_trace');
    expect(section).toContain('cbm_query');
    expect(section).toMatch(/高风险|公共/);
    expect(section).toMatch(/修改前/);
    expect(section).toMatch(/不强制/);
    expect(section).toMatch(/fail-open|fallback|回退/i);
  });

  test('librarian：外部资料走 Web，本地交叉验证用查询型 CBM', () => {
    const section = cbmSection('librarian');
    expect(section).toMatch(/websearch|webfetch/);
    expect(section).toContain('cbm_search_graph');
    expect(section).toContain('cbm_code');
  });

  test('已删角色类型面收窄：CbmRole 不再包含 momus/metis（编译期）', () => {
    // @ts-expect-error 'momus' 已不是合法 CbmRole
    const momusRole: CbmRole = 'momus';
    // @ts-expect-error 'metis' 已不是合法 CbmRole
    const metisRole: CbmRole = 'metis';
    expect(momusRole).toBe('momus');
    expect(metisRole).toBe('metis');
  });

  test('已删角色不再有段落：SECTIONS 运行时不残留 momus/metis 键', () => {
    expect(cbmSection('momus' as never)).toBeUndefined();
    expect(cbmSection('metis' as never)).toBeUndefined();
  });

  test('registry 生命周期与 oracle gate 场景对职责文案保持一致', () => {
    expect(CBM_LIFECYCLE.full).toContain('impact_estimate');
    expect(CBM_LIFECYCLE.full).toMatch(/不要求.*全量|不执行.*全量/);
    expect(CBM_LIFECYCLE.full).toMatch(/advisory|建议性/i);
    expect(CBM_LIFECYCLE.full).toMatch(/fail-open/i);
  });
});
