import { Plugin, Skill } from '@opencode-ai/plugin';
import { getAgentDefinitions } from './agents';
import { loadPluginConfig } from './config/loader';
import { SISYPHUS_SKILLS } from './skills';

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
    // v2 的 setup ctx 不暴露项目目录，用启动目录加载项目级配置
    const config = loadPluginConfig({ directory: process.cwd() });
    const definitions = getAgentDefinitions(config);

    await ctx.agent.transform((draft) => {
      for (const def of definitions) {
        draft.update(def.name, (agent) => {
          agent.description = def.description;
          agent.mode = def.mode;
          if (def.system) {
            agent.system = def.system;
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
  },
});
