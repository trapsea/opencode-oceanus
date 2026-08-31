/**
 * clipboard_image 工具（clipboard-image-observer-workflow §3.3 阶段一）。
 *
 * 读取剪贴板图片并落盘为 PNG（BMP 无法转换时保存 .bmp 原件），返回绝对路径；
 * 用于把用户粘贴的图片交给 observer 等视觉 agent 分析（observer 只接受文件路径）。
 *
 * 语义：
 * - 落盘目录 `<workspaceRoot>/.oceanus/media/`，文件名
 *   `<UTC 时间戳>-<内容 hash 前 8 位>.<ext>`；
 * - 成功返回 `{ok:true, path}`；剪贴板无图 / 环境无可用工具返回结构化指引；
 * - 任何分支都不抛异常（fail-open，与现有工具语义一致）；
 * - 读取 / 时间 / 文件系统均可注入，便于 mock 单测。
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readClipboardImage, type ClipboardReadResult } from './clipboard/platforms';
import { resolveWorkspaceRoot } from '../runtime/workspace';
import type { ToolContextLike, ToolDefinition, ToolingContext } from '../runtime/types';

export interface ClipboardImageDeps {
  /** 剪贴板读取注入（默认 platforms.readClipboardImage）。 */
  readClipboard?: () => Promise<ClipboardReadResult>;
  /** 时间注入（默认 Date.now）。 */
  now?: () => number;
  /** 文件系统注入（默认 node:fs/promises）。 */
  fs?: {
    mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
    writeFile(file: string, data: Uint8Array): Promise<unknown>;
  };
}

const NO_IMAGE_MESSAGE = '剪贴板中没有图片';
const NO_TOOL_MESSAGE = '当前环境无法读取剪贴板，请让用户保存图片并告知路径';

function contentResult(obj: unknown): { content: string } {
  return { content: JSON.stringify(obj, null, 2) };
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** UTC 紧凑时间戳：YYYYMMDDTHHMMSSmmmZ（文件名安全）。 */
function timestampOf(now: number): string {
  const d = new Date(now);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` +
    `${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

export function buildClipboardImageTool(
  wctx: ToolingContext,
  deps: ClipboardImageDeps = {},
): ToolDefinition {
  const readClipboard = deps.readClipboard ?? readClipboardImage;
  const now = deps.now ?? Date.now;
  const fs = deps.fs ?? { mkdir, writeFile };
  return {
    name: 'clipboard_image',
    description:
      '读取剪贴板图片并保存为文件（优先 PNG），返回绝对路径；用于把用户粘贴/截图的图片交给 observer 等视觉 agent 分析。剪贴板无图片或当前环境无法读取时返回明确指引。',
    input: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_input: unknown, tctx: ToolContextLike) {
      try {
        const root = await resolveWorkspaceRoot(wctx.session, tctx.sessionID);
        if (!root) {
          return contentResult({
            ok: false,
            reason: 'error',
            message: '无法解析当前会话的工作区根目录，未能保存剪贴板图片',
          });
        }
        const result = await readClipboard();
        if (result.kind === 'no-image') {
          return contentResult({ ok: false, reason: 'no-image', message: result.message || NO_IMAGE_MESSAGE });
        }
        if (result.kind === 'no-tool') {
          return contentResult({ ok: false, reason: 'no-tool', message: result.message || NO_TOOL_MESSAGE });
        }
        const hash8 = createHash('sha256').update(result.bytes).digest('hex').slice(0, 8);
        const dir = path.join(root, '.oceanus', 'media');
        const file = path.join(dir, `${timestampOf(now())}-${hash8}.${result.ext}`);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file, result.bytes);
        return contentResult({
          ok: true,
          path: file,
          format: result.ext,
          bytes: result.bytes.length,
          ...(result.note ? { note: result.note } : {}),
        });
      } catch (e) {
        // fail-open：任何异常都转为结构化结果，绝不向上抛
        return contentResult({
          ok: false,
          reason: 'error',
          message: `clipboard_image 执行失败: ${messageOf(e)}`,
        });
      }
    },
  };
}
