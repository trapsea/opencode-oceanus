import { watch } from 'node:fs';
import * as path from 'node:path';
import { Plugin } from '@opencode/plugin';
import { getAgentDefinitions } from './agents';
import type { AgentOverrideConfig, PluginConfig } from './config/schema';
import { loadPluginConfig } from './config/loader';
import { getAgentBrowserConfig } from './config/utils';
import { getUserPresetConfigPath, readUserConfig, resolveSessionModelRef, switchPresetOnDisk, type Preset } from './config/presets';
import { OCEANUS_SKILLS } from './skills';
import { detectAgentBrowser, installAgentBrowser } from './browser';
import { createCommands } from './commands';
import { registerCbmMcp } from './cbm/mcp';
import { registerOceanusTools } from './tools';
import { registerOceanusHooks } from './hooks';
import { buildCbmSharedDeps, startDaemonPrewarm, waitForDaemonReady, type CbmWiringInjections } from './cbm/wiring';
import type { PluginSetupContext } from './runtime/types';
import { registerAutoUpdate } from './update';
import { cleanupStaleVersions } from './update/cleanup';
import { installStaged, resolveOpenCodeInstallContext } from './update/cache';
import { syncEntryVersion, PACKAGE_NAME, type ConfigEntry } from './update/config-entry';
import { hasNativePluginUpdate, updateViaHost, waitForHostVersion } from './update/host-update';
import { resolvePluginDirectory } from './runtime/host-adapter';
import { createCleanupRunner, createHostCleanup, runOptionalStages } from './runtime/setup-stages';

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
 * 应用 agent 定义到宿主（transform + reload）。插件 setup 执行一次；
 * /preset 切换时通过 rebuildAgents 再次调用以立即生效（当前会话模型切换
 * + registry 重建，后续 subagent 立即使用新模型）。
 */
/**
 * merge 语义（非整体替换）合并 agent permissions：
 * - 宿主 Tool.snapshot 按该数组过滤会话工具目录，permission 评估取
 *   findLast（后声明优先）；
 * - 以宿主 Agent.Info 默认基线（`*:* allow` + .env/外部目录 ask 特例）为底，
 *   先剔除 incoming 接管的 action 再追加，保证幂等（transform 重跑不叠加）、
 *   且 incoming 规则优先于基线生效。
 */
export function mergeAgentPermissions(
  existing: ReadonlyArray<Record<string, unknown>> | undefined,
  incoming: ReadonlyArray<{ action: string; resource: string; effect: string }>,
): Array<Record<string, unknown>> {
  const incomingActions = new Set(incoming.map((rule) => rule.action));
  const base = (existing ?? []).filter(
    (rule) => typeof rule?.action === 'string' && !incomingActions.has(rule.action),
  );
  return [...base, ...(incoming as unknown as Array<Record<string, unknown>>)];
}

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
    // 集成到 OpenCode 时隐藏宿主同名 agent，避免与 Oceanus 工作流入口重复显示。
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
          // merge 语义说明见 mergeAgentPermissions 文档注释。
          agent.permissions = mergeAgentPermissions(
            agent.permissions,
            toPermissions(def.permission),
          ) as typeof agent.permissions;
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
}

/**
 * 插件 setup 主体（CBM-13 入口接线）。
 *
 * 抽出为可测试函数：smoke 测试用 fake ctx + 注入的 CBM 依赖验证接线顺序、
 * 后台安装不阻塞、失败降级与共享 indexer/缓存根。生产环境由 {@link runSetup}
 * 以真实 ctx 调用。
 *
 * 接线顺序：
 *   1. 解析 resolved codebaseMemory，计算共享 cacheRoot，构造共享依赖；
 *   2. `startBackgroundInstall(installOptions)`，**不 await**（后台安装非阻塞）；
 *   3. 注册 agents / skills（agent 拓扑已收敛：metis/momus 并入 oracle 场景，见 src/review/）；
 *   4. 注册命令（preset / git-commit / ai-ratio / oceanus-config；cbm 不再暴露
 *      用户命令，能力由 MCP 工具供 agent 调度）；
 *   5. `cbm-daemon` 阶段**前台等待** permanent daemon 就绪（默认 15s 上限，
 *      超时/失败 fail-open）——必须先于 mcp 注册完成，使宿主 reload 后 spawn 的
 *      stdio MCP server 全部 connect-to-warm，消除 daemon 冷启动竞态；
 *   6. **非阻塞**注册 `codebase-memory-mcp`（占位→安装完成启用；安装完成路径
 *      在 reload 前再次确保 daemon 就绪，不阻塞插件启动）；
 *   7. 注册 CLI fallback 工具，传入共享 runDeps / indexer（env 经 config 推导）；
 *   8. 注册 guidance hooks，复用同一 indexer / runDeps；
 *   9. agent-browser 能力探测与可选安装（fail-open、detached，不阻塞启动）；
 *  10. 注册自动更新（依赖 ctx.event；含历史版本清扫与三级回退安装）。
 *
 * 所有 CBM 接线独立 try/catch/fail-open：任一环节失败不阻塞其余子系统。
 */
export async function runSetup(
  ctx: PluginSetupContext,
  options: RunSetupOptions = {},
): Promise<(() => void) | undefined> {
  // 生产缺省输出到 console.warn，让 bridge 登记失败/事件异常等诊断可见
  // （此前缺省为 noop，hooks 阶段透传后全部静默丢弃，无法定位为何不登记）。
  // 注入 logger（CBM 接线/测试）优先；消息体已带 [oceanus] 前缀，此处不再重复加。
  const log: (message: string, meta?: Record<string, unknown>) => void =
    options.cbm?.logger ?? ((message, meta) => console.warn(message, meta));
  const report = (stage: string, error: unknown) =>
    console.warn(`[oceanus] ${stage}`, error);
  // OpenCode service 可承载多个项目，优先使用 V2 location.directory；旧宿主
  // 仍可能只提供顶层 directory，最后才回退到 service 的 cwd。
  const directory = resolvePluginDirectory(ctx);
  const config = (options.loadConfig ?? loadPluginConfig)({ directory });
  const agentRefreshState: AgentRefreshState = {
    managedNames: new Set(),
    configuredSettings: new Map(),
  };

  // 1) 共享 CBM 依赖：cacheRoot = 显式 cacheDir ?? 默认；供 provision/MCP/CLI/UI 复用。
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

  const cleanupRunner = createCleanupRunner(report);
  let hasCleanup = false;
  let agentStageFailed = false;

  // 3-5) 各注册域是相互独立的可选阶段；失败只报告并继续后续阶段。
  await runOptionalStages([
    {
      name: 'agents',
      run: async () => {
        try {
          await applyAgentDefinitions(ctx, config, agentRefreshState);
        } catch (error) {
          agentStageFailed = true;
          throw error;
        }
      },
    },
    {
      name: 'skills',
      run: async () => {
        await ctx.skill.transform((draft) => {
    for (const skill of OCEANUS_SKILLS) {
      const info = {
        id: skill.name,
        name: skill.name,
        description: skill.description,
        slash: skill.slash ?? false,
        autoinvoke: skill.autoinvoke ?? false,
        // OpenCode 2.0.5 将 Skill.Info.location 重命名为必填的 path。
        // 路径必须为绝对路径，否则宿主 schema 校验失败。
        path: `/builtin/opencode-oceanus/${skill.name}/SKILL.md`,
        content: skill.content,
      };
      // beta-18743 的官方 SkillDraft 契约使用 add/update/remove；不调用未公开
      // 的 source()，避免特性探测把 skill 注册导向非标准分支。
      draft.add(info);
    }
        });
        await ctx.skill.reload();
      },
    },
    {
      name: 'commands',
      run: async () => {
  // 注册命令（preset / git-commit / ai-ratio / oceanus-config 共 4 个）：cbm
  // 能力由 MCP 工具供 agent 调度，不再暴露用户命令。
  await ctx.command.transform((draft) => {
    // preset synthetic 回执：注入消息但不触发 LLM turn。
    const syntheticReply = async (sessionID: string, text: string) => {
      await ctx.session.synthetic?.({ sessionID, text });
    };
    // 当前会话立即切换到 preset 中该 agent 的模型（若定义）。
    const switchSessionModel = async (sessionID: string, presetName: string): Promise<string | null> => {
      try {
        const config = (options.loadConfig ?? loadPluginConfig)({ directory });
        const agentName = (await ctx.session.get?.({ sessionID }))?.agent;
        if (!agentName) return null;
        const override = (config.presets ?? {})[presetName]?.[agentName];
        // 复用 resolveSessionModelRef 的 Model.Ref.parse 语义，修复
        // 'provider/model#variant' 字符串的 #variant 被并入 model id 的解析 bug。
        const ref = resolveSessionModelRef(override);
        if (!ref) return null;
        // 宿主 switchModel 能力缺失时静默跳过，不产生"已切换"假回执
        //（与 synthetic 回执能力缺失时的静默口径一致；2.0.10 类型面该能力必含，此为防御）。
        if (typeof ctx.session.switchModel !== 'function') return null;
        await ctx.session.switchModel?.({
          sessionID,
          model: {
            providerID: ref.providerID,
            id: ref.id,
            variant: ref.variant,
          },
        });
        const display = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ''}`;
        return `当前会话（${agentName}）已立即切换到 ${display}；`;
      } catch {
        return null;
      }
    };
    const commands = createCommands({
      preset: {
        listPresets: () => {
          const config = (options.loadConfig ?? loadPluginConfig)({ directory });
          return { current: config.preset, presets: config.presets ?? {} };
        },
        switchPreset: (name) => {
          const config = (options.loadConfig ?? loadPluginConfig)({ directory });
          return switchPresetOnDisk((config.presets ?? {}) as Record<string, Preset>, name);
        },
        switchSessionModel,
        rebuildAgents: async () => {
          await applyAgentDefinitions(
            ctx,
            (options.loadConfig ?? loadPluginConfig)({ directory }),
            agentRefreshState,
          );
        },
        reply: syntheticReply,
      },
      gitCommit: {
        // 对话式提交分析：注入用户消息并触发 LLM turn；delivery 透传
        // 用户提交意图（steer/queue）。session.prompt 缺失时降级为
        // synthetic 回执提示，不静默失败。
        prompt: async (sessionID, text, delivery) => {
          if (typeof ctx.session.prompt !== 'function') {
            throw new Error('宿主 session.prompt 能力不可用');
          }
          await ctx.session.prompt({
            sessionID,
            text,
            delivery,
          });
        },
        reply: syntheticReply,
      },
      aiRatio: {
        // 对话式占比分析：注入统计工作流指令并触发 LLM turn（模式同
        // /git-commit）。session.prompt 缺失时降级 synthetic 回执，不静默失败。
        prompt: async (sessionID, text, delivery) => {
          if (typeof ctx.session.prompt !== 'function') {
            throw new Error('宿主 session.prompt 能力不可用');
          }
          await ctx.session.prompt({
            sessionID,
            text,
            delivery,
          });
        },
        reply: syntheticReply,
      },
      oceanusConfig: {
        // 对话式厂商配置：注入工作流指令并触发 LLM turn（模式同 /git-commit）；
        // 由 oceanus_config_generate 工具完成确定性写入。session.prompt 缺失时
        // 降级为 synthetic 回执提示，不静默失败。
        prompt: async (sessionID, text, delivery) => {
          if (typeof ctx.session.prompt !== 'function') {
            throw new Error('宿主 session.prompt 能力不可用');
          }
          await ctx.session.prompt({
            sessionID,
            text,
            delivery,
          });
        },
        reply: syntheticReply,
      },
    });    for (const command of commands) {
      draft.add(command);
    }
  });
        await ctx.command.reload();
      },
    },

    {
      name: 'cbm-daemon',
      run: async () => {
        // CBM permanent daemon 前台等待式预热必须先于 MCP 注册完成：宿主
        // reload 后 spawn 的 stdio MCP server 是首个 committed client，若落在
        // daemon 冷启动窗口内会报 Connection closed / 30s 超时，并抢先以
        // session-managed 拉起 daemon 使 permanent 永远无法建立。await 本阶段
        // （就绪等待默认 15s 上限，超时/失败 fail-open 不阻塞）后再进入 mcp
        // 注册，所有 stdio 连接变为 connect-to-warm。
        await startDaemonPrewarm(shared, log, {
          prewarm: options.cbm?.prewarm,
        });
      },
    },

    {
      name: 'mcp',
      run: () => {
        // MCP 明确 detached：Promise pending 不得阻塞 setup，rejection 统一报告 async。
        const pending = registerCbmMcp(ctx, config, {
      cacheRoot: shared.cacheRoot,
      logger: log,
      ensureInstalled: async (opts) => {
        try {
          const installation = shared.ensureInstalled(opts);
          // 立即挂载 rejection handler，避免 detached 安装 Promise 在 setup 返回窗口泄漏。
          installation.catch((error) => {
            report('mcp.async', error);
            log('[oceanus] mcp.async', { error: messageOf(error) });
          });
          return await installation;
        } catch (error) {
          throw error;
        }
      },
      // 首次安装完成、启用 server 前确保 daemon 就绪（reload 后宿主 spawn 的
      // stdio server 才能 connect-to-warm；fail-open；prewarm 注入与 cbm-daemon
      // 阶段对齐，便于集成测试以 fake 覆盖）。
      ensureDaemonReady: (bin, cacheRoot) =>
        waitForDaemonReady(cacheRoot, bin, log, options.cbm?.prewarm),
        });
        void Promise.resolve(pending)
          .then((res) => {
            // 结构化注册结果：未变（跳过 reload）/占位/安装/移除均可见，便于把
            // 「连接重建窗口」与真实连接失败区分开（fail-open 不受影响）。
            log('[oceanus] CBM mcp 注册结果', {
              server: res.server,
              registered: res.registered,
              disabled: res.disabled,
              unchanged: res.unchanged,
              installed: res.installed,
              mutated: res.mutated,
              reloaded: res.reloaded,
              skippedUnknown: res.skippedUnknown,
            });
          })
          .catch((e) => {
            report('mcp.async', e);
            log('[oceanus] mcp.async', { error: messageOf(e) });
          });
      },
    },

    {
      name: 'tools',
      run: async () => {
        // CBM daemon 预热已前移至 'cbm-daemon' 阶段（必须先于 MCP 注册执行）。
        // 注册 CLI fallback 工具：复用共享 runDeps / indexer
        // （env=CBM_CACHE_DIR 由 tools 层经 config.codebaseMemory.cacheDir 推导）。
        await registerOceanusTools(ctx, config, {
          cbmRunDeps: shared.runDeps,
      cbmIndexer: shared.indexer,
      cbmCacheRoot: shared.cacheRoot,
        });
      },
    },

    {
      name: 'hooks',
      run: async () => {
        // 注册 hooks：cbm-guidance 复用同一 indexer / runDeps。
        await registerOceanusHooks(ctx, config, {
      runDeps: shared.runDeps,
      indexer: shared.indexer,
        });
      },
    },

    {
      name: 'browser',
      run: () => {
        // agent-browser 能力探测与可选自动安装（agent-browser skill 能力层）。
        // fail-open：只记日志，任何失败不阻塞 setup；运行时 agent 按
        // agent-browser skill 文案自行探测，不依赖本阶段结果。
        // autoInstall=true（默认 false）视为用户显式授权，安装 detached 执行
        //（npm 安装 + Chrome for Testing 下载耗时，不阻塞启动）。
        const agentBrowser = getAgentBrowserConfig(config);
        if (!agentBrowser.enabled) return;
        void (async () => {
          try {
            let detected = await detectAgentBrowser({
              configuredBinaryPath: agentBrowser.binaryPath,
            });
            if (!detected.available && agentBrowser.autoInstall) {
              const installed = await installAgentBrowser({
                version: agentBrowser.version,
                withDeps: process.platform === 'linux',
                runDoctor: true,
                // config agentBrowser.autoInstall=true 即显式授权（默认 false，
                // 缺省时本分支不可达，不会出现静默安装）。
                confirm: () => true,
              });
              // 日志使用安装后的探测结果（available 应为 true），避免误导。
              detected = installed.detect;
            }
            log('[oceanus] agent-browser 探测', { ...detected });
          } catch (error) {
            log('[oceanus] agent-browser 探测/安装失败（fail-open）', {
              error: messageOf(error),
            });
          }
        })();
      },
    },

    {
      name: 'auto-update',
      run: () => {
        if (!(ctx as unknown as { event?: unknown }).event) return;
        const updateCleanup = registerAutoUpdate(ctx as unknown as any, config, {
    // 历史版本清扫：宿主路径更新会累积时间戳缓存目录（每版本约 110MB，
    // 宿主自身不清理）；fail-open，任何失败只记日志。
    cleanup: () => {
      cleanupStaleVersions({
        log: (event) => console.warn('[oceanus:update:cleanup]', event),
      });
    },
    logger: (event) => {
      const { event: kind, error, ...meta } = event;
      const hint = kind === 'restart_required'
        ? '（新版本已安装到磁盘，重启 OpenCode 后生效）'
        : kind === 'updated_via_host'
          ? '（宿主已原地热重载，新版本已生效，无需重启）'
          : '';
      const message = error === undefined ? '' : ` error=${String(error)}`;
      console.warn(`[oceanus:update] ${String(kind)}${message}${hint}`, meta);
    },
    installer: async (version: string, entry?: ConfigEntry): Promise<unknown> => {
      // 入口已由 registerAutoUpdate 过滤（file:/@latest 不会到达这里）；
      // 防御性缺失入口必须显式失败，不得静默返回（否则会被记为 update_installed 假成功）。
      if (!entry) throw new Error('自动更新缺少配置入口，拒绝静默跳过');

      // ── 执行层三级回退 ──────────────────────────────────────────────────────
      // ① ctx.plugin.update：未来宿主对插件上下文开放时自动启用（探测式，当前未开放）。
      // ② HTTP 回环：读 service.json 发现宿主后台服务，POST /api/plugin/update。
      //    宿主自己从 npm 拉最新、写新时间戳缓存目录并在其实例热重载；仅裸名 target
      //    可用（pinned 与 inventory 不匹配会被 400 / no-op）。
      // ③ installStaged 自管：pinned 入口（宿主不跟踪不能升级）与 ①② 失败的兜底。
      const packageRaw = entry.kind === 'string'
        ? entry.value
        : String((entry.value as Record<string, unknown>).package ?? '');
      const hostEligible = packageRaw === PACKAGE_NAME;
      const directory = (ctx as unknown as { location?: { directory?: string } })?.location?.directory ?? process.cwd();

      if (hostEligible && hasNativePluginUpdate(ctx)) {
        try {
          await (ctx as unknown as { plugin: { update: (input: { targets: string[] }) => Promise<unknown> } })
            .plugin.update({ targets: [PACKAGE_NAME] });
          // 走到这说明宿主在插件上下文开放了原生通道；返回后不要做任何依赖自身存续的操作。
          console.warn('[oceanus:update] updated_via_host(ctx)', { latestVersion: version });
          return 'host-reloaded';
        } catch (error) {
          console.warn('[oceanus:update] host(ctx) 更新失败，回退下一层', { error: String(error) });
        }
      }

      if (hostEligible) {
        const ok = await updateViaHost(PACKAGE_NAME, directory);
        if (ok) {
          // 若 service.json 指向本实例，后续热重载可能中断这里的等待——仅用于日志提示，
          // 不做关键路径动作；验证不了也视为成功（文件已由宿主落盘，重启后必然生效）。
          const reloaded = await waitForHostVersion(PACKAGE_NAME, directory, version);
          console.warn('[oceanus:update] updated_via_host(http)', { latestVersion: version, reloaded });
          return reloaded ? 'host-reloaded' : 'host-pending';
        }
        console.warn('[oceanus:update] host(http) 不可用，回退自管安装');
      }

      // ③ 自管：pinned 入口与宿主路径失败的兜底。
      // 从运行时 package.json 推导 OpenCode 实际使用的 install root，把更新发布到
      // OpenCode cache（而非 Oceanus 独立 cache），否则新版本不会被加载。
      const oc = resolveOpenCodeInstallContext();
      if (!oc) {
        throw new Error(
          '无法解析 OpenCode 安装上下文：当前插件不是以 <installRoot>/node_modules/opencode-oceanus 布局加载' +
            '（本地路径/开发安装不支持自动更新；请将 plugins 条目改为包名形态安装）',
        );
      }
      await installStaged({
        cacheRoot: shared.cacheRoot,
        version,
        packageSpec: `opencode-oceanus@${version}`,
        sourceDir: process.cwd(),
        installRoot: oc.installRoot,
      });
      // 固定版本入口（无论是否带 installer marker）安装成功后同步回写配置，
      // 保证配置文件与磁盘版本一致；裸入口无版本可写，自然跳过。
      try {
        syncEntryVersion(entry.file, version, entry);
      } catch (error) {
        // 配置回写失败不回滚已完成的磁盘更新，只如实记录。
        console.warn('[oceanus:update] config_sync_failed', { file: entry.file, version, error: String(error) });
      }
      return undefined;
    },
        });
        cleanupRunner.add('auto-update.cleanup', updateCleanup);
        hasCleanup = true;
      },
    },
  ], report);

  if (agentRefreshState.registration?.dispose) {
    cleanupRunner.add('agents.dispose', async () => {
      await agentRefreshState.registration?.dispose?.();
    });
    hasCleanup = true;
  }

  // preset 指纹监听：/preset 切换只写用户级配置（TUI 侧负责当前会话
  // switchModel 立即生效）；这里在 server 侧检测 preset 变化并重建 agent
  // 定义，使**后续新派生的 subagent** 立即使用新 preset 的模型，无需等待
  // 插件 reload。运行中的 subagent 不受影响（换模型可能截断其上下文）。
  if (!agentStageFailed && agentRefreshState.registration) {
    const readPresetFingerprint = (): string | undefined => {
      try {
        const user = readUserConfig(getUserPresetConfigPath()) as {
          preset?: string;
          presets?: Record<string, unknown>;
        };
        if (typeof user.preset !== 'string') return undefined;
        // 指纹纳入激活 preset 的完整内容：/oceanus-config 覆盖同名激活 preset
        //（如补 prometheus、换模型）时名字不变，仅靠名字会漏触发重建。
        return `${user.preset}\n${JSON.stringify(user.presets?.[user.preset] ?? {})}`;
      } catch {
        return undefined;
      }
    };
    let presetBaseline = readPresetFingerprint();
    let applying = false;
    const applyFreshDefinitions = () => {
      if (applying) return;
      applying = true;
      // 异步重建；失败 fail-open（指纹不变不会重试，可再次 /preset 触发）。
      void applyAgentDefinitions(
        ctx,
        (options.loadConfig ?? loadPluginConfig)({ directory }),
        agentRefreshState,
      )
        .catch((error) => report('preset-watcher.apply', error))
        .finally(() => {
          applying = false;
        });
    };
    const comparePreset = () => {
      const next = readPresetFingerprint();
      if (next === undefined || next === presetBaseline) return;
      presetBaseline = next;
      applyFreshDefinitions();
    };
    // fs.watch 事件驱动（去抖 100ms，监听目录以规避原子写替换 inode 后
    // 失联的问题），2s 轮询兜底（watch 不可用的 FS 上仍能收敛）。
    let presetDebounce: ReturnType<typeof setTimeout> | undefined;
    let presetFileWatcher: ReturnType<typeof watch> | undefined;
    try {
      const configFilePath = getUserPresetConfigPath();
      const configDir = path.dirname(configFilePath);
      const configBase = path.basename(configFilePath);
      presetFileWatcher = watch(configDir, (_event, changed) => {
        if (!changed || changed === configBase || changed.startsWith(`.${configBase}.`)) {
          if (presetDebounce) clearTimeout(presetDebounce);
          presetDebounce = setTimeout(() => {
            presetDebounce = undefined;
            comparePreset();
          }, 100);
        }
      });
      presetFileWatcher.on('error', () => {
        try {
          presetFileWatcher?.close();
        } catch {
          /* noop */
        }
        presetFileWatcher = undefined;
      });
    } catch {
      presetFileWatcher = undefined;
    }
    const presetWatcher = setInterval(comparePreset, 2000);
    // unref 避免定时器阻塞进程退出；注册了 watcher 资源即置 hasCleanup，
    // 使宿主卸载/重载时能释放 2s 轮询与 fs.watch（返回 cleanup 的契约保持一致）。
    presetWatcher.unref?.();
    cleanupRunner.add('preset-watcher.dispose', async () => {
      clearInterval(presetWatcher);
      if (presetDebounce) clearTimeout(presetDebounce);
      try {
        presetFileWatcher?.close();
      } catch {
        /* noop */
      }
    });
    hasCleanup = true;
  }

  return hasCleanup || agentStageFailed ? createHostCleanup(cleanupRunner) : undefined;
}

/**
 * Oceanus 插件（opencode v2 入口）。
 *
 * 通过 ctx.agent.transform 注册一组参考 oh-my-opencode-slim 的 agent：
 * - oceanus（主 agent，颜色 #0FFFFF）
   * - sisyphus（主 agent，六阶段工作流）
 * - explorer / librarian / oracle / designer / fixer / observer（子 agent，observer 需要视觉模型；
 *   oracle 为正式 Review 审查者并承担 consult/analysis 顾问，场景注册表见 src/review/scenes.ts）
 *
 * 同时通过 ctx.skill.transform 注入 sisyphus 工作流的六个阶段 Skill
 * （oceanus-intake / oceanus-discuss / oceanus-plan / oceanus-execute /
 * oceanus-review / oceanus-finish）及支持型 Skill，
 * 安装插件即可使用，无需拷贝任何 skill 文件。
 *
 * 每个 agent 的模型可通过配置文件独立指定
 * （~/.config/opencode/opencode-oceanus.{json,jsonc} 或项目 .opencode/ 下），
 * 未配置时跟随当前会话模型。注册后强制 default agent 为 oceanus。
 */
export default Plugin.define({
  id: 'opencode-oceanus',
  // 说明：`Plugin.tui?: boolean` 字段已于 beta-18721 移除；TUI 入口由
  // package.json `exports["./tui"]`（dist/tui.js）结构性声明，宿主侧能力
  // 位为 `Plugin.Info.features.tui`。
  async setup(ctx) {
    return runSetup(ctx as unknown as PluginSetupContext);
  },
});
