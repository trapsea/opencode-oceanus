import { SISYPHUS_BRAINSTORM_SKILL } from './sisyphus-brainstorm';
import { SISYPHUS_EXECUTE_SKILL } from './sisyphus-execute';
import { SISYPHUS_PLAN_SKILL } from './sisyphus-plan';
import { SISYPHUS_REVIEW_SKILL } from './sisyphus-review';
import { OPENCODE_OCEANUS_SKILL } from './opencode-oceanus';

export type { SkillDefinition } from './types';

/**
 * Sisyphus 工作流四个阶段 skill，由插件通过 ctx.skill.transform 注入。
 * 安装插件即可使用，无需拷贝任何 skill 文件。
 */
export const SISYPHUS_SKILLS = [
  OPENCODE_OCEANUS_SKILL,
  SISYPHUS_BRAINSTORM_SKILL,
  SISYPHUS_PLAN_SKILL,
  SISYPHUS_EXECUTE_SKILL,
  SISYPHUS_REVIEW_SKILL,
];
