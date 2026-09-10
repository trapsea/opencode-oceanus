/**
 * CBM 规则注册表（单一来源）。
 *
 * 收敛散落在各 agent prompt / skill / 测试中的 CBM 规则文本：
 * - `CBM_TOOLS`：注册工具名的唯一硬编码处（tools/cbm/builders.ts 与契约测试共用）；
 * - `CBM_QUERY_EXAMPLES`：共享查询示例族（OrderHandler）；
 * - `CBM_LIFECYCLE`：CBM 主线（intake 首次初始化 → plan 自查 impact_estimate → review
 *   实际 diff 影响面复查），完整文本只注入 sisyphus 主 agent 一处；
 * - `cbmSection(role)`：explorer/oracle/fixer/librarian 的角色 CBM
 *   段落（差异化语义保留，工具名/示例/公共句从本模块拼装）。
 *
 * 主线语义（三阶段闭环）：
 * 1. Intake：代码/混合任务由 Sisyphus 直接首次 `cbm_index` 一次，fail-open；
 * 2. Plan 自查影响面预估：计划阶段校验 impact_estimate 是否覆盖已知影响面；
 *    Oracle 仅按需提供 advisory，不承担门禁；
 * 3. Review 影响面复查：按最终 diff 需要时刷新索引后再次排查，并与 Plan 自查预估
 *    对比；CBM 不可用记录 stale、降级证据、覆盖范围和残余风险。
 *
 * 本模块是纯文本/常量模块，不依赖 agents 或 tools，避免循环引用。
 */

/** 注册的 CBM 工具名（顺序稳定；唯一硬编码处）。 */
export const CBM_TOOLS = [
  'cbm_status',
  'cbm_index',
  'cbm_search_graph',
  'cbm_trace',
  'cbm_code',
  'cbm_query',
  'cbm_detect_changes',
] as const;

export type CbmTool = (typeof CBM_TOOLS)[number];

/** Oceanus 托管的直接 MCP server 名；实际调用前仍须检查当前会话 catalog。 */
export const DIRECT_MCP_SERVER = 'codebase-memory-mcp';

/** 查询型工具集合：不触发全量索引，只读分析使用。 */
export const CBM_QUERY_TOOLS: readonly CbmTool[] = [
  'cbm_status',
  'cbm_search_graph',
  'cbm_trace',
  'cbm_code',
  'cbm_query',
  'cbm_detect_changes',
] as const;

/** 共享查询示例族（各角色段落按需引用，避免六处硬编码漂移）。 */
export const CBM_QUERY_EXAMPLES =
    '示例：cbm_search_graph(query=".*OrderHandler.*", limit=20)、' +
  'cbm_trace(symbol="OrderHandler", direction="inbound", depth=3)、' +
  'cbm_code(qualified_name="pkg.OrderHandler")、' +
  'cbm_query(query="MATCH ... RETURN ...")、' +
  'cbm_detect_changes(since="HEAD~1", direction="inbound", depth=3)。';

/**
 * codebase-memory-mcp（direct MCP）的优先使用与参数契约；`cbm_*` wrapper 兜底。
 *
 * 这里刻意不把 `cbm_index` / `cbm_query` 的主通道改为 direct：前者保留 workspace
 * 边界与索引生命周期，后者保留本地只读 Cypher 拦截。
 */
export const DIRECT_MCP_POLICY = `**codebase-memory-mcp 优先规则**：
1. 结构化代码发现默认使用当前会话 tool catalog 中的 \`${DIRECT_MCP_SERVER}\` 原生工具：\`search_graph\`、\`trace_path\`、\`get_code_snippet\`、\`detect_changes\`（及 \`index_status\` 项目确认、只读 \`get_graph_schema\`/\`query_graph\`）。调用前先 \`${DIRECT_MCP_SERVER}.list_projects\`，并用 \`index_status({ project })\` 确认当前 workspace \`root_path\` 的唯一健康项目，再以原生参数契约调用（direct 字段 \`function_name\`/\`qualified_name\` 等，不套用 wrapper 字段名）。
2. 仅当 catalog 无 \`${DIRECT_MCP_SERVER}\`、\`list_projects\`/\`index_status\` 失败、传输/超时、工具缺失或明确参数协议拒绝时，才回退到同义的 \`cbm_*\` wrapper：\`cbm_search_graph(query)\`、\`cbm_trace(symbol, direction, depth)\`、\`cbm_code(qualified_name)\`、\`cbm_detect_changes(since, direction, depth)\`。注意字段映射：\`cbm_trace.symbol\` ↔ direct \`function_name\`，未找到或歧义时返回诊断并缩小搜索，不把 wrapper/direct 字段名混用。
3. 索引生命周期与 Cypher 保持 wrapper 专用：首次索引和 Review 刷新使用 \`cbm_index\`（workspace 边界与生命周期控制），Cypher 只使用 \`cbm_query\`（本地只读拦截）；两者不切到 direct。
4. 业务空结果、符号未解析、歧义、workspace 边界拒绝或写入拒绝不是切换通道的条件。\`cbm_*\` 出现 \`binary_missing\`、\`spawn_failed\`、\`timeout\`、daemon/传输失败、\`invalid_json\` 等通道错误，或两条通道均不可用时，回退 \`grep/read/glob\`。禁止调用 \`delete_project\`、\`ingest_traces\`、\`manage_adr\` 或其他写入型 MCP 工具。`;

export const DIRECT_MCP_DEPTH_POLICY = `**depth 场景规则**：
- \`detect_changes\`（direct MCP；wrapper 兜底为 \`cbm_detect_changes\`）：局部、单文件或低风险变更用 \`depth: 2\`；常规跨模块变更默认显式 \`depth: 3\`；公共 API、配置契约、注册/权限/生命周期或重构用 \`depth: 4\`。超过 4 不作为默认自动行为，先人工收敛种子或拆分变更。
- \`trace_path\`（direct MCP；wrapper 兜底为 \`cbm_trace\`）：私有实现定位用 \`depth: 1\`；模块内调用核对用 \`depth: 2\`；公共函数、接口、路由或配置契约默认 \`depth: 3\`；高风险重构、鉴权、注册或跨层链路用 \`depth: 4\`。不得自动使用 5；结果过多时降低 depth 或增加目标符号，而非截断后声称完整。
- 每次显式传 depth 并记录选择理由；先用较低层数回答当前问题，只有未覆盖验收、公共影响面或风险信号才逐级扩大。空结果不扩大 depth；超时、传输或 daemon 错误走既定 fallback。`;

/** 公共边界句：文本/AST/文件发现/外部资料不用 CBM 替代。 */
export const CBM_BOUNDARY_NOTE =
  '结构化符号/调用链/依赖检索优先 codebase-memory-mcp（direct MCP），通道不可用时用 cbm_* wrapper 兜底；字符串、注释、正则文本用 grep，' +
  'AST 结构匹配用 ast_grep_search，文件名/目录发现用 glob/read，' +
  '外部库资料用 websearch/webfetch，均不用 CBM 替代。';

/** 公共证据句：qualified name / 文件路径 / 行号 / 不确定性 / fail-open。 */
export const CBM_EVIDENCE_NOTE =
  '输出证据必须包含符号名、qualified name、文件路径、行号；' +
  'CBM 证据不足或查询失败时明确标记不确定性并 fail-open 回退 grep/read，' +
  '不把图谱结果当作完整证明。';

/**
 * 六阶段 CBM 主线（完整文本）。
 * 只注入 sisyphus 主 agent 一处；oceanus 等其他 prompt 仅拼装片段
 * （`CBM_BOUNDARY_NOTE` / `CBM_QUERY_EXAMPLES`），防止双重注入。
 */
export const CBM_LIFECYCLE = {
  /** 一句话摘要（供简要引用场景）。 */
  brief:
    'Intake 首次初始化与 Review 受控 cbm_index → codebase-memory-mcp（direct MCP）优先查询 → cbm_* wrapper 兜底 → Plan/Review 记录 impact_estimate 与降级证据。',
  /** 完整主线（`## CBM 阶段边界` 段正文）。 */
  full: [
      '- intake: Sisyphus 直接完成边界收集；代码/混合任务仅尝试一次首次 cbm_index，失败/超时/starting 必须故障开放并记录。',
       '- discuss: 复用 Intake 报告与已建索引；按 codebase-memory-mcp 优先规则做必要的架构/符号定位，不重复初始化 CBM，不因普通文本探索触发全量索引。',
      '- plan: 复用 Intake 报告与已建索引；按 codebase-memory-mcp 优先规则定位符号/调用链，不重复初始化 CBM。',
       '- plan 影响面预估自查: 计划阶段校验 Plan 的 impact_estimate 是否覆盖计划声明的修改文件/公共符号及已知受影响调用方/契约；必要时按 codebase-memory-mcp 优先规则抽查关键点，不要求全量 trace。记录缺口供 Review 对比并写入 plan status；Oracle 仅按需提供 advisory 建议，不授予权限、不输出放行 verdict；只做查询、不重建索引；CBM 不可用时 fail-open，标注不确定性，不虚构影响面；简单任务跳过校验需记录理由。',
       '- execute: 高风险公共符号修改前按 codebase-memory-mcp 优先规则做 trace/impact；Cypher 保持 cbm_query。普通机械修改不强制查询。',
       '- review: 影响面复查——按最终 diff 需要时调用受控 cbm_index 刷新索引，再按 codebase-memory-mcp 优先规则对实际 diff 再次排查影响面，并与 Plan 自查的预估对比；CBM 不可用时记录 cbm: stale、降级工具、覆盖范围和残余风险。',
     '- finish: 不调用 CBM，只读 Review 报告汇总。',
    '- 阶段 skill 只能补充工作流步骤，不能覆盖上述 CBM 调度边界或把 CBM 强制用于不适合的文本/AST 任务。',
  ].join('\n'),
} as const;

/** 角色 CBM 段落支持的角色集合。 */
export type CbmRole = 'explorer' | 'oracle' | 'fixer' | 'librarian' | 'prometheus';

const EXPLORER_SECTION = `**代码库知识图谱优先级**：
1. 默认使用 \`codebase-memory-mcp\` 命名空间工具：\`search_graph\`、\`trace_path\`、\`get_code_snippet\`（先 \`list_projects\` + \`index_status\` 确认当前 workspace 唯一健康 project）；
2. catalog 无该 server 或出现允许的通道错误时，回退 \`cbm_search_graph\`、\`cbm_trace\`、\`cbm_code\`；
3. \`ast_grep_search\` 做 AST 模式搜索；
4. \`grep/glob/read\` 处理文本、文件发现和最终 fallback。

wrapper 兜底通道允许查询型 CBM：cbm_status、cbm_search_graph、cbm_trace、cbm_code、cbm_query、cbm_detect_changes；禁止调用 cbm_index。

${DIRECT_MCP_POLICY}

${DIRECT_MCP_DEPTH_POLICY}

${CBM_BOUNDARY_NOTE}

${CBM_EVIDENCE_NOTE}

${CBM_QUERY_EXAMPLES}`;

const ORACLE_SECTION = `**代码图谱分析顺序**（架构/调试/审查任务）：
1. 先用 codebase-memory-mcp 的 search_graph/get_code_snippet 读取关键入口和目标符号（先确认唯一健康 project）；
2. 用 trace_path 获取调用方、被调用方和关键深度；
3. 使用 query_graph 或 detect_changes 评估影响面；
4. 再读取必要的上下文文件并给出判断；
5. CBM 证据不足时明确标记不确定性，不把图谱结果当作完整证明。

${CBM_EVIDENCE_NOTE}

${DIRECT_MCP_POLICY}

${CBM_QUERY_EXAMPLES}`;

const FIXER_SECTION = `**改动前影响检查（CBM）**:
- 普通实现不强制调用 CBM；
- 涉及公共函数、接口、路由、配置契约或高风险重构时，修改前按 codebase-memory-mcp 优先规则评估影响面；Cypher 使用 \`cbm_query\`；
- 修改后由主 agent 或 oracle 再做一次影响面验证；不确定影响时先查询再改；
 - CBM 不可用时 fail-open fallback 到 grep/read，不阻塞明确的机械实现。

${DIRECT_MCP_POLICY}

${CBM_QUERY_EXAMPLES}`;

const LIBRARIAN_SECTION = `**本地交叉验证（CBM）**:
- 外部文档、官方 API、GitHub 示例仍使用 websearch/webfetch；
- 需要把外部结论映射到当前仓库时，按 codebase-memory-mcp 优先规则定位本地实现（direct 优先、wrapper 兜底）；
- 不因本地代码问题而启动大范围 Web 搜索；本地定位结果带 qualified name、文件路径和行号，CBM 证据不足时标注不确定性。

${DIRECT_MCP_POLICY}

${CBM_QUERY_EXAMPLES}`;

const PROMETHEUS_SECTION = `**代码库知识图谱优先级（研究编排视角）**：
1. 自查顺序：\`codebase-memory-mcp\` 命名空间工具（\`search_graph\`、\`trace_path\`、\`get_code_snippet\`、\`detect_changes\`；先 \`list_projects\` + \`index_status\` 确认当前 workspace 唯一健康 project）；通道不可用时回退 \`cbm_search_graph\`、\`cbm_trace\`、\`cbm_code\`；再回退 \`grep/glob/read\`。
2. 结构化大范围侦察委派给 \`@explorer\`，外部资料委派给 \`@librarian\`；委派 prompt 中附上你已确认的 CBM 项目状态，避免子 agent 重复探测。
3. 研究场景只使用查询型工具；禁止调用 \`cbm_index\`（权限已拒绝），索引初始化与刷新由主编排工作流负责。

${DIRECT_MCP_POLICY}

${DIRECT_MCP_DEPTH_POLICY}

${CBM_BOUNDARY_NOTE}

${CBM_EVIDENCE_NOTE}

${CBM_QUERY_EXAMPLES}`;

// metis/momus 角色段已迁移至 src/review/scenes.ts 的历史兼容场景 checks。

const SECTIONS: Record<CbmRole, string> = {
  explorer: EXPLORER_SECTION,
  oracle: ORACLE_SECTION,
  fixer: FIXER_SECTION,
  librarian: LIBRARIAN_SECTION,
  prometheus: PROMETHEUS_SECTION,
};

/** 获取角色 CBM 段落（含公共边界句/证据句/示例的拼装）。 */
export function cbmSection(role: CbmRole): string {
  return SECTIONS[role];
}
