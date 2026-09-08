/**
 * 调研复用：会话内研究结论的快照键、失效判定与场景复用分类（纯函数，无 IO）。
 *
 * 设计边界（与用户确认的方案一致）：
 * - 只做「研究产物会话内复用」，不做 subagent 会话续用（session registry 不在本次范围）。
 * - 调研产物不落盘：结论以七字段结构（claim/evidence/status/source_version/impact/
 *   open_questions/negative_findings）在会话内传递与复用。
 * - 正式审查场景（review/diff-review/completion-audit/visual-acceptance）不复用
 *   审查会话与旧 verdict；前置调研事实仅可作为未验证线索注入 Brief。
 * - 快照失效或结论缺失时 fail-open：重新委派调研，不得使用过期结论。
 */

/** 复用协议版本：影响复用判定的提示词/契约变化时递增，使旧快照整体失效。 */
export const RESEARCH_REUSE_PROTOCOL_VERSION = '1';

/** 正式审查场景：不复用会话与旧结论，仅复用事实线索。 */
export const FORMAL_REVIEW_SCENES: ReadonlySet<string> = new Set([
  'review',
  'diff-review',
  'completion-audit',
  'visual-acceptance',
]);

/** 是否为正式审查场景（不复用会话/verdict，仅事实线索）。 */
export function isFormalReviewScene(scene: string): boolean {
  return FORMAL_REVIEW_SCENES.has(scene);
}

/** 一条调研结论的复用快照元数据；由主 Agent 在回收调研结果时登记。 */
export interface ResearchSnapshotMeta {
  /** 任务标识（spec/plan 唯一文件名或任务 lane）。 */
  taskKey: string;
  /** 调研场景/用途标识（如 explorer 侦察、oracle analysis）。 */
  scene: string;
  /** 调研完成时的 git state_head（commit 短 hash）。 */
  stateHead: string;
  /** 调研覆盖的变更文件（相对仓库根；顺序无关）。 */
  changedFiles: readonly string[];
  /** 调研依据的用户决策 ID 集合（D-ID 等；顺序无关）。 */
  decisionIds: readonly string[];
  /** 生成该结论时的复用协议版本。 */
  protocolVersion: string;
}

/** 复用判定结果。 */
export interface ResearchReuseDecision {
  reusable: boolean;
  /** 不可复用的具体原因（可复用时为空数组）。 */
  staleReasons: string[];
}

/** 排序去重，保证集合比较与键的稳定性。 */
function normalizeSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * 计算复用快照键：全部字段归一后拼接。
 * 键相同的两条调研结论可互相替代；任何字段变化都会得到不同的键。
 */
export function computeResearchMetaKey(meta: ResearchSnapshotMeta): string {
  return [
    meta.protocolVersion,
    meta.taskKey,
    meta.scene,
    meta.stateHead,
    normalizeSet(meta.changedFiles).join(','),
    normalizeSet(meta.decisionIds).join(','),
  ].join('|');
}

/**
 * 判定旧调研结论（prior）是否仍可用于当前请求（current）。
 * 可复用条件：taskKey、scene、state_head、变更文件集合、决策集合、协议版本全部一致。
 * 任一不满足即失效并给出原因，调用方必须 fail-open 重新委派调研。
 */
export function diffResearchSnapshot(
  prior: ResearchSnapshotMeta,
  current: ResearchSnapshotMeta,
): ResearchReuseDecision {
  const staleReasons: string[] = [];
  if (prior.taskKey !== current.taskKey) staleReasons.push('task_key_changed');
  if (prior.scene !== current.scene) staleReasons.push('scene_changed');
  if (prior.stateHead !== current.stateHead) staleReasons.push('state_head_changed');

  const priorFiles = normalizeSet(prior.changedFiles);
  const currentFiles = normalizeSet(current.changedFiles);
  if (
    priorFiles.length !== currentFiles.length ||
    priorFiles.some((f, i) => f !== currentFiles[i])
  ) {
    staleReasons.push('changed_files_changed');
  }

  const priorDecisions = normalizeSet(prior.decisionIds);
  const currentDecisions = normalizeSet(current.decisionIds);
  if (
    priorDecisions.length !== currentDecisions.length ||
    priorDecisions.some((d, i) => d !== currentDecisions[i])
  ) {
    staleReasons.push('decisions_changed');
  }

  if (prior.protocolVersion !== current.protocolVersion) {
    staleReasons.push('protocol_version_changed');
  }

  return { reusable: staleReasons.length === 0, staleReasons };
}

/** 场景复用分类：决定该场景下旧结论的可用形态。 */
export interface SceneReusePolicy {
  /** 是否允许复用旧调研结论（事实与建议）作为当前结论。 */
  reuseFindings: boolean;
  /** 是否仅允许作为未验证线索注入（正式审查场景）。 */
  formalReviewLeadsOnly: boolean;
}

/**
 * 按场景给出复用策略：
 * - 正式审查场景：不直接复用结论；前置调研事实仅作未验证线索，verdict 必须基于当前证据重新核验。
 * - 其余场景（consult/analysis/侦察等）：快照未失效即可复用并增量提问。
 */
export function classifySceneReuse(scene: string): SceneReusePolicy {
  if (isFormalReviewScene(scene)) {
    return { reuseFindings: false, formalReviewLeadsOnly: true };
  }
  return { reuseFindings: true, formalReviewLeadsOnly: false };
}
