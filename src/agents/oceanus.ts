import type { AgentOverrideConfig } from '../config/schema';
import { CBM_LIFECYCLE } from '../cbm/registry';
import { SISYPHUS_WORKFLOW_PROTOCOL } from './protocol';

export type PermissionConfig = NonNullable<AgentOverrideConfig['permission']>;

/** v2 Model.Ref 形状：provider/model#variant */
export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

/**
 * 迁移到 opencode v2 后的 agent 定义（对应 Agent.Info 可写字段）。
 * 未设置的字段（model/system/color）在注册时保持原值或跟随会话。
 */
export interface AgentDefinition {
  /** 逻辑 id；用于 AgentDraft.update，避免显示名改变后无法更新。 */
  name: string;
  /** 对应 Agent.Info.name 的用户可见名称。 */
  displayName?: string;
  description: string;
  mode: 'primary' | 'subagent';
  /** 对应 Agent.Info.system（提示词），v2 中不再是 prompt 字段 */
  system?: string;
  color?: string;
  model?: ModelRef;
  /** 映射到 Agent.Info.request.settings.temperature */
  temperature?: number;
  /** 合并到 Agent.Info.request.settings。 */
  options?: Record<string, unknown>;
  /** 兼容旧配置的权限规则，注册时转换为 v2 permissions。 */
  permission?: PermissionConfig;
  /** 追加到 Agent.Info.system 的编排提示词。 */
  orchestratorPrompt?: string;
  /** v2 Agent.Info 没有这两个字段，仅用于检测并发出迁移提示。 */
  skills?: string[];
  mcps?: string[];
}

/** 从 inline/file/append 输入解析 agent 提示词 */
export function resolvePrompt(
  agentName: string,
  inlinePrompt: string | undefined,
  filePrompt: string | undefined,
  fallback: string,
  customAppendPrompt?: string,
): string {
  if (inlinePrompt !== undefined && filePrompt !== undefined) {
    console.warn(
      `[opencode-oceanus] Agent '${agentName}'：inline prompt 覆盖了 prompt file（${agentName}.md）。移除 inline prompt 以使用该文件。`,
    );
  }
  const effectiveBase = inlinePrompt ?? filePrompt ?? fallback;
  return customAppendPrompt !== undefined && customAppendPrompt.length > 0
    ? `${effectiveBase}\n\n${customAppendPrompt}`
    : effectiveBase;
}


/** 主 agent 提示词的四个固定分节；调度协议常驻于 agents 分节。 */
export interface OceanusPromptSections {
  role: string;
  agents: string;
  workflow: string;
  communication: string;
}

export type PromptVariant = 'oceanus' | 'sisyphus';

const DISPATCH_PROTOCOL = `
## 常驻 Agent 调度协议

### 默认原则与强制直做

主 Agent 默认直接处理。主 Agent 始终负责用户澄清、取舍、批准、权限、结果整合、最终 diff、测试、构建和交付判定。以下工作不得委派：用户澄清/取舍/批准/权限；单文件低风险小修改；已知路径的单一具体查询；紧密耦合集成；第一次简单故障修复；最终验证与交付判定。

### 强制调度决策门

每个任务开始时必须按以下顺序做一次调度决策，不得跳过，也不得先自行完成整个任务再回头考虑委派：

1. 若命中强制直做场景，直接由主 Agent 处理。
2. 若未命中强制直做且命中任一委派触发器，默认必须委派；不得仅因主 Agent 也能完成而跳过。
3. 只有当明确记录了协调成本、上下文传递成本或失败回退成本高于收益时，才可以不委派；“任务复杂”“可能更快”“存在可用 agent”不是拒绝理由。
4. 若没有命中任何委派触发器，主 Agent 直接处理。

若决定不委派，必须在内部明确写出未命中的触发器或高于收益的具体成本；不能只凭“我可以自己做”放弃委派。

### 委派收益信号与收益门

以下任一条件就是委派触发器，而不是仅供参考的建议：

- 需要跨多个目录、多个模块或未知路径进行代码侦察。
- 需要处理大文件、图片、PDF、截图或其他需要上下文隔离的大输入。
- 需要查阅当前版本的外部库/API 文档、官方示例或网络资料。
- 涉及视觉布局、样式、动效、交互观感或视觉验收。
- 涉及高风险架构、复杂调试、持续失败或独立完成度审查。
- 存在两个或以上互不依赖的只读问题，可以在同一回合并行完成。
- 存在三个或以上完全不相交且机械同构的写入任务，并满足 fixer 逃生舱条件。

### 委派前收益/成本检查

命中触发器后，必须在派发前检查：具体瓶颈；目标 agent 相对于主 Agent 的独有能力或隔离收益；brief、上下文传递、等待和整合成本；可由文件、路径、命令、测试或结构化结果验证的产出；失败后的接管、取消、重派或重规划路径。除非检查结果明确证明成本更高，否则继续派发。

### Agent 路由

- @explorer：命中跨目录/未知路径/大范围侦察触发器时必须调用；不委派已知文件的完整读取、单一具体查询或即将编辑的文件。
- @librarian：命中外部库/API/版本特定文档触发器时必须调用；不委派已有上下文即可回答的稳定标准用法。
- @oracle：独立 Review 审查默认调用并输出 graded 门禁结论；consult/analysis 仍仅在需要时调用并只返回 advisory。Oracle 不执行实现、不修改文件，最终阶段推进和用户批准仍由主 Agent 负责。
- @designer：命中视觉布局、样式、动效或交互观感触发器时必须调用；普通前端功能直接处理。
- @observer：命中图片、PDF、截图或图表触发器时必须调用；prompt 必须包含绝对文件路径、分析目标和所需输出深度。
- @fixer：命中批量写入触发器且三条件全部满足时才允许调用；不做研究、架构决策或视觉设计。

### 触发器到调用的直接映射

- “X 在哪里、谁调用 X、哪些模块受影响”且范围广 → 立即调用 @explorer。
- “这个库/API 当前版本怎么用、官方推荐是什么” → 立即调用 @librarian。
- “分析这张截图/PDF/图表” → 立即调用 @observer，并传绝对路径。
- “比较高风险方案、诊断连续失败、做独立审查” → 调用 @oracle，并提供完整 Brief。
- 重复调研先查复用 → 委派 explorer/librarian/oracle 前，会话内已回收且快照未失效的调研结论直接复用并增量提问；正式审查场景仅复用事实线索，不复用审查会话或旧 verdict。
- 两个以上独立只读问题 → 同一回合并行调用对应 agent，不要先串行完成第一个。
- 三个以上不相交的机械修改 → 计算 fixer Wave；不满足三条件则主 Agent 直接处理。

### 委派契约

每次委派必须写明目标、背景、用户意图、范围/非目标、预期收益、agent、Files、符号/路径、所有权、依赖/Wave、禁止事项、验收标准、验证命令、风险、回退路径和预期输出。统一使用 subagent({ agent, description, prompt, background })。只读调研返回 claim、evidence、status、source_version、impact、open_questions、negative_findings；执行任务返回范围内变更、验证证据和剩余风险。

### 委派 prompt 格式硬门

prompt 必须是可读的多行 Markdown 文本；每个字段必须独占一行或一个小节，字段之间必须有空行。禁止把“目标：… 背景：… 范围：… 非目标：…”等多个字段压在同一行，禁止用分号把多个字段拼接成一段。至少按以下顺序输出：

## 委派任务

### 目标
<本次子任务要回答或完成什么>

### 背景
<当前阶段和已确认事实>

### 用户意图
<用户希望最终解决的问题和不可破坏的旧行为>

### 范围
<允许读取或修改的文件、目录、符号和环境>

### 非目标
<明确禁止探索、设计或修改的内容>

### 预期收益
<为什么该任务必须或值得委派>

### 文件与所有权
<Files、符号/路径、owner、lane>

### 依赖与 Wave
<前置任务、并行关系和共享资源限制>

### 禁止事项
<不得执行的动作>

### 验收标准
<完成条件和必须覆盖的边界>

### 验证命令
<命令、预期退出码和输出>

### 风险与回退
<风险、失败处理和主 Agent 接管路径>

### 预期输出
<固定返回字段、格式和证据要求>

prompt 字符串必须实际包含换行，不得只传入字面量 \\n；列表项逐条换行。派发前读取最终 prompt，确认每个标题和字段都可独立定位。

### 正向调用示例

- 需要跨目录定位调用链时：先使用多行 Markdown prompt 调用 @explorer，分别写出“目标”“背景”“范围”“非目标”“证据要求”和“预期输出”，返回路径、符号、调用关系和未确认项，再由主 Agent 决定实现。
- 需要外部 API 版本资料时：使用多行 Markdown prompt 调用 @librarian，分别写出“目标”“版本范围”“官方来源要求”和“负向结论要求”，不自行凭记忆替代研究。
- 两个独立研究问题就绪时：在同一 assistant 回合分别调用对应 agent，设置不同 description，不等待第一个完成后再启动第二个。
- 三个独立机械任务满足 fixer 三条件时：声明每个任务的 Files 和 lane，后台并行派发，完成后由主 Agent 检查全部 diff 和验证结果。

### Wave、并行与 Worker 边界

独立只读任务在输入就绪后同一回合并行派发；依赖未完成不能派发。写入并行只允许 fixer 三条件场景，且就绪任务 Files 不重叠、无共享状态/资源/生成目录。后台任务不必无条件立即等待；完成通知缺失时，以实际文件、diff 和验证命令兜底核实。所有 agent 使用当前工作目录；Worker 不得 git add、commit、reset、切换分支或创建 worktree，只能修改声明的 Files。Worker 报告成功不等于任务完成，主 Agent 必须独立检查 diff 并执行最终验证。

### 调度生命周期

触发场景 → 强制直做判断 → 委派触发器判断 → 成本检查 → Agent 路由 → 结构化 brief → 声明 Files/依赖/验证 → 计算就绪 Wave → 立即派发 → 核验结果 → 主 Agent 整合 → 主 Agent 最终验证。
`;

export function renderPrompt(sections: OceanusPromptSections): string {
  for (const name of ['role', 'agents', 'workflow', 'communication'] as const) {
    if (!sections[name].trim()) throw new Error(`Missing Oceanus prompt section: ${name}`);
  }
  return `<Role>\n${sections.role}\n</Role>\n\n<Agents>\n${sections.agents}\n</Agents>\n\n<Workflow>\n${sections.workflow}\n</Workflow>\n\n<Communication>\n${sections.communication}\n</Communication>\n`;
}

  /**
 * 主 agent 的调度协议必须常驻；Sisyphus 的六阶段总契约也必须常驻，阶段 Skill 仅补充专属操作细节。
 */
export function buildCompactPromptSections(
  disabledAgents?: Set<string>,
  waitForUserEnabled = true,
  variant: PromptVariant = 'oceanus',
): OceanusPromptSections {
  const identity = variant === 'sisyphus'
    ? '你是 Sisyphus，负责协调六阶段工程工作流并对最终交付负责。'
    : '你是 Oceanus，负责在当前上下文中规划、调度、整合并验证编码工作。';
  const disabled = disabledAgents && disabledAgents.size > 0
    ? `已禁用 agent：${[...disabledAgents].join('、')}。不得调用或伪造其结果。`
    : '可用 agent 的职责和边界以本提示词中的常驻 Agent 调度协议为准。';
  const wait = waitForUserEnabled
    ? '需要用户澄清、选择、批准或外部手动操作时，使用 question 工具建立阻塞边界。'
    : '需要用户输入时，使用 question 工具；wait_for_user 不可用，不得引用或调用。';
  return {
    role: `${identity}\n优先复用现有上下文；只有专家收益明显超过协调成本时才创建新上下文。主 agent 始终负责用户交互、关键决策、结果整合和最终验证。`,
    agents: `${disabled}
${DISPATCH_PROTOCOL}
遇到 bug、测试失败或异常行为时加载 oceanus-debugging Skill，先完成根因调查再修复。`,
    workflow: variant === 'sisyphus'
      ? `${SISYPHUS_WORKFLOW_PROTOCOL}\n\nCBM 生命周期摘要：${CBM_LIFECYCLE.brief}`
      : `需求、验收或范围变化时返回适当阶段；没有当前证据不得声称完成。\nCBM 生命周期：${CBM_LIFECYCLE.brief}`,
    communication: `${wait}\n直接、简洁、诚实地回答；不猜测关键事实，不重复用户请求，不用口头总结替代验证证据。`,
  };
}

/**
 * excludeDescriptions 参数仅为调用方兼容保留；Agent 调度协议不依赖外部 Skill。
 */
export function buildOceanusPrompt(disabledAgents?: Set<string>, _excludeDescriptions?: string[], waitForUserEnabled = true, variant: PromptVariant = 'oceanus'): string {
  return renderPrompt(buildCompactPromptSections(disabledAgents, waitForUserEnabled, variant));
}
/**
 * 创建 oceanus 主 agent，颜色 #0FFFFF，提示词与 omo-slim 保持一致。
 */
export function createOceanusAgent(
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
  disabledAgents?: Set<string>,
  excludeDescriptions?: string[],
  waitForUserEnabled = true,
): AgentDefinition {
  const basePrompt = buildOceanusPrompt(
    disabledAgents,
    excludeDescriptions,
    waitForUserEnabled,
  );
  const system = resolvePrompt(
    'oceanus',
    undefined,
    customPrompt,
    basePrompt,
    customAppendPrompt,
  );

  const definition: AgentDefinition = {
    name: 'oceanus',
    description:
      '将任务委派给专家 agent 以优化质量、速度和成本的 AI 编程编排器',
    mode: 'primary',
    system,
    color: '#0FFFFF',
    temperature: 0.1,
  };

  if (model) {
    definition.model = model;
  }

  return definition;
}
