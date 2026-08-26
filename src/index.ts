import { Plugin, Skill } from '@opencode-ai/plugin';
import { getAgentDefinitions } from './agents';
import type { AgentOverrideConfig } from './config/schema';
import { loadPluginConfig } from './config/loader';
import { SISYPHUS_SKILLS } from './skills';
import { createCommands, runPresetCommand } from './commands';
import { registerOceanusTools } from './tools';
import { registerOceanusHooks } from './hooks';
import type { ToolingContext } from './runtime/types';

function toPermissions(
  permission: NonNullable<AgentOverrideConfig['permission']>,
): Array<{ action: string; resource: string; effect: 'allow' | 'deny' | 'ask' }> {
  const result: Array<{
    action: string;
    resource: string;
    effect: 'allow' | 'deny' | 'ask';
  }> = [];
  if (typeof permission === 'string') {
    return [{ action: '*', resource: '*', effect: permission as 'allow' | 'deny' | 'ask' }];
  }
  for (const [action, rule] of Object.entries(permission as Record<string, unknown>)) {
    if (typeof rule === 'string') {
      result.push({ action, resource: '*', effect: rule as 'allow' | 'deny' | 'ask' });
    } else {
      for (const [resource, effect] of Object.entries(
        (rule ?? {}) as Record<string, unknown>,
      )) {
        if (typeof effect === 'string') {
          result.push({ action, resource, effect: effect as 'allow' | 'deny' | 'ask' });
        }
      }
    }
  }
  return result;
}

/**
 * Oceanus 插件（opencode v2 入口）。
 *
 * 通过 ctx.agent.transform 注册一组参考 oh-my-opencode-slim 的 agent：
 * - oceanus（主 agent，颜色 #0FFFFF）
 * - sisyphus（主 agent，superpowers 五阶段工作流）
 * - explorer / librarian / oracle / designer / fixer / observer（子 agent，observer 默认禁用）
 *
 * 同时通过 ctx.skill.transform 注入 sisyphus 工作流的四个阶段 skill
 * （sisyphus-brainstorm / sisyphus-plan / sisyphus-execute / sisyphus-review），
 * 安装插件即可使用，无需拷贝任何 skill 文件。
 *
 * 每个 agent 的模型可通过配置文件独立指定
 * （~/.config/opencode/opencode-oceanus.{json,jsonc} 或项目 .opencode/ 下），
 * 未配置时跟随当前会话模型。注册后强制 default agent 为 oceanus。
 */
export default Plugin.define({
  id: 'opencode-oceanus',
  tui: true,
  async setup(ctx) {
    // v2 的 setup ctx 不暴露项目目录，用启动目录加载项目级配置；仅加载一次复用。
    const config = loadPluginConfig({ directory: process.cwd() });
    await ctx.agent.transform((draft) => {
      const definitions = getAgentDefinitions(config);
      if (draft.get('build')) {
        draft.remove('build');
      }
      if (draft.get('plan')) {
        draft.remove('plan');
      }
      for (const def of definitions) {
        draft.update(def.name, (agent) => {
          if (def.displayName) {
            agent.name = def.displayName as unknown as typeof agent.name;
          }
          agent.description = def.description;
          agent.mode = def.mode;
          if (def.system || def.orchestratorPrompt) {
            agent.system = [def.system, def.orchestratorPrompt]
              .filter((value): value is string => Boolean(value))
              .join('\n\n');
          }
          if (def.color) {
            agent.color = def.color;
          }
          if (def.model) {
            agent.model = def.model as unknown as typeof agent.model;
          }
          if (def.temperature !== undefined) {
            agent.request.settings.temperature = def.temperature;
          }
          if (def.options) Object.assign(agent.request.settings, def.options);
          if (def.permission !== undefined) {
            agent.permissions = toPermissions(def.permission) as typeof agent.permissions;
          }
        });
      }
      draft.default('oceanus');
    });
    await ctx.agent.reload();

    await ctx.skill.transform((draft) => {
      for (const skill of SISYPHUS_SKILLS) {
        draft.add({
          id: skill.name as Skill.Info['id'],
          name: skill.name as Skill.Info['name'],
          description: skill.description,
          slash: skill.slash ?? false,
          autoinvoke: skill.autoinvoke ?? false,
          location: `opencode-oceanus/${skill.name}/SKILL.md` as Skill.Info['location'],
          content: skill.content,
        });
      }
    });
    await ctx.skill.reload();

    await ctx.command.transform((draft) => {
      const commands = createCommands({
        preset: {
          runPreset: (args) => runPresetCommand(args),
          reloadAgents: () => ctx.agent.reload(),
          reply: async (text, invocation) => {
            // 仅透传 sessionID / text / delivery，避免在响应消息中
            // 重复触发 invocation.prompt.skills 等用户原 prompt 字段。
            await ctx.session.prompt({
              sessionID: invocation.sessionID,
              text,
              delivery: invocation.delivery,
            });
          },
        },
      });
      for (const command of commands) {
        draft.add(command);
      }
    });
    await ctx.command.reload();

    // Wave 2：注册新增 Tool 与 Hook（默认全部启用，按配置过滤；各自独立容错）。
    const toolingCtx = ctx as unknown as ToolingContext;
    await registerOceanusTools(toolingCtx, config);
    await registerOceanusHooks(toolingCtx, config);
  },
});
