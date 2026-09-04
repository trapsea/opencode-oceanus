import { OCEANUS_BRAINSTORM_SKILL } from './oceanus-brainstorm';
import { OCEANUS_EXECUTE_SKILL } from './oceanus-execute';
import { OCEANUS_INTAKE_SKILL } from './oceanus-intake';
import { OCEANUS_PLAN_SKILL } from './oceanus-plan';
import { OCEANUS_REVIEW_SKILL } from './oceanus-review';
import { OCEANUS_FINISH_SKILL } from './oceanus-finish';
import { OPENCODE_OCEANUS_SKILL } from './opencode-oceanus';
import { CLIPBOARD_IMAGE_OBSERVER_SKILL } from './clipboard-image-observer';

export type { SkillDefinition } from './types';

/**
 * Sisyphus 工作流六个阶段 Skill，由插件通过 ctx.skill.transform 注入。
 * 安装插件即可使用，无需拷贝任何 skill 文件。
 */
export const OCEANUS_SKILLS = [
  OPENCODE_OCEANUS_SKILL,
  OCEANUS_INTAKE_SKILL,
  OCEANUS_BRAINSTORM_SKILL,
  OCEANUS_PLAN_SKILL,
  OCEANUS_EXECUTE_SKILL,
  OCEANUS_REVIEW_SKILL,
  OCEANUS_FINISH_SKILL,
  CLIPBOARD_IMAGE_OBSERVER_SKILL,
];
