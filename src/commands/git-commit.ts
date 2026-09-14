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

/** 指令正文：由执行 agent 遵循的提交分析工作流。 */
export function buildGitCommitInstruction(argument: string): string {
  const lines = [
    '请按以下流程分析当前项目的未提交变更并生成 commit 建议：',
    '',
    '## 步骤一：扫描变更',
    '在当前项目目录执行 `git status --short`、`git diff --stat`、`git diff --cached --stat`。',
    '如果无任何变更，回复「当前无未提交的变更」并结束。',
    '',
    '## 步骤二：分析变更内容',
    '对每个变更文件查看 `git diff`，分析修改意图并归类标签：',
    '- `[需求]`：新功能（新增类、方法、页面、组件）',
    '- `[缺陷]`：缺陷修复（bug、异常、校验问题）',
    '- `[通用]`：重构、样式、文档、配置、测试、构建',
    '- `[紧急]`：明确标记为紧急的修复（模块名可省略）',
    '',
    '## 步骤三：判断提交策略',
    '| 情况 | 策略 |',
    '|------|------|',
    '| 所有变更属于同一功能点 | 合并为一次提交 |',
    '| 变更涉及多个独立功能点 | 按功能点拆分为多次提交 |',
    '| 同一模块的紧密关联变更 | 合并为一次提交 |',
    '| 不同模块的无关变更 | 拆分为多次提交 |',
    '| 跨需求变更 | 必须拆分提交 |',
    '',
    '## 步骤四：生成 Commit 建议',
    '格式：`[AI][标签][模块名] 简短描述`，严格遵守：',
    '- 所有 commit message 前缀必须带 `[AI]`（标记本条提交由 AI 辅助生成）',
    '- 标签取值：`[需求]` 新功能、`[缺陷]` 缺陷修复、`[通用]` 重构/样式/文档/配置/测试/构建、`[紧急]` 紧急修复（模块名可省略）',
    '- 描述用中文，不超过 20 个字，说明做了什么而非怎么做',
    '- 禁止无意义描述（如 "update"、"修改"、"fix"）',
    '- 模块名用英文小写 kebab-case：后端取业务模块（merchant/order）、前端取页面或组件目录名、配置/脚本取目录名、文档取所属模块',
    '- 不使用旧格式 `type(module): description`',
    '',
    '## 输出格式',
    '先列出变更文件清单（含每个文件的意图归类），再给出建议提交方案：',
    '',
    '    建议提交（共 N 次）：',
    '',
    '    --- 提交 1/N ---',
    '    git add <文件...>',
    '    git commit -F <临时消息文件>（用 write 工具写入 "[AI][标签][模块名] 简短描述"）',
    '',
    '## 步骤五：用 question 工具征求用户决策（必须执行）',
    '输出分析结果和建议后，立即用 question 工具向用户提问，固定提供以下选项：',
    '1. **确认提交**：按上述建议自动执行各组 `git add` + `git commit`（按顺序逐组执行，任一组失败立即停止并报告现场：已完成的 commit、当前暂存区、失败原因）',
    '2. **继续拆分**：说明希望进一步拆分的方向，重新给出更细粒度的建议，然后再次询问',
    '3. **不提交**：保留建议，不执行任何 git 写操作',
    '用户未选择前不得执行任何 git 写操作；不得执行 `git push`。',
    '',
    '## 安全约束',
    '- 仅在用户通过 question 明确选择提交后才执行 git add / git commit；绝不执行 git push',
    '- commit message 用中文——经 `-m` 内联传递在 Windows PowerShell/cmd 下有引号与编码（GBK/UTF-8）风险：统一用 write 工具把消息写入 shell 工具描述中标注的 tmp 目录下的临时文件，再 `git commit -F <该文件>`，提交后删除临时文件',
    '- 不将不相关的变更合并到同一次提交',
    '- 现有 staged 内容不得被静默重组或覆盖；发现与建议无关的暂存内容时先报告',
    '- 检测到调试代码（console.log、System.out.println 等）时先提醒清理',
    '- 变更文件超过 20 个时，建议确认是否分批提交',
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
      '分析当前未提交变更并生成 commit 建议（统一 [AI] 前缀 + 标签体系 [需求]/[缺陷]/[通用]/[紧急]，支持按功能点拆分），分析后用 question 询问是否提交；/git-commit [补充要求] 可附加约束。',
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
