/** 统一审核协议：纯逻辑核心，无 IO、无 agent 依赖。
 *  本模块只承载场景类型契约与 defineScene 工厂；具体场景实例见 scenes.ts
 *  （oracle 提示词经 REVIEW_SCENES 内嵌 checks/requiredContext 消费）。
 *  verdict 的产出与消费由审核双方提示词契约承载，本模块不做运行时解析。 */

/** verdict 契约：gate 为历史兼容类型（当前按 advisory 处理）/ graded 三级 / advisory 不阻断。 */
export type ReviewContract = 'gate' | 'graded' | 'advisory';
/** 审核者角色（协议不感知具体 agent 实现，仅作标注与提示组装）。 */
export type Reviewer = 'oracle' | 'observer';

/** 审核场景定义；具体场景由 scenes.ts 提供，本模块只承载协议逻辑。 */
export interface ReviewScene {
  name: string;
  reviewer: Reviewer;
  subjectType: 'plan' | 'diff' | 'artifact' | 'image' | 'completion';
  subjectGlobs: readonly string[];   // 审核对象路径白名单，如 ['.omo/plans/*.md', '.oceanus/plan/*.md']
  contract: ReviewContract;
  checks: string;                    // 检查清单文本
  /** 委派该场景时委派方必须附带的对象/信息（单一来源：主 agent 委派协议与 oracle 场景指令均从此拼装）。 */
  requiredContext: readonly string[];
  independence: 'fresh-session' | 'reusable';
  maxRounds: number;                 // 默认 3
  onReject: 'revise-plan' | 'return-execute' | 'escalate';
}

/** 场景工厂：maxRounds 默认 3，onReject 默认 return-execute。 */
export function defineScene(
  input: Omit<ReviewScene, 'maxRounds' | 'onReject'> & Partial<Pick<ReviewScene, 'maxRounds' | 'onReject'>>,
): ReviewScene {
  return { ...input, maxRounds: input.maxRounds ?? 3, onReject: input.onReject ?? 'return-execute' };
}
