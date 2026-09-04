/**
 * 剪贴板/粘贴图片物化 hook（image-materializer）。
 *
 * 通过 `ctx.session.hook("prompt")` 在附件进入模型前拦截：
 * - `data:image/*` 附件 → 物化到 `<workspace>/.oceanus/media/`，
 *   以内容 hash 命名（重试安全：hook 并发重入时幂等，不重复写盘）；
 * - `orchestratorVision === "false"` 时：把图片附件从 `files` 移除
 *   （非视觉主模型，避免宿主报告“不支持图片输入”），
 *   并在 text 末尾追加路径指引，提示主 agent 委派 @observer；
 * - `true` / `auto`：保留图片附件（data: URI 替换为 file://），同样追加路径提示。
 *
 * 设计文档：.oceanus/spec/clipboard-image-observer-workflow.md §3.4。
 * 全程故障开放：任何异常仅记日志，绝不阻塞 prompt 接纳。
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function defaultWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** prompt hook event 的最小契约（v2 `SessionPrompt` 的可用子集）。 */
export interface PromptHookEvent {
  readonly sessionID: string;
  prompt: {
    text: string;
    files?: Array<{ uri: string }>;
  };
}

/** 可注入依赖（测试替换 fs/hash/env）。 */
export interface ImageMaterializerDeps {
  /** 落盘实现（默认真实 fs）。 */
  write?: (path: string, bytes: Uint8Array) => Promise<void>;
  /** hash 实现（默认 sha256 前 12 位 hex）。 */
  hash?: (bytes: Uint8Array) => string;
  /**
   * 工作区根目录解析（缺省由接线层注入 resolveWorkspaceRoot）。
   * 接收当前 prompt 事件的 sessionID，用于解析会话所属工作区；
   * 支持同步或 Promise 返回；忽略入参的旧式注入仍可用（兼容）。
   */
  getWorkspaceRoot: (sessionID: string) => string | Promise<string>;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

/** data: URI 解析结果。 */
function parseDataImageUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(uri);
  if (!m) return null;
  try {
    return { mime: m[1], bytes: new Uint8Array(Buffer.from(m[2], 'base64')) };
  } catch {
    return null;
  }
}

/** mime → 扩展名（物化文件名用）。 */
function extOf(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/bmp') return 'bmp';
  return 'img';
}

export interface MaterializeOutcome {
  /** 物化成功的文件绝对路径列表。 */
  paths: string[];
  /** 是否修改了 event（files / text）。 */
  mutated: boolean;
}

/**
 * 物化 prompt 中的图片附件。直接操作传入 event（owned draft 可变），
 * 幂等：相同内容 hash 文件名相同，重复触发不产生新文件。
 */
export async function materializePromptImages(
  event: PromptHookEvent,
  visionSupported: boolean,
  deps: ImageMaterializerDeps,
): Promise<MaterializeOutcome> {
  const log = deps.logger ?? (() => {});
  const files = event.prompt.files ?? [];
  const paths: string[] = [];
  let mutated = false;
  const nextFiles: Array<{ uri: string }> = [];

  for (const file of files) {
    const parsed = file.uri.startsWith('data:image/') ? parseDataImageUri(file.uri) : null;
    if (!parsed) {
      nextFiles.push(file);
      continue;
    }
    try {
      const hash = deps.hash
        ? deps.hash(parsed.bytes)
        : createHash('sha256').update(parsed.bytes).digest('hex').slice(0, 12);
      const dir = join(await deps.getWorkspaceRoot(event.sessionID), '.oceanus', 'media');
      const path = join(dir, `${hash}.${extOf(parsed.mime)}`);
      await (deps.write ?? defaultWrite)(path, parsed.bytes);
      paths.push(path);
      mutated = true;
      // 非视觉主模型：移除图片 part（防止宿主报错）；视觉模型：替换为 file:// 路径。
      if (visionSupported) nextFiles.push({ uri: `file://${path}` });
    } catch (e) {
      // 物化失败时故障开放：保留原 part，不影响接纳。
      log('[oceanus] 图片物化失败（故障开放）', {
        error: e instanceof Error ? e.message : String(e),
      });
      nextFiles.push(file);
    }
  }

  if (mutated) {
    event.prompt.files = nextFiles;
    const hint = `[oceanus] 已物化图片附件: ${paths.join(', ')}。若当前模型不支持视觉，请将绝对路径与分析目标委派给 @observer（见 clipboard-image-observer skill）。`;
    event.prompt.text = `${event.prompt.text}\n${hint}`;
  }
  return { paths, mutated };
}

/**
 * 注册 prompt 物化 hook（仅 prompt；retry 兜底提示见 image-error-hint.ts）。
 *
 * beta-18743 的 `SessionDomain` hook 名联合已正式覆盖 `prompt`；注册仍保留
 * 接线层的运行时能力探测（类型声明不等于运行时保证）并故障开放。参数采用
 * 最小结构形状（官方 `SessionPrompt` 的可用子集，经 `unknown` 显式窄化），
 * 不得因类型已声明而移除本注册。
 * retry hook 与 prompt hook 能力相互独立，不能从 prompt 可用推断 retry 可用。
 */
export async function registerImageMaterializer(
  session: {
    hook(
      name: string,
      cb: (event: unknown) => Promise<void> | void,
    ): Promise<unknown>;
  },
  getVisionSupported: () => boolean,
  deps: ImageMaterializerDeps,
): Promise<unknown> {
  return session.hook('prompt', async (event: unknown) => {
    await materializePromptImages(
      event as PromptHookEvent,
      getVisionSupported(),
      deps,
    );
  });
}
