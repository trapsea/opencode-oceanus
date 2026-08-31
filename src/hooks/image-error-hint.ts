/**
 * 非视觉主模型图片错误兜底 hook（image-error-hint）。
 *
 * 通过运行时探测的 `ctx.session.hook("retry")` 识别宿主对非视觉模型喂图产生的
 * "does not support image input" 类错误：该错误重试无意义，不改 retry 决策，
 * 仅当宿主提供 `session.synthetic` 时注入一条提示，引导主 agent 走
 * clipboard_image 工具 + clipboard-image-observer skill。
 *
 * 设计文档：.oceanus/spec/clipboard-image-observer-workflow.md §3.6。
 * 全程 fail-open：识别或注入失败仅记日志，绝不影响 retry 流程。
 */
export interface RetryHookEvent {
  readonly sessionID: string;
  readonly error: { type?: string; message?: string };
}

/** 判定是否为"模型不支持图片输入"类错误。 */
export function isImageInputError(error: {
  type?: string;
  message?: string;
}): boolean {
  const text = `${error.type ?? ''} ${error.message ?? ''}`.toLowerCase();
  return (
    text.includes('does not support image input') ||
    text.includes('cannot read "clipboard"') ||
    (text.includes('image') && text.includes('not support'))
  );
}

export const IMAGE_ERROR_HINT =
  '[oceanus] 当前模型不支持图片输入。请调用 clipboard_image 工具把剪贴板图片落盘为文件（或请用户保存图片并告知路径），然后按 clipboard-image-observer skill 将绝对路径与分析目标委派给 @observer。';

/**
 * 注册 retry 兜底提示 hook。
 *
 * retry hook 与 prompt hook 能力相互独立：不能从 prompt hook 可用推断 retry
 * 可用；宿主不支持时由接线层运行时探测（hook + synthetic 均存在才注册）后
 * 静默跳过。回调内部全程 fail-open：识别或 synthetic 注入失败仅记日志，
 * 绝不影响 retry 流程。
 */
export async function registerImageErrorHint(
  session: {
    hook(
      name: string,
      cb: (event: never) => Promise<void> | void,
    ): Promise<unknown>;
  },
  synthetic: {
    (input: { sessionID: string; text: string }): Promise<unknown>;
  },
  logger?: (message: string, meta?: Record<string, unknown>) => void,
): Promise<unknown> {
  return session.hook('retry', async (event: never) => {
    try {
      const e = event as unknown as RetryHookEvent;
      if (!e?.error || !isImageInputError(e.error)) return;
      await synthetic({ sessionID: e.sessionID, text: IMAGE_ERROR_HINT });
    } catch (err) {
      logger?.('[oceanus] 图片错误兜底提示失败（fail-open）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
