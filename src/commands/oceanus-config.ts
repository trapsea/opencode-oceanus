import type { CommandDefinition, CommandInvocation } from './types';
import { describeVendorBlueprint, listVendorBlueprints } from '../config/vendor-blueprints';

/**
 * `/oceanus-config` server command（v2 命令通道，模式同 /git-commit）。
 *
 * 对话式配置生成：把「列出厂商 → question 多选 → 逐个生成 preset →
 * 可选激活」的工作流指令注入当前会话并触发 LLM turn。写入动作由
 * oceanus_config_generate 工具确定性完成，不让 LLM 手写 JSON。
 */
export interface OceanusConfigCommandHandlers {
  /** 注入用户消息并触发 LLM turn。 */
  prompt: (sessionID: string, text: string, delivery: 'steer' | 'queue') => Promise<void>;
  /** 无 LLM turn 的降级回执。 */
  reply: (sessionID: string, text: string) => Promise<void>;
}

/**
 * 默认初始化厂商集合：即维护者当前配置文件中的厂商组合。
 * 真实用户无配置时，/oceanus-config 直接按此集合生成 preset；
 * 其余内置 blueprint（default/aliyun/anthropic/gemini 等）仍可通过
 * 补充要求显式指定生成。
 */
export const DEFAULT_INIT_VENDORS: readonly string[] = [
  'zai',
  'openai',
  'deepseek',
  'ollama-cloud',
  'opencode-go',
];

/** 默认激活的 preset（维护者当前配置）。 */
export const DEFAULT_ACTIVE_PRESET = 'zai';

/** 指令正文：由执行 agent 遵循的配置生成工作流。 */
export function buildOceanusConfigInstruction(argument: string): string {
  const vendorLines = listVendorBlueprints().map((v) => `- ${describeVendorBlueprint(v)}`);
  const defaultVendors = DEFAULT_INIT_VENDORS.join('、');
  const lines = [
    '用户请求初始化 Oceanus 的模型厂商 preset，请按以下流程执行：',
    '',
    '## 步骤一：检测现有配置（必须先执行）',
    '读取用户级配置文件 ~/.config/opencode/opencode-oceanus.jsonc（或 .json），',
    '检查文件是否存在、presets 是否已有内容，然后分两路：',
    '',
    '### 路线 A：文件不存在或 presets 为空（真实用户的常见情况）',
    `直接按默认初始化集合生成：${defaultVendors}（不询问、不覆盖），`,
    '逐个调用 `oceanus_config_generate`（入参 vendor）。不要生成该集合之外的厂商。',
    '',
    '### 路线 B：文件存在且 presets 非空',
    '必须先用 question 工具询问用户（单选）：',
    `1. **初始化默认集合**：生成 ${defaultVendors}；对已存在的同名 preset 以 overwrite=true 覆盖`,
    '   （会丢失 jsonc 注释，提示用户可先备份），用户配置中的其他 preset 保留不动',
    '2. **取消**：不做任何修改',
    '用户未选择前不得写任何配置。',
    '',
    '## 步骤二：调用 oceanus_config_generate 工具生成 preset',
    '对确定要生成的每个厂商调用 `oceanus_config_generate`（路线 B 已确认覆盖时传 overwrite=true）。',
    '- 返回 status=conflict 且用户未确认过覆盖时：用 question 再次确认后以 overwrite=true 重试。',
    '- 返回 status=unknown-vendor / error 时：向用户报告原因并停止该厂商的处理。',
    '',
    '## 内置厂商 blueprint 数据源（默认集合之外的厂商仅通过补充要求显式指定时才生成）',
    ...vendorLines,
    '',
    '用户明确要求自定义厂商时（不在此默认流程内）：用 question 收集自定义厂商的',
    'provider 前缀、主力模型和轻量模型，再组装 preset（结构：agent 名 → { model, variant? }，',
    'agent 分层：主力档 oceanus/sisyphus/oracle/metis/momus，轻量档 librarian/explorer，',
    '中间档 designer/fixer/observer），并直接写入用户级配置的 presets 下（可用 write 工具',
    '编辑 ~/.config/opencode/opencode-oceanus.jsonc，或复用项目提供的配置写入方式）。',
    '',
    '## 步骤三：询问是否激活',
    '初始化完成后，若配置中没有激活的 preset（顶层 preset 字段缺失），用 question 询问用户：',
    `1. 激活默认推荐 ${DEFAULT_ACTIVE_PRESET}（oceanus_config_generate 的 activate=true）`,
    '2. 激活其他刚生成的 preset（用户指定名称）',
    '3. 暂不激活（之后可用 /preset 切换）',
    '已有激活 preset 时保持不动，不必询问。',
    '',
    '## 步骤四：输出摘要',
    '用中文输出每个生成 preset 的摘要：每个 agent 一行（`agent → model[, variant=...]`），',
    '并提示：模型配置仅是声明，需在 OpenCode 侧配置对应 provider 的凭证才会实际可用；',
    '当前会话立即切换可用 `/preset <name>`。',
    '',
    '## 约束',
    '- 不手工编辑用户级配置 JSON 来生成内置厂商 preset（必须走 oceanus_config_generate）。',
    '- 不删除用户已有的其他 preset；覆盖前必须经用户确认。',
    '- 全程使用中文与用户交互。',
  ];
  if (argument) {
    lines.push('', '## 补充要求', argument);
  }
  return lines.join('\n');
}

export function createOceanusConfigCommand(handlers: OceanusConfigCommandHandlers): CommandDefinition {
  return {
    name: 'oceanus-config',
    description:
      '初始化 Oceanus 模型厂商 preset：无配置时直接生成默认厂商集合（zai/openai/deepseek/ollama-cloud/opencode-go）并推荐激活 zai；已有配置时先询问是否初始化默认集合（仅覆盖同名 preset）；/oceanus-config [补充要求] 可指定其他内置厂商或自定义厂商。',
    async execute(invocation: CommandInvocation) {
      const instruction = buildOceanusConfigInstruction(invocation.prompt.text.trim());
      try {
        await handlers.prompt(invocation.sessionID, instruction, invocation.delivery);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handlers
          .reply(
            invocation.sessionID,
            `Oceanus-config command failed（配置指令注入失败）: ${message}；可改为直接发送上述配置要求。`,
          )
          .catch(() => undefined);
      }
    },
  };
}
