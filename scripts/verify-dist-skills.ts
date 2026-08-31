/**
 * 验证构建产物 dist/index.js 中六阶段 skill 的语义与 Sisyphus 顺序一致。
 *
 * 采用「运行时注册对象」路径（非 bundle grep）：import dist 的 runSetup，
 * 用 fake ctx 捕获 skill.transform 添加的 skill 对象，按 name 精确取出
 * 六个阶段 skill，逐一断言其阶段边界语义，并捕获 sisyphus system prompt。
 *
 * 运行：bun scripts/verify-dist-skills.ts （需先 bun run build）
 */
import { runSetup } from '../dist/index.js';

/** 六个阶段 skill 各自的语义锚点（must=必须匹配，mustNot=必须不匹配）。 */
const SKILL_ANCHORS: Record<
  string,
  { must: RegExp[]; mustNot: RegExp[] }
> = {
  'sisyphus-intake': {
    must: [
      /Sisyphus Intake/,
      /owner:\s*Sisyphus/,
      /Intake 不调用 Metis INTAKE/,
      /项目背景|工作区结构/,
      /最小需求|minimum_requirements/,
      /分类任务|代码任务|非代码任务/,
      /直接调用 [`']?cbm_index|cbm_index.*初始化/,
      /Fail-open|fail-open/,
    ],
    mustNot: [/技术方案.*(选择|决策)/, /@metis/],
  },
  'sisyphus-brainstorm': {
    must: [
      /cbm_search_graph|cbm_trace/,
      /全量索引|不.*(索引|触发)/,
    ],
    mustNot: [/cbm_index/, /autoIndex[\s\S]{0,80}cbm_status/],
  },
  'sisyphus-plan': {
    must: [/intake/i, /brainstorm/i],
    mustNot: [/cbm_index|autoIndex|cbm_status/],
  },
  'sisyphus-execute': {
    must: [
      /高风险[\s\S]{0,100}(cbm_trace|cbm_query)[\s\S]{0,100}(影响|impact)/,
      /普通机械修改[\s\S]{0,60}(不强制|无需|可选)/,
    ],
    mustNot: [],
  },
  'sisyphus-review': {
    must: [
      /Review\s+开始[\s\S]{0,120}[`']?cbm_index[`']?/i,
      /变更入口[\s\S]{0,80}独立验证/,
      /CBM 不可用[\s\S]{0,80}(降级|degrade)/,
    ],
    mustNot: [],
  },
  'sisyphus-finish': {
    must: [/只读.*Review.*报告/, /不测试|不构建/, /不调用 CBM/, /不委派.*subagent/, /不修改文件/],
    mustNot: [],
  },
};

const SKILL_NAMES = [
  'sisyphus-intake',
  'sisyphus-brainstorm',
  'sisyphus-plan',
  'sisyphus-execute',
  'sisyphus-review',
  'sisyphus-finish',
] as const;

function createFakeCtx() {
  const registeredSkills: any[] = [];
  const registeredAgents = new Map<string, any>();
  const ctx: any = {
    agent: {
      transform: async (cb: any) => {
        const draft = {
          get: () => undefined,
          remove: () => {},
           update: (name: string, fn: any) => {
             const agent: any = { request: { settings: {} } };
             fn(agent);
             registeredAgents.set(name, agent);
           },
          default: () => {},
        };
        cb(draft);
      },
      reload: async () => {},
    },
    skill: {
      transform: async (cb: any) => {
        cb({ add: (s: any) => registeredSkills.push(s) });
      },
      reload: async () => {},
    },
    command: {
      transform: async (cb: any) => {
        cb({ add: () => {} });
      },
      reload: async () => {},
    },
    session: {
      get: async () => ({ id: 's', location: { directory: '/ws' } }),
      prompt: async () => {},
    },
    tool: {
      transform: async (cb: any) => {
        cb({ add: () => {} });
      },
      hook: async () => {},
    },
    mcp: {
      transform: async (cb: any) => {
        cb({
          list: () => [],
          get: () => undefined,
          set: () => {},
          update: () => {},
          remove: () => {},
        });
      },
      reload: async () => {},
    },
  };
  return { ctx, registeredSkills, registeredAgents };
}

async function main() {
  const { ctx, registeredSkills, registeredAgents } = createFakeCtx();
  const failures: string[] = [];

  await runSetup(ctx, {
    // 短路后台安装 / MCP / 网络，避免默认 autoIndex=true 触发真实实现。
    loadConfig: () => ({ codebaseMemory: { enabled: false } }),
    cbm: {
      createIndexer: () => ({
        ensureIndexed: async () => ({ kind: 'indexed' }),
        isIndexed: () => true,
        isIndexing: () => false,
        getLastOutcome: () => undefined,
        reset: () => {},
      }),
      logger: () => {},
    },
  });

  for (const name of SKILL_NAMES) {
    const matches = registeredSkills.filter((s) => s?.name === name);

    // 数量断言：每个 name 恰好注册一次，防跨对象误取。
    if (matches.length !== 1) {
      failures.push(
        `[${name}] 期望恰好注册 1 个对象，实际 ${matches.length} 个`,
      );
      continue;
    }

    const content: string = matches[0].content ?? '';
    const anchors = SKILL_ANCHORS[name];

    for (const re of anchors.must) {
      if (!re.test(content)) {
        failures.push(`[${name}] 缺少锚点: ${re}`);
      }
    }
    for (const re of anchors.mustNot) {
      if (re.test(content)) {
        failures.push(`[${name}] 出现不应存在的锚点: ${re}`);
      }
    }
  }

  const targetSkillCount = registeredSkills.filter((skill) =>
    (SKILL_NAMES as readonly string[]).includes(skill?.name),
  ).length;
  if (targetSkillCount !== SKILL_NAMES.length) {
    failures.push(
      `目标阶段 Skill 应恰好为 ${SKILL_NAMES.length} 个，实际 ${targetSkillCount} 个`,
    );
  }
  const prompt = String(registeredAgents.get('sisyphus')?.system ?? '');
  const stages = ['intake', 'brainstorm', 'plan', 'execute', 'review', 'finish'];
  const sequence = new RegExp(stages.join('[\\s\\S]{0,240}'), 'i');
  if (!sequence.test(prompt)) failures.push('[sisyphus] system prompt 六阶段顺序不完整或顺序错误');
  if (!/Intake|intake/.test(prompt) || !/Review|review/.test(prompt)) {
    failures.push('[sisyphus] system prompt 缺少 Intake/Review 锚点');
  }

  if (failures.length > 0) {
    console.error('dist 六阶段 skill / 六阶段流程验证失败:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `[verify-dist-skills] OK — ${SKILL_NAMES.length} 个阶段 skill 与 sisyphus 六阶段流程均已同步进 dist`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('[verify-dist-skills] 脚本执行失败:', e);
  process.exit(1);
});
