import { Plugin, Skill } from '@opencode-ai/plugin';
import { getAgentDefinitions } from './agents';
import type { AgentOverrideConfig, PluginConfig } from './config/schema';
import { loadPluginConfig } from './config/loader';
import { SISYPHUS_SKILLS } from './skills';
import { createCommands, runPresetCommand } from './commands';
import { defaultInstallStatus } from './cbm/commands';
import { registerCbmMcp, removeCbmMcp } from './cbm/mcp';
import { getUiStatus, startUi, stopUi } from './cbm/ui';
import { registerOceanusTools } from './tools';
import { registerOceanusHooks } from './hooks';
import { buildCbmSharedDeps, type CbmWiringInjections } from './cbm/wiring';
import type { PluginSetupContext } from './runtime/types';
import { registerAutoUpdate } from './update';
import { installStaged, resolveOpenCodeInstallContext } from './update/cache';
import { updateManagedEntry, type ConfigEntry } from './update/config-entry';
import { startTaskSupervisor } from './runtime/task-supervisor';
import { JobBoard } from './tools/task/job-board';
import { resolveWorkspaceRootOrCwd } from './runtime/workspace';

function toPermissions(
  permission: NonNullable<AgentOverrideConfig['permission']>,
): Array<{ action: string; resource: string; effect: 'allow' | 'deny' | 'ask' }> {
  const result: Array<{
    action: string;
    resource: string;
    effect: 'allow' | 'deny' | 'ask';
  }> = [];
  if (typeof permission === 'string') {
    return [{ action: '*', resource: '*', effect: permission as 'allow' | 'deny' | 'ask' }];
  }
  for (const [action, rule] of Object.entries(permission as Record<string, unknown>)) {
    if (typeof rule === 'string') {
      result.push({ action, resource: '*', effect: rule as 'allow' | 'deny' | 'ask' });
    } else {
      for (const [resource, effect] of Object.entries(
        (rule ?? {}) as Record<string, unknown>,
      )) {
        if (typeof effect === 'string') {
          result.push({ action, resource, effect: effect as 'allow' | 'deny' | 'ask' });
        }
      }
    }
  }
  return result;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
interface AgentRefreshState {
  registration?: { dispose?: () => Promise<void> };
  managedNames: Set<string>;
  configuredSettings: Map<string, Set<string>>;
}

/**
 * 应用 agent 定义到宿主（transform + reload）。
 * 抽出以便 setup 与 /preset 的 reloadAgents 复用：切换 preset 时需基于
 * 重新加载的配置重建 agent 定义，而仅 ctx.agent.reload() 会沿用旧配置
 * 构建的定义，导致执行命令的当前窗口不生效。
 */
async function applyAgentDefinitions(
  ctx: PluginSetupContext,
  config: PluginConfig,
  state: AgentRefreshState,
): Promise<void> {
  await state.registration?.dispose?.();
  const registration = await ctx.agent.transform((draft) => {
    const definitions = getAgentDefinitions(config);
    const activeNames = new Set(definitions.map((definition) => definition.name));
    for (const name of state.managedNames) {
      if (!activeNames.has(name)) draft.remove(name);
    }
    if (draft.get('build')) {
      draft.remove('build');
    }
    if (draft.get('plan')) {
      draft.remove('plan');
    }
    for (const def of definitions) {
      draft.update(def.name, (agent: any) => {
        for (const key of state.configuredSettings.get(def.name) ?? []) {
          delete agent.request?.settings?.[key];
        }
        if (def.displayName) {
          agent.name = def.displayName as unknown as typeof agent.name;
        }
        agent.description = def.description;
        agent.mode = def.mode;
        if (def.system || def.orchestratorPrompt) {
          agent.system = [def.system, def.orchestratorPrompt]
            .filter((value): value is string => Boolean(value))
            .join('\n\n');
        }
        if (def.color) {
          agent.color = def.color;
        }
        if (def.model) {
          agent.model = def.model as unknown as typeof agent.model;
        } else {
          // 新 preset 未定义该 agent 的 model 时清除旧值，避免上一 preset 残留。
          delete agent.model;
        }
        if (def.temperature !== undefined) {
          agent.request.settings.temperature = def.temperature;
        }
        if (def.options) Object.assign(agent.request.settings, def.options);
        if (def.permission !== undefined) {
          agent.permissions = toPermissions(def.permission) as typeof agent.permissions;
        }
        const settings = new Set(Object.keys(def.options ?? {}));
        if (def.temperature !== undefined) settings.add('temperature');
        state.configuredSettings.set(def.name, settings);
      });
    }
    draft.default('oceanus');
    state.managedNames = activeNames;
  }) as { dispose?: () => Promise<void> };
  // 当前宿主会保留 transform registration；避免每次切换叠加旧闭包。
  state.registration = registration;
  await ctx.agent.reload();
}

export interface RunSetupOptions {
  /** 覆盖配置加载（测试注入；缺省 loadPluginConfig）。 */
  loadConfig?: (opts: { directory: string }) => PluginConfig;
  /** CBM 接线注入（测试替换网络/进程；缺省走真实实现）。 */
  cbm?: CbmWiringInjections;
  /** 可选任务生命周期观测器；缺省不改变任务接线行为。 */
  taskLifecycleObserver?: (source: 'supervisor' | 'tools' | 'hooks', board: JobBoard) => void;
}

/**
 * 插件 setup 主体（CBM-13 入口接线）。
 *
 * 抽出为可测试函数：smoke 测试用 fake ctx + 注入的 CBM 依赖验证接线顺序、
 * 后台安装不阻塞、失败降级与共享 indexer/缓存根。生产环境由 {@link runSetup}
 * 以真实 ctx 调用。
 *
 * 接线顺序（CBM 相关）：
 *   1. 解析 resolved codebaseMemory，计算共享 cacheRoot，构造共享依赖；
 *   2. `startBackgroundInstall(installOptions)`，**不 await**（后台安装非阻塞）；
 *   3. 注册 agents / skills（保留 agent-supervision/metis/momus 改动）；
 *   4. 注册命令（preset + /cbm），cbm handlers 复用共享 cacheRoot/indexer/MCP/UI；
 *   5. **非阻塞**注册 `codebase-memory-mcp`（占位→安装完成启用，不阻塞插件启动）；
 *   6. 注册 CLI fallback 工具，传入共享 runDeps / indexer（env 经 config 推导）；
 *   7. 注册 guidance hooks，复用同一 indexer / runDeps。
 *
 * 所有 CBM 接线独立 try/catch/fail-open：任一环节失败不阻塞其余子系统。
 */
export async function runSetup(
  ctx: PluginSetupContext,
  options: RunSetupOptions = {},
): Promise<(() => void) | undefined> {
  const log = options.cbm?.logger ?? (() => {});
  const config = (options.loadConfig ?? loadPluginConfig)({ directory: process.cwd() });
  const agentRefreshState: AgentRefreshState = {
    managedNames: new Set(),
    configuredSettings: new Map(),
  };
  let taskBoard: JobBoard | undefined;
  // 启动即恢复任务事实；失败不阻塞插件其它能力。
  try {
    const parentSessionId = String((ctx.session as any).sessionID ?? (ctx.session as any).id ?? '');
       const workspaceRoot = await resolveWorkspaceRootOrCwd(ctx.session, parentSessionId);
       taskBoard = await JobBoard.open({ workspaceRoot: workspaceRoot ?? process.cwd(), parentSessionId });
      options.taskLifecycleObserver?.('supervisor', taskBoard);
      // 先完成恢复再注册依赖该 board 的工具，避免恢复写回与首个工具调用发生 CAS 竞态。
      await startTaskSupervisor({ board: taskBoard, session: ctx.session, ownerAgent: 'sisyphus' }).catch(() => undefined);
  } catch { /* fail-open */ }

  // 1) 共享 CBM 依赖：cacheRoot = 显式 cacheDir ?? 默认；供 provision/MCP/CLI/UI/commands 复用。
  const shared = buildCbmSharedDeps(config, options.cbm);

  // 2) 后台安装：只触发不 await，绝不阻塞插件启动（fail-open）。
  //    同步 throw 与异步 rejection 都吞掉，避免未处理 rejection 干扰插件。
  if (shared.cm.enabled && shared.cm.autoDownload) {
    try {
      const bg = shared.startBackground();
      if (bg && typeof bg.catch === 'function') {
        bg.catch((e) => log('[oceanus] CBM 后台安装失败(fail-open)', { error: messageOf(e) }));
      }
    } catch (e) {
      log('[oceanus] CBM 后台安装启动失败(fail-open)', { error: messageOf(e) });
    }
  }

  // 3) 注册 agents（v2 agent.transform）。
  await applyAgentDefinitions(ctx, config, agentRefreshState);

  // 4) 注册 skills（sisyphus 阶段）。
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

  // 5) 注册命令（preset + /cbm）：cbm handlers 复用共享 cacheRoot/indexer/MCP/UI。
  await ctx.command.transform((draft) => {
    // 仅透传 sessionID / text / delivery，避免在响应消息中
    // 重复触发 invocation.prompt.skills 等用户原 prompt 字段。
    const replyToSession = async (
      text: string,
      invocation: { sessionID: string; prompt: { text: string }; delivery: 'steer' | 'queue' },
    ) => {
      await ctx.session.prompt({
        sessionID: invocation.sessionID,
        text,
        delivery: invocation.delivery,
      });
    };
    const commands = createCommands({
      preset: {
        runPreset: (args) => runPresetCommand(args, { directory: process.cwd() }),
        reloadAgents: async () => {
          // /preset 切换后必须基于重新加载的配置重建 agent 定义，再 reload；
          // 仅 ctx.agent.reload() 会沿用 setup 时旧配置构建的定义，导致当前窗口不生效。
          const fresh = (options.loadConfig ?? loadPluginConfig)({
            directory: process.cwd(),
          });
          await applyAgentDefinitions(ctx, fresh, agentRefreshState);
        },
      },
      cbm: {
        getInstallStatus: (cacheRoot) => defaultInstallStatus(cacheRoot),
        startBackgroundInstall: (opts) => shared.startBackground(opts),
        ensureInstalled: (opts) => shared.ensureInstalled(opts),
        repair: (opts) => shared.repair(opts),
        registerMcp: (opts) => registerCbmMcp(ctx, config, {
          ...opts,
          cacheRoot: shared.cacheRoot,
          ensureInstalled: shared.ensureInstalled,
        }),
        removeMcp: () => removeCbmMcp(ctx),
        indexer: shared.indexer,
        startUi: (opts) =>
          startUi({ ...opts, cacheRoot: shared.cacheRoot, ensureInstalled: shared.uiEnsureInstalled }),
        stopUi: (opts) => stopUi({ ...opts, cacheRoot: shared.cacheRoot }),
        getUiStatus: (opts) => getUiStatus({ ...opts, cacheRoot: shared.cacheRoot }),
        getCacheRoot: () => shared.cacheRoot,
        getWorkspaceRoot: () => process.cwd(),
        reply: replyToSession,
      },
    });
    for (const command of commands) {
      draft.add(command);
    }
  });
  await ctx.command.reload();

  // 6) 非阻塞注册 codebase-memory-mcp（占位→安装完成启用，不阻塞插件启动）。
  try {
    registerCbmMcp(ctx, config, {
      cacheRoot: shared.cacheRoot,
      logger: log,
      ensureInstalled: shared.ensureInstalled,
    }).catch((e) =>
      log('[oceanus] CBM MCP 注册失败(fail-open)', { error: messageOf(e) }),
    );
  } catch (e) {
    log('[oceanus] CBM MCP 注册同步失败(fail-open)', { error: messageOf(e) });
  }

  // 7) 注册 CLI fallback 工具：CBM 工具复用共享 runDeps / indexer
  //   （env=CBM_CACHE_DIR 由 tools 层经 config.codebaseMemory.cacheDir 推导）。
  try {
    await registerOceanusTools(ctx, config, {
      cbmRunDeps: shared.runDeps,
      cbmIndexer: shared.indexer,
      cbmCacheRoot: shared.cacheRoot,
      board: taskBoard,
      taskLifecycleObserver: taskBoard ? (board) => options.taskLifecycleObserver?.('tools', board) : undefined,
    });
  } catch (e) {
    log('[oceanus] 注册工具失败(fail-open)', { error: messageOf(e) });
  }

  // 8) 注册 hooks：cbm-guidance 复用同一 indexer / runDeps（fail-open）。
  try {
    await registerOceanusHooks(ctx, config, {
      runDeps: shared.runDeps,
      indexer: shared.indexer,
      board: taskBoard,
      taskLifecycleObserver: taskBoard ? (board) => options.taskLifecycleObserver?.('hooks', board) : undefined,
    });
  } catch (e) {
    log('[oceanus] 注册 hooks 失败(fail-open)', { error: messageOf(e) });
  }

  // 9) 插件自身自动升级：基础注册完成后再订阅，失败不阻塞 setup。
  const updateCleanup = (ctx as unknown as { event?: unknown }).event
    ? registerAutoUpdate(ctx as unknown as any, config, {
    logger: (event) => {
      const { event: kind, error, ...meta } = event;
      const message = error === undefined ? '' : ` error=${String(error)}`;
      console.warn(`[oceanus:update] ${String(kind)}${message}`, meta);
    },
    installer: async (version: string, entry?: ConfigEntry) => {
      if (!entry || (entry.kind === 'string' && String(entry.value).endsWith('@latest'))) return;
      // 从运行时 package.json 推导 OpenCode 实际使用的 install root，把更新发布到
      // OpenCode cache（而非 Oceanus 独立 cache），否则新版本不会被加载。
      const oc = resolveOpenCodeInstallContext();
      if (!oc) throw new Error('无法解析 OpenCode 安装上下文（非 node_modules 安装或本地开发）');
      await installStaged({
        cacheRoot: shared.cacheRoot,
        version,
        packageSpec: `opencode-oceanus@${version}`,
        sourceDir: process.cwd(),
        installRoot: oc.installRoot,
      });
      if (entry.managed) updateManagedEntry(entry.file, version);
    },
      })
    : undefined;

  return updateCleanup;
}

/**
 * Oceanus 插件（opencode v2 入口）。
 *
 * 通过 ctx.agent.transform 注册一组参考 oh-my-opencode-slim 的 agent：
 * - oceanus（主 agent，颜色 #0FFFFF）
   * - sisyphus（主 agent，superpowers 六阶段工作流）
 * - explorer / librarian / oracle / designer / fixer / observer / metis / momus（子 agent，observer 默认禁用）
 *
 * 同时通过 ctx.skill.transform 注入 sisyphus 工作流的六个阶段 Skill
 * （sisyphus-intake / sisyphus-brainstorm / sisyphus-plan / sisyphus-execute /
 * sisyphus-review），
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
    return runSetup(ctx as unknown as PluginSetupContext);
  },
});
