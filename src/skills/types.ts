/** 插件注入的 skill 定义，对应 opencode v2 Skill.Info（id 取 name） */
export interface SkillDefinition {
  name: string;
  description: string;
  category: 'phase' | 'support' | 'configuration' | 'media';
  /** 可通过 /name 斜杠命令调用 */
  slash?: boolean;
  /** 命中描述时自动触发 */
  autoinvoke?: boolean;
  /** 完整 SKILL.md 内容（含 frontmatter） */
  content: string;
}

/** 所有阶段交接共享的最小结构；阶段 Skill 可在此基础上追加专属字段。 */
export interface PhaseHandoff {
  current_phase: string;
  input_sources: string[];
  completed: string[];
  open_questions: string[];
  next_action: string;
  risks: string[];
  evidence: string[];
  status: 'completed' | 'failed' | 'blocked' | 'pending';
  updated: string;
}
