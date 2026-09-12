/**
 * CBM 规则注册表契约测试（RED→GREEN）。
 *
 * 单一来源收敛：工具名清单、共享示例、三阶段生命周期主线（intake 首次初始化 →
 * plan 自查影响面 → review 刷新并复查）、各角色 CBM 段落与公共边界句。
 */
import { describe, expect, test } from 'bun:test';
import {
  CBM_BOUNDARY_NOTE,
  DIRECT_MCP_POLICY,
  DIRECT_MCP_DEPTH_POLICY,
  DIRECT_MCP_SERVER,
  CBM_EVIDENCE_NOTE,
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

/** 文本中出现的所有 cbm_* fallback 工具名必须都已注册。 */
function expectRegisteredToolsOnly(text: string): void {
  for (const match of text.matchAll(/\bcbm_[a-z_]+\b/g)) {
    expect(REGISTERED).toContain(match[0]);
  }
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
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_trace(symbol="OrderHandler", direction="inbound", depth=3)');
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_code(qualified_name="pkg.OrderHandler"');
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_query(query="MATCH ... RETURN ...")');
    expect(CBM_QUERY_EXAMPLES).toContain('cbm_detect_changes(since="HEAD~1", direction="inbound", depth=3)');
    expectRegisteredToolsOnly(CBM_QUERY_EXAMPLES);
  });

  test('DIRECT_MCP_POLICY 固定 codebase-memory-mcp 优先、wrapper 兜底与语义边界', () => {
    expect(DIRECT_MCP_POLICY).toContain('codebase-memory-mcp 优先规则');
    // direct 主通道工具与参数契约
    expect(DIRECT_MCP_POLICY).toContain('search_graph');
    expect(DIRECT_MCP_POLICY).toContain('trace_path');
    expect(DIRECT_MCP_POLICY).toContain('get_code_snippet');
    expect(DIRECT_MCP_POLICY).toContain('detect_changes');
    // wrapper 兜底工具仍完整列出；索引/Cypher 保持 wrapper 专用
    expect(DIRECT_MCP_POLICY).toContain('cbm_search_graph');
    expect(DIRECT_MCP_POLICY).toContain('cbm_trace');
    expect(DIRECT_MCP_POLICY).toContain('cbm_code');
    expect(DIRECT_MCP_POLICY).toContain('cbm_detect_changes');
    expect(DIRECT_MCP_POLICY).toContain('cbm_index');
    expect(DIRECT_MCP_POLICY).toContain('cbm_query');
    // wrapper 兜底仅限通道/基础设施错误
    expect(DIRECT_MCP_POLICY).toMatch(/binary_missing/);
    expect(DIRECT_MCP_POLICY).toMatch(/invalid_json/);
    expect(DIRECT_MCP_POLICY).toMatch(/超时|timeout/);
    // direct 前置：catalog + root_path 项目确认
    expect(DIRECT_MCP_POLICY).toContain(DIRECT_MCP_SERVER);
    expect(DIRECT_MCP_POLICY).toContain('list_projects');
    expect(DIRECT_MCP_POLICY).toContain('root_path');
    // 语义错误与空结果不是切换通道的条件；写工具禁止；参数不混用
    expect(DIRECT_MCP_POLICY).toMatch(/不是切换通道的条件/);
    expect(DIRECT_MCP_POLICY).toMatch(/delete_project|ingest_traces/);
    expect(DIRECT_MCP_POLICY).toMatch(/不把 wrapper\/direct 字段名混用/);
  });

  test('DIRECT_MCP_DEPTH_POLICY 覆盖 detect_changes 与 trace_path 的分层规则', () => {
    expect(DIRECT_MCP_DEPTH_POLICY).toContain('detect_changes');
    expect(DIRECT_MCP_DEPTH_POLICY).toContain('depth: 3');
    expect(DIRECT_MCP_DEPTH_POLICY).toContain('depth: 4');
    expect(DIRECT_MCP_DEPTH_POLICY).toContain('trace_path');
    expect(DIRECT_MCP_DEPTH_POLICY).toContain('不得自动使用 5');
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

describe('cbmSection 角色段落', () => {
  const ROLES: CbmRole[] = ['explorer', 'oracle', 'fixer', 'librarian'];

  test('四个角色段落齐全', () => {
    for (const role of ROLES) {
      const section = cbmSection(role);
      expect(section.length).toBeGreaterThan(40);
      expectRegisteredToolsOnly(section);
    }
  });

  test('explorer：direct MCP 优先、wrapper 兜底、禁止 cbm_index 与证据句', () => {
    const section = cbmSection('explorer');
    expect(section).toContain(DIRECT_MCP_POLICY);
    expect(section).toContain('codebase-memory-mcp');
    expect(section).toContain('cbm_status');
    expect(section).toContain('cbm_search_graph');
    expect(section).toContain('cbm_trace');
    expect(section).toContain('cbm_code');
    expect(section).toMatch(/禁止.*cbm_index|cbm_index.*禁止/);
    expect(section).toMatch(/ast_grep_search/);
  });

  test('oracle：direct 优先、wrapper 兜底，Cypher 仍走 wrapper', () => {
    const section = cbmSection('oracle');
    expect(section).toContain(DIRECT_MCP_POLICY);
    expect(section).toContain('cbm_query');
    expect(section).toMatch(/cbm_detect_changes/);
    expect(section).toMatch(/不确定性/);
  });

  test('fixer：高风险公共符号修改前 direct trace（wrapper 兜底），Cypher wrapper，普通机械修改不强制', () => {
    const section = cbmSection('fixer');
    expect(section).toContain(DIRECT_MCP_POLICY);
    expect(section).toContain('cbm_query');
    expect(section).toMatch(/高风险|公共/);
    expect(section).toMatch(/修改前/);
    expect(section).toMatch(/不强制/);
    expect(section).toMatch(/fail-open|fallback|回退/i);
  });

  test('librarian：外部资料走 Web，本地交叉验证 direct 优先、wrapper 兜底', () => {
    const section = cbmSection('librarian');
    expect(section).toMatch(/websearch|webfetch/);
    expect(section).toContain(DIRECT_MCP_POLICY);
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

});
