import type { CommandDefinition, CommandInvocation } from './types';

/**
 * `/ai-ratio` server command（v2 命令通道）。
 *
 * AI 代码生成占比统计：把「确定统计范围 → 采集提交 → 判定 AI/人工 →
 * 按开发者/模块统计 → 输出报告」的工作流指令注入当前会话，由当前
 * agent（通常是 oceanus）用 git 命令现场执行。
 *
 * 设计动机：团队原有 python 脚本（ai_code_ratio.py）承担同样的统计，
 * 但 command 层不与其耦合——不引用脚本路径、不要求 python 环境。
 * 判定规则与 `/git-commit` 产出的 `[AI]` 前缀体系统一维护；统计逻辑
 * 以指令正文形式下沉给执行 agent，未来规则演进只改本文件。
 *
 * 安全边界：全程只读（git log / git show --numstat），不产生任何
 * 工作区或仓库写入。
 */
export interface AiRatioCommandHandlers {
  /**
   * 注入用户消息并触发 LLM turn。
   * 需透传 delivery（steer/queue）以匹配用户提交意图。
   */
  prompt: (sessionID: string, text: string, delivery: 'steer' | 'queue') => Promise<void>;
  /** 无 LLM turn 的降级回执（session.prompt 能力缺失或失败时兜底）。 */
  reply: (sessionID: string, text: string) => Promise<void>;
}

/**
 * 解析 `/ai-ratio` 参数中的日期类过滤（--since / --branch），供指令
 * 正文回显统计范围。无法识别的内容整体落入「补充要求」。
 */
export function parseAiRatioArgument(argument: string): { since?: string; branch?: string; extra: string } {
  const sinceMatch = argument.match(/(?:^|\s)--since[=\s]+([^\s]+)/);
  const branchMatch = argument.match(/(?:^|\s)--branch[=\s]+([^\s]+)/);
  const extra = argument
    .replace(/(?:^|\s)--since[=\s]+[^\s]+/g, '')
    .replace(/(?:^|\s)--branch[=\s]+[^\s]+/g, '')
    .trim();
  return {
    since: sinceMatch?.[1],
    branch: branchMatch?.[1],
    extra,
  };
}

/** 指令正文：由执行 agent 遵循的 AI 代码占比统计工作流。 */
export function buildAiRatioInstruction(argument: string): string {
  const { since, branch, extra } = parseAiRatioArgument(argument);
  const lines = [
    '请按以下流程统计当前项目的 AI 代码生成占比并输出报告：',
    '',
    '## 步骤一：用 question 工具批量询问统计范围（必须执行）',
    '立即用 question 工具一次性批量提问以下两个独立问题（一次调用、两个 questions，不要分两次询问）：',
    '',
    '问题 1 —— 统计时间范围：',
    '1. 最近 1 个月',
    '2. 最近 1 年',
    '3. 全部历史',
    '（同时允许用户自定义输入起始日期，如 `2026-03-01`，统计该日期至今天的提交）',
    '',
    '问题 2 —— 统计分支：',
    '1. 当前分支（默认，直接用 `git branch --show-current` 的结果）',
    '（同时允许用户自定义输入其他分支名，如 `feat/merchant-F01`）',
    '',
    '用户作答前不得开始任何统计；若用户通过 `/ai-ratio` 参数已显式指定范围（见下方回显），则跳过对应问题，只询问未指定的一项（若两项均已指定则跳过本步骤）。',
    '',
    '## 步骤二：确定统计范围',
    '按用户答复在当前项目目录用 git 命令采集提交（全程只读，禁止任何写操作）：',
    '    git log --no-merges --pretty=format:"%H|%an|%ae|%cn|%ad|%s" --date=short',
    '- 时间范围换算为 `--since=<起始日期>`（1 个月/1 年按当前日期回推；自定义日期按用户输入）',
    '- 分支作为 git log 的位置参数',
    ...(branch ? [`- 参数已指定分支：${branch}（跳过分支询问）`] : []),
    ...(since ? [`- 参数已指定起始日期：${since}（跳过时间范围询问）`] : []),
    '- `--no-merges` 必须保留：merge commit 的 diff 会把已统计过的提交重复计算',
    '- 提交数量很大时可分批采集（按时间或 SHA 分段），不要截断数据',
    '',
    '## 步骤三：判定 AI 提交',
    '每条提交按以下规则判定（满足任一即为 AI 提交）：',
    '- author email 为 `ai-gen@company.com`',
    '- author 名以 `AI-Gen` 开头（兼容 `AI-Gen(开发者)` 形式）',
    '- commit message 以 `[AI]` 开头',
    '- commit message 以 `ai-gen` 开头（兼容旧格式）',
    '',
    '## 步骤四：采集行数与归属',
    '对每条提交执行 `git show --numstat --format="" <hash>` 统计增删行数：',
    '- 二进制文件（首列为 `-`）跳过',
    '- `.ai-attribution/` 路径下的归因元数据文件跳过，不计入代码产出',
    '- 开发者归属三级回退：message 中 `[@开发者]` 标记 → author 名 `AI-Gen(开发者)` 括号 → committer（真人提交者，排除 AI-Gen 自身）',
    '- 模块名从 message 提取：`[标签][模块名] 描述` 的第二个中括号；兼容旧格式 `type(module): description` 的括号；都无则为 unknown',
    '',
    '## 步骤五：计算指标',
    '- 总览：总提交数、AI 提交数与占比、AI 生成新增行数、人工新增行数、AI 代码贡献率',
    '- 人工修改率 = 人工新增行数 / (人工新增行数 + AI 生成新增行数) × 100%',
    '- AI 代码贡献率 = AI 生成新增行数 / (人工新增行数 + AI 生成新增行数) × 100%',
    '- 按开发者：每人的 AI 协作比（AI 提交数、AI 新增行数、人工提交数、人工新增行数）与 AI 代码贡献率（AI 生成新增行数 / (人工新增行数 + AI 生成新增行数) × 100%）',
    '- 按模块：各模块的 AI 贡献（AI/人工新增行数与提交数）',
    '- 分母（人工新增行数 + AI 生成新增行数）为 0 时，人工修改率与 AI 代码贡献率记为 0% 或 N/A，不得输出除零错误',
    '',
    '## 输出格式',
    '输出 Markdown 报告，包含四个部分：',
    '1. 总览（统计范围、时间、上述总体指标）',
    '2. 按开发者统计表（开发者 | AI 提交 | AI 新增行 | 人工提交 | 人工新增行 | AI 代码贡献率）',
    '3. 按模块统计表（模块 | AI 新增行 | 人工新增行 | AI 提交 | 人工提交）',
    '4. 一段简短结论（AI 参与度最高的开发者与模块、AI 代码贡献率与人工修改率是否健康）',
    '',
    '## 安全约束',
    '- 全程只使用只读 git 命令（log / show / rev-parse），禁止任何工作区或仓库写操作',
    '- 统计必须基于真实命令输出，不得估算或编造数字',
  ];
  if (extra) {
    lines.push('', '## 补充要求', extra);
  }
  return lines.join('\n');
}

export function createAiRatioCommand(handlers: AiRatioCommandHandlers): CommandDefinition {
  return {
    name: 'ai-ratio',
    description:
      '统计当前项目 AI 代码生成占比：先批量询问统计时间范围（1 个月/1 年/全部/自定义起始日期）与分支（默认当前分支），再用只读 git 分析 AI vs 人工的提交数与新增行数（按开发者/模块拆分）并输出 Markdown 报告；/ai-ratio [--since 日期] [--branch 分支] [补充要求] 可预先指定范围跳过对应询问。',
    async execute(invocation: CommandInvocation) {
      const instruction = buildAiRatioInstruction(invocation.prompt.text.trim());
      try {
        await handlers.prompt(invocation.sessionID, instruction, invocation.delivery);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handlers
          .reply(
            invocation.sessionID,
            `Ai-ratio command failed（占比分析指令注入失败）: ${message}；可改为直接发送上述占比分析要求。`,
          )
          .catch(() => undefined);
      }
    },
  };
}
