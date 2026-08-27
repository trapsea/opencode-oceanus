/**
 * Oceanus 新增 Hook 的 v2 注册（tooling-9-v2-wiring）。
 *
 * 通过 `ctx.tool.hook("execute.before")` / `ctx.tool.hook("execute.after")` 注册，
 * 固定执行顺序：
 *   before: apply-patch → (loop-guard.before) → task-registry-observer.before
 *           → cbm-guidance.before
 *   after:  json-error-recovery → tool-output-truncator → tool-loop-guard
 *           → task-registry-observer.after → cbm-guidance.after
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
import { createCbmGuidanceHook } from './cbm-guidance';
import { createHashlineReadEnhancer } from './hashline-read-enhancer';
import { createTaskObserver } from '../runtime/task-observer';
import {
  isHookEnabled,
  getHookConfig,
  getCodebaseMemoryConfig,
  isCodebaseMemoryEnabled,
  isCodebaseMemoryGuidanceEnabled,
  getTaskReuseConfig,
} from '../config/utils';
import { createIndexer, type IndexerHandle, type IndexerRunCli } from '../cbm/indexer';
import type { CbmRunDeps } from '../tools/cbm/types';
import type { PluginConfig } from '../config/schema';
import { resolveWorkspaceRoot } from '../runtime/workspace';
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
  /** 注入 JobBoard/通知依赖，缺省时 observer 仍仅维护 registry。 */
  board?: import('../tools/task/job-board').JobBoard;
  /** 任务生命周期观测：记录生产接线实际收到的 JobBoard。 */
  taskLifecycleObserver?: (board: import('../tools/task/job-board').JobBoard) => void;
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
  if (opts.board) opts.taskLifecycleObserver?.(opts.board);

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
  // hashline enhancer 是固定协议适配器，不受 hooks.enabled/disabled_hooks 控制。
  {
    try {
      const enhancer = createHashlineReadEnhancer();
      await ctx.tool.hook('execute.after', (event: any) => {
        try { enhancer(event); } catch (e) {
          log('[oceanus] hashline-read-enhancer 失败(fail-open)', { error: messageOf(e) });
        }
      });
    } catch (e) {
      log('[oceanus] 注册 hashline-read-enhancer hook 失败', { error: messageOf(e) });
    }
  }

  // 3) tool-output-truncator
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

  // ── task-registry-observer：观察宿主 task/subagent，内部记录 registry ──
  if (isHookEnabled(config, 'task_registry_observer')) {
    try {
      const observer = createTaskObserver({
        logger: (message, meta) => log(`[oceanus] ${message}`, meta),
        board: opts.board,
        session: ctx.session as import('../runtime/types').SessionLike,
        reuse: getTaskReuseConfig(config),
      });
      await ctx.tool.hook('execute.before', observer['execute.before'] as never);
      await ctx.tool.hook('execute.after', observer['execute.after'] as never);
    } catch (e) {
      log('[oceanus] 注册 task-registry-observer 失败', { error: messageOf(e) });
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
}
