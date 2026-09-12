/**
 * Oceanus 新增 Hook 的 v2 注册（tooling-9-v2-wiring）。
 *
 * 通过 `ctx.tool.hook("execute.before")` / `ctx.tool.hook("execute.after")` 注册，
 * 固定执行顺序（与 registerOceanusHooks 实际注册序列一致）：
 *   before: apply-patch → (loop-guard.before) → secret-read-guard → planning-write-guard
 *           → direct-mcp-write-guard → cbm-index-repeat-guard → cbm-guidance.before
 *   after:  json-error-recovery → tool-output-truncator → tool-loop-guard
 *           → cbm-guidance.after
 * （image-materializer / image-error-hint 为 session hook，独立注册。）
 *
 * 每个 Hook 独立容错：
 * - 注册阶段各自 try/catch，一个 Hook 注册失败不阻止其它 Hook。
 * - after Hook 默认 fail-open：保护逻辑失败不阻断已完成的宿主工具结果。
 * - apply-patch 遵循其自身 fail-closed 语义（validation/verification/internal
 *   抛 ApplyPatchError 交由宿主阻断；outside_workspace / 只读输入 fail-open）。
 *   若无法解析工作区根目录则跳过校验（fail-open），不误伤合法 apply_patch。
 *
 * 使用真实 v2 event.input / event.result / event.error 形状，不复制 v1 双参数 output。
 */
import { createApplyPatchHook } from './apply-patch';
import { applyJsonErrorRecovery } from './json-error-recovery';
import { createToolOutputTruncator } from './tool-output-truncator';
import { createToolLoopGuardHook } from './tool-loop-guard';
import {
  buildGrepReadHint,
  createCbmGuidanceHook,
  createCbmIndexRepeatGuard,
  createDirectMcpWriteGuard,
} from './cbm-guidance';
import { createSecretReadGuardHook } from './secret-read-guard';
import { createPlanningWriteGuardHook } from './planning-write-guard';
import { registerImageMaterializer } from './image-materializer';
import { registerImageErrorHint } from './image-error-hint';
import {
  isHookEnabled,
  getHookConfig,
  getCodebaseMemoryConfig,
  isCodebaseMemoryEnabled,
  isCodebaseMemoryGuidanceEnabled,
  isOrchestratorVisionSupported,

} from '../config/utils';
import { createIndexer, type IndexerHandle, type IndexerRunCli } from '../cbm/indexer';
import type { CbmRunDeps } from '../tools/cbm/types';
import type { PluginConfig } from '../config/schema';
import { resolveWorkspaceRoot, resolveWorkspaceRootOrCwd } from '../runtime/workspace';
import type { ToolingContext } from '../runtime/types';

/** 注册期可选依赖（日志注入，测试可传入 spy）。 */
export interface RegisterHooksOptions {
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  /** cbm-guidance 实际执行 CLI 的函数（默认 runCbmCli，测试注入 fake）。 */
  runCli?: IndexerRunCli;
  /** CLI 执行依赖（spawn / resolveBinary / ensureInstalled 等）。 */
  runDeps?: CbmRunDeps;
  /** 自定义索引器（测试注入 stub；缺省由 createIndexer 构建）。 */
  indexer?: IndexerHandle;
  /** cbm-guidance 索引检查超时（毫秒）。 */
  timeoutMs?: number;
}

/** 默认输出截断上限（与规格一致）。 */
export const DEFAULT_MAX_OUTPUT_BYTES = 200_000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 从 tools 配置收集每个工具的最大输出字节覆盖。 */
function perToolLimits(config: PluginConfig): Record<string, number> {
  const out: Record<string, number> = {};
  const tools = config.tools ?? {};
  for (const name of Object.keys(tools)) {
    const value = (tools as Record<string, { maxOutputBytes?: number } | undefined>)[name]
      ?.maxOutputBytes;
    if (typeof value === 'number') out[name] = value;
  }
  return out;
}

/**
 * 注册全部启用的新增 Hook。
 */
export async function registerOceanusHooks(
  ctx: ToolingContext,
  config: PluginConfig,
  opts: RegisterHooksOptions = {},
): Promise<void> {
  const log = opts.logger ?? (() => {});

  // ── before ─────────────────────────────────────────────
  if (isHookEnabled(config, 'apply_patch')) {
    try {
      await ctx.tool.hook('execute.before', async (event: any) => {
        if (event?.tool !== 'apply_patch') return;
        try {
          const root = await resolveWorkspaceRoot(ctx.session, event.sessionID);
          if (!root) {
            // 无法解析工作区 → 无法校验路径边界；fail-open，不误伤合法调用。
            log('[oceanus] apply_patch: 无法解析工作区根目录，跳过校验(fail-open)');
            return;
          }
          const hook = createApplyPatchHook({
            root,
            onStatus: (status, data) => log(`[oceanus] apply_patch:${status}`, data),
          });
          // 将真实 v2 event 直接传给 hook（类型兼容转换）：hook 在 writePatchInput 中
          // 会 `event.input = next` 整体替换 input，只有传真实 event 该替换才能传播到
          // 宿主，否则替换只会落在包装对象上而宿主仍持原对象。
          await hook(event as never);
        } catch (e) {
          // fail-closed：抛给宿主以阻断工具执行（此语义由 smoke test 固定）。
          log('[oceanus] apply_patch hook 抛错(fail-closed)', { error: messageOf(e) });
          throw e;
        }
      });
    } catch (e) {
      log('[oceanus] 注册 apply_patch hook 失败', { error: messageOf(e) });
    }
  }

  const loopGuardEnabled = isHookEnabled(config, 'tool_loop_guard');
  const loopGuardCfg = getHookConfig(config, 'tool_loop_guard');
  const loopGuard = loopGuardEnabled
    ? createToolLoopGuardHook({
        log,
        warnAt: loopGuardCfg?.warnAt,
        blockAt: loopGuardCfg?.blockAt,
        maxSessions: loopGuardCfg?.maxSessions,
      })
    : undefined;

  if (loopGuard) {
    try {
      await ctx.tool.hook('execute.before', loopGuard['tool.execute.before'] as never);
    } catch (e) {
      log('[oceanus] 注册 tool-loop-guard.before 失败', { error: messageOf(e) });
    }
  }

  // ── secret-read-guard：阻断 .env / .secrets 进入对话（fail-closed on match） ──
  if (isHookEnabled(config, 'secret_read_guard')) {
    try {
      const guard = createSecretReadGuardHook({
        onStatus: (status, data) => log(`[oceanus] secret-read-guard:${status}`, data),
      });
      await ctx.tool.hook('execute.before', guard['tool.execute.before'] as never);
    } catch (e) {
      log('[oceanus] 注册 secret-read-guard hook 失败', { error: messageOf(e) });
    }
  }

  // ── planning-write-guard：阻断对 .oceanus curated 文档的灾难性缩减覆盖 ──
  if (isHookEnabled(config, 'planning_write_guard')) {
    try {
      await ctx.tool.hook('execute.before', async (event: any) => {
        if (event?.tool !== 'write') return;
        const root = await resolveWorkspaceRoot(ctx.session, event.sessionID);
        if (!root) return; // 无法解析工作区根 → fail-open
        const guard = createPlanningWriteGuardHook({
          root,
          onStatus: (status, data) => log(`[oceanus] planning-write-guard:${status}`, data),
        });
        await guard['tool.execute.before'](event as never);
      });
    } catch (e) {
      log('[oceanus] 注册 planning-write-guard hook 失败', { error: messageOf(e) });
    }
  }

  // ── after：固定顺序 ─────────────────────────────────────
  // 1) json-error-recovery
  if (isHookEnabled(config, 'json_error_recovery')) {
    try {
      await ctx.tool.hook('execute.after', (event: any) => {
        try {
          const updated = applyJsonErrorRecovery(event);
          if (!updated) return;
          if (updated.status === 'error' && updated.error?.message !== undefined && event.error) {
            event.error.message = updated.error.message;
          } else if (updated.status === 'completed') {
            event.result = { ...event.result, content: updated.result?.content };
          }
        } catch (e) {
          log('[oceanus] json-error-recovery 失败(fail-open)', { error: messageOf(e) });
        }
      });
    } catch (e) {
      log('[oceanus] 注册 json-error-recovery hook 失败', { error: messageOf(e) });
    }
  }

  // 2) tool-output-truncator
  if (isHookEnabled(config, 'tool_output_truncator')) {
    try {
      const hookCfg = getHookConfig(config, 'tool_output_truncator');
      const truncator = createToolOutputTruncator({
        defaultMaxBytes: hookCfg?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        perToolMaxBytes: perToolLimits(config),
      });
      await ctx.tool.hook('execute.after', (event: any) => {
        try {
          truncator(event);
        } catch (e) {
          log('[oceanus] tool-output-truncator 失败(fail-open)', { error: messageOf(e) });
        }
      });
    } catch (e) {
      log('[oceanus] 注册 tool-output-truncator hook 失败', { error: messageOf(e) });
    }
  }

  // 3) tool-loop-guard（after）
  if (loopGuard) {
    try {
      await ctx.tool.hook('execute.after', loopGuard['tool.execute.after'] as never);
    } catch (e) {
      log('[oceanus] 注册 tool-loop-guard.after 失败', { error: messageOf(e) });
    }
  }

  // direct MCP 写入工具始终 fail-closed；不依赖可关闭的 guidance。
  if (isCodebaseMemoryEnabled(config)) {
    try {
      await ctx.tool.hook('execute.before', createDirectMcpWriteGuard() as never);
    } catch (e) {
      log('[oceanus] 注册 direct MCP 写入保护 hook 失败', { error: messageOf(e) });
    }
    // 索引重复触发 guard（cbm_index + direct index_repository 双通道，fail-closed）：
    // 同 session/workspace 冷却窗内只放行第一次触发；同样不依赖可关闭的 guidance。
    try {
      await ctx.tool.hook(
        'execute.before',
        createCbmIndexRepeatGuard({
          resolveRoot: (sessionID) => resolveWorkspaceRoot(ctx.session, sessionID),
        }) as never,
      );
    } catch (e) {
      log('[oceanus] 注册 cbm 索引重复触发保护 hook 失败', { error: messageOf(e) });
    }
  }

  // ── cbm-guidance：CBM 索引健康 advisory（不拦截合法工具，fail-open） ──
  // 同时受 hook 开关、codebaseMemory.enabled 与 codebaseMemory.guidance 约束。
  const cbmGuidanceEnabled =
    isHookEnabled(config, 'cbm_guidance') &&
    isCodebaseMemoryEnabled(config) &&
    isCodebaseMemoryGuidanceEnabled(config);
  if (cbmGuidanceEnabled) {
    try {
      const cm = getCodebaseMemoryConfig(config);
      const indexer =
        opts.indexer ??
        createIndexer({
          autoIndex: cm.autoIndex,
          binaryPath: cm.binaryPath,
          runCli: opts.runCli,
          runDeps: opts.runDeps,
        });
      const cbmGuidance = createCbmGuidanceHook({
        indexer,
        guidanceEnabled: true,
        timeoutMs: opts.timeoutMs,
        resolveRoot: (sessionID) => resolveWorkspaceRoot(ctx.session, sessionID),
        log: (message, meta) => log(`[oceanus] ${message}`, meta),
      });
      await ctx.tool.hook('execute.before', cbmGuidance.before as never);
      await ctx.tool.hook('execute.after', cbmGuidance.after as never);
    } catch (e) {
      log('[oceanus] 注册 cbm-guidance hook 失败', { error: messageOf(e) });
    }
  }

  // ── image-materializer / image-error-hint：粘贴图片物化与兜底提示 ──
  // prompt 阶段把 data:image/* 附件物化到 .oceanus/media/ 并追加路径提示；
  // retry 阶段识别 "does not support image input" 注入引导。
  // beta-18743 的 SessionDomain hook 名联合已正式覆盖 prompt/retry；注册仍走
  // 运行时能力探测（typeof 检查 + 独立 try/catch）——类型声明不等于运行时
  // 保证，不得移除注册。两个 hook 能力相互独立、各自 fail-open：
  // 不能从 prompt 可用推断 retry 可用；retry 被宿主拒绝也不影响 prompt 注册。
  if (isHookEnabled(config, 'image_materializer')) {
    try {
      const sessionAny = ctx.session as unknown as {
        hook?: (name: string, cb: (event: unknown) => Promise<void> | void) => Promise<unknown>;
      };
      if (typeof sessionAny.hook === 'function') {
        await registerImageMaterializer(
          { hook: (name, cb) => sessionAny.hook!(name, cb) },
          () => isOrchestratorVisionSupported(config),
          {
            getWorkspaceRoot: async (sessionID: string) =>
              (await resolveWorkspaceRootOrCwd(ctx.session, sessionID)),
            logger: (message, meta) => log(message, meta),
          },
        );
      }
    } catch (e) {
      log('[oceanus] 注册 image-materializer 失败（fail-open）', { error: messageOf(e) });
    }
  }
  if (isHookEnabled(config, 'image_error_hint')) {
    try {
      const sessionAny = ctx.session as unknown as {
        hook?: (name: string, cb: (event: unknown) => Promise<void> | void) => Promise<unknown>;
        synthetic?: (input: { sessionID: string; text: string }) => Promise<unknown>;
      };
      if (typeof sessionAny.hook === 'function' && typeof sessionAny.synthetic === 'function') {
        await registerImageErrorHint(
          { hook: (name, cb) => sessionAny.hook!(name, cb) },
          (input) => sessionAny.synthetic!(input),
          (message, meta) => log(message, meta),
        );
      }
    } catch (e) {
      log('[oceanus] 注册 image-error-hint 失败（fail-open）', { error: messageOf(e) });
    }
  }
}
