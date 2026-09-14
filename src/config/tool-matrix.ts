import { DIRECT_MCP_SERVER } from '../cbm/registry';

/**
 * 工具选择规则的单一来源（任务语言决策表 + 调用形态公共句）。
 *
 * 分层边界（防重复定义）：
 * - 本模块回答「什么任务用什么工具」：以任务语言（找定义/查调用链/找文本/找文件…）
 *   为行、首选→兜底链为列；消费方为 `config/constants.ts` 的文件操作规则与各 agent prompt。
 * - `src/cbm/registry.ts` 的 `DIRECT_MCP_POLICY` 回答「CBM 通道怎么调」：direct → wrapper →
 *   grep/read 降级、参数契约与通道错误清单。矩阵只引用工具名，不复述通道协议。
 * - 场景细则（depth 分层、90s 预算、生命周期）留在 registry 与各阶段 skill，不进入本模块。
 *
 * 历史背景（2026-09 方案 B 重构）：此前「代码库检查优先使用专用文件工具」与
 * 「结构化检索优先 CBM」两条全称「优先」规则语义冲突，且决策表无 CBM 分支，导致
 * 真实会话中符号/调用链检索大量直落 grep/read。矩阵以任务语言统一裁决两规则的适用域。
 */

/** 工具来源与调用形态公共句（原 constants.ts 两份逐字重复句的唯一来源）。 */
export const TOOL_SOURCE_NOTE =
  '工具来源：read/grep/glob/list/lsp/codesearch/webfetch/websearch 是宿主提供的工具——' +
  '按照当前会话工具目录直接按名称调用；绝不能通过 Code Mode `execute` 代理调用，' +
  '也绝不能臆造目录中不存在的工具名。文本/正则搜索使用 `grep`；不存在通用的 `search` 工具。';

/** shell 跨平台注意句（原 constants.ts 两份近似重复句的唯一来源，供差异句拼装）。 */
export const SHELL_OS_NOTE =
  '注意：shell 工具的实际 shell 以其工具描述中的 OS/Shell 标注为准' +
  '（Windows 上通常是 PowerShell 或 cmd.exe，并非 bash）——命令动词、引号与连接符必须跟随该 shell' +
  '（Windows PowerShell 5.1 不支持 `&&`，用 `cmd1; if ($?) { cmd2 }`），' +
  '不要默认 Unix 语法（grep/sed/cat 在 PowerShell/cmd 下通常不存在）。';

/** 禁止 shell 读文件句（原 constants.ts 两份逐字重复句的唯一来源）。 */
export const NO_SHELL_READ_NOTE =
  '不要仅为读取代码而使用 cat/head/tail/sed/awk（或其 Windows 等价物 type/Get-Content/Select-String）；' +
  '使用 read/grep，除非 Shell 管道确实更适合诊断。';

/**
 * 工具选择矩阵：按任务语言直查，命中首列即用；通道不可用按箭头降级。
 * 括号内为工具名（direct 优先形态在前，`cbm_*` wrapper 为兜底形态）；
 * 通道调用细节（direct/wrapper 切换条件、参数契约）见 codebase-memory-mcp 优先规则，不在本表复述。
 */
export const TOOL_SELECTION_MATRIX = `**工具选择矩阵**（按任务语言直查；命中首列即用，通道不可用按箭头降级；CBM 通道细节见 \`${DIRECT_MCP_SERVER}\` 优先规则）：
- 找函数/类/接口/方法的定义或位置、找模块入口（"X 在哪里""查找 Y"）→ CBM 检索（search_graph / cbm_search_graph）→ grep 兜底
- 谁调用 X、X 调用谁、调用链与依赖关系追踪 → CBM 检索（trace_path / cbm_trace）→ grep 逐点排查兜底
- 改动影响面 / 依赖波及评估 → CBM 检索（detect_changes / cbm_detect_changes）→ grep+read 手工排查兜底
- 读指定符号的源码片段 → CBM 检索（get_code_snippet / cbm_code）→ read 兜底
- 按内容找字符串、注释、变量名等文本 → grep（不用 CBM）
- 按语法结构找模式（函数形状、类结构）→ ast_grep_search（不用 CBM）
- 按名称/扩展名找文件 → glob（不用 CBM）
- 读取文件内容 → read（不用 CBM）
- 外部库/API/官方文档/网络资料 → websearch/webfetch（不用 CBM）`;
