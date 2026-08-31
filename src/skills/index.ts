import { SISYPHUS_BRAINSTORM_SKILL } from './sisyphus-brainstorm';
import { SISYPHUS_EXECUTE_SKILL } from './sisyphus-execute';
import { SISYPHUS_INTAKE_SKILL } from './sisyphus-intake';
import { SISYPHUS_PLAN_SKILL } from './sisyphus-plan';
import { SISYPHUS_REVIEW_SKILL } from './sisyphus-review';
import { SISYPHUS_FINISH_SKILL } from './sisyphus-finish';
import { OPENCODE_OCEANUS_SKILL } from './opencode-oceanus';
import { CLIPBOARD_IMAGE_OBSERVER_SKILL } from './clipboard-image-observer';

export type { SkillDefinition } from './types';

/**
 * Sisyphus 工作流六个阶段 Skill，由插件通过 ctx.skill.transform 注入。
 * 安装插件即可使用，无需拷贝任何 skill 文件。
 */
export const SISYPHUS_SKILLS = [
  OPENCODE_OCEANUS_SKILL,
  SISYPHUS_INTAKE_SKILL,
  SISYPHUS_BRAINSTORM_SKILL,
  SISYPHUS_PLAN_SKILL,
  SISYPHUS_EXECUTE_SKILL,
  SISYPHUS_REVIEW_SKILL,
  SISYPHUS_FINISH_SKILL,
  CLIPBOARD_IMAGE_OBSERVER_SKILL,
];
