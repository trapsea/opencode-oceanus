/** 插件注入的 skill 定义，对应 opencode v2 Skill.Info（id 取 name） */
export interface SkillDefinition {
  name: string;
  description: string;
  /** 可通过 /name 斜杠命令调用 */
  slash?: boolean;
  /** 命中描述时自动触发 */
  autoinvoke?: boolean;
  /** 完整 SKILL.md 内容（含 frontmatter） */
  content: string;
}
