import type { CommandDefinition, CommandInvocation } from './types';

/**
 * `/git-commit` server command（v2 命令通道）。
 *
 * 对话式 Git 提交分析：把「扫描变更 → 归类意图 → 拆分提交组 → 生成
 * commit 建议」的工作流指令注入当前会话，由当前 agent（通常是 oceanus）
 * 执行。与 `/preset` 的 synthetic 回执不同，这里走 `session.prompt`
 * 注入用户消息并触发 LLM turn。
 *
 * 指令继承自团队 git-analyze-commit skill，但剥离了 plan_state.py 脚本
 * 归因体系（publish 快照、manifest trailer）；AI 产出标记简化为统一的
 * `[AI]` commit 前缀。
 *
 * 安全边界（写入指令正文，由执行 agent 遵守）：
 * - 分析完成后必须用 question 工具征求用户决策（提交/继续拆分/不提交）。
 * - 仅在用户明确选择提交后才执行 git add / git commit；绝不执行 git push。
 */
export interface GitCommitCommandHandlers {
  /**
   * 注入用户消息并触发 LLM turn。
   * 需透传 delivery（steer/queue）以匹配用户提交意图。
   */
  prompt: (sessionID: string, text: string, delivery: 'steer' | 'queue') => Promise<void>;
  /** 无 LLM turn 的降级回执（session.prompt 能力缺失或失败时兜底）。 */
  reply: (sessionID: string, text: string) => Promise<void>;
}

/** 指令正文：由执行 agent 遵循的提交分析工作流（默认单次提交，优先速度）。 */
export function buildGitCommitInstruction(argument: string): string {
  const lines = [
    '请按以下流程**快速**分析当前项目的未提交变更并生成 commit 建议（默认单次提交，速度优先）：',
    '',
    '## 步骤一：一次性扫描（只跑这几条命令，禁止逐文件循环 diff）',
    '在当前项目目录执行：',
    '    git status --short',
    '    git diff HEAD --stat',
    '    git diff HEAD --unified=0',
    '- `git diff HEAD` 已同时覆盖已暂存与未暂存变更，无需再分别执行 `--cached`',
    '- `--unified=0` 去掉上下文行以压缩输出，足以判定意图；不要为“看得更全”而反复放大 diff',
    '- 若 `git status --short` 无任何变更，回复「当前无未提交的变更」并结束',
    '- 若 diff 输出过大（超过约 500 行），以 `git diff HEAD --stat` 概览为主，仅对少数关键文件补充 `git diff HEAD --unified=0 -- <文件>`，不要逐个文件全量读取',
    '- `git status --short` 中 `??` 的未跟踪文件不在 `git diff HEAD` 内，按文件名推断用途即可；确有必要时只读取个别未跟踪文件的开头若干行',
    '',
    '## 步骤二：判定标签（沿用既有规则）',
    '按本次变更的主要意图选定一个标签：',
    '- `[需求]`：新功能（新增类、方法、页面、组件）',
    '- `[缺陷]`：缺陷修复（bug、异常、校验问题）',
    '- `[通用]`：重构、样式、文档、配置、测试、构建',
    '- `[紧急]`：明确标记为紧急的修复（模块名可省略）',
    '多个意图并存时，取变更量最大、最能概括整体改动的一个标签，不为此反复权衡或前置拆分。',
    '',
    '## 步骤三：生成单条 Commit 建议（默认一次提交）',
    '格式：`[AI][标签][模块名] 简短描述`，严格遵守：',
    '- 所有 commit message 前缀必须带 `[AI]`（标记本条提交由 AI 辅助生成）',
    '- 标签取值：`[需求]` 新功能、`[缺陷]` 缺陷修复、`[通用]` 重构/样式/文档/配置/测试/构建、`[紧急]` 紧急修复（模块名可省略）',
    '- 描述用中文，不超过 20 个字，说明做了什么而非怎么做',
    '- 禁止无意义描述（如 "update"、"修改"、"fix"）',
    '- 模块名用英文小写 kebab-case：后端取业务模块（merchant/order）、前端取页面或组件目录名、配置/脚本取目录名、文档取所属模块',
    '- 不使用旧格式 `type(module): description`',
    '- 默认把所有变更合并为一次提交，直接给出唯一一条建议；除非用户明确要求，否则不生成拆分方案',
    '',
    '## 输出格式',
    '用一句话概括本次改动，再给出建议提交方案（默认 1 次），不逐个文件罗列意图归类：',
    '',
    '    建议提交（共 1 次）：',
    '    git add -A',
    '    git commit -F <临时消息文件>（用 write 工具写入 "[AI][标签][模块名] 简短描述"）',
    '',
    '## 步骤四：用 question 工具征求用户决策（必须执行）',
    '输出建议后，立即用 question 工具向用户提问，固定提供以下选项：',
    '1. **确认提交**：按建议执行 `git add` + `git commit`（失败时立即停止并报告现场）',
    '2. **不提交**：保留建议，不执行任何 git 写操作',
    '3. **继续拆分**：仅当用户想要更细粒度时，再按功能点重新分析并给出拆分建议，然后再次询问',
    '用户未选择前不得执行任何 git 写操作；不得执行 `git push`。',
    '',
    '## 安全约束',
    '- 仅在用户通过 question 明确选择提交后才执行 git add / git commit；绝不执行 git push',
    '- commit message 用中文——经 `-m` 内联传递在 Windows PowerShell/cmd 下有引号与编码（GBK/UTF-8）风险：统一用 write 工具把消息写入 shell 工具描述中标注的 tmp 目录下的临时文件，再 `git commit -F <该文件>`，提交后删除临时文件',
    '- `git add -A` 会纳入全部变更；若存在不想纳入的未跟踪文件，改用显式文件列表',
    '- 现有 staged 内容不得被静默重组或覆盖；发现与建议无关的暂存内容时先报告',
    '- 检测到调试代码（console.log、System.out.println 等）时先提醒清理',
    '- 变更文件很多时仍默认单次提交，但在建议中注明变更规模（如「N 个文件」）供用户判断',
  ];
  if (argument) {
    lines.push('', `## 补充要求`, argument);
  }
  return lines.join('\n');
}

export function createGitCommitCommand(handlers: GitCommitCommandHandlers): CommandDefinition {
  return {
    name: 'git-commit',
    description:
      '快速分析当前未提交变更并生成 commit 建议（默认单次提交，统一 [AI] 前缀 + 标签体系 [需求]/[缺陷]/[通用]/[紧急]），一次性扫描后立即给出建议并用 question 询问是否提交；/git-commit [补充要求] 可附加约束。',
    async execute(invocation: CommandInvocation) {
      const instruction = buildGitCommitInstruction(invocation.prompt.text.trim());
      try {
        await handlers.prompt(invocation.sessionID, instruction, invocation.delivery);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handlers
          .reply(
            invocation.sessionID,
            `Git-commit command failed（提交分析指令注入失败）: ${message}；可改为直接发送上述提交分析要求。`,
          )
          .catch(() => undefined);
      }
    },
  };
}
