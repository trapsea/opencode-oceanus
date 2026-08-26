/**
 * hashline 编辑核心执行器（文件级）。
 *
 * 这是一层与具体工具框架无关的纯核心：输入文件路径与原始编辑请求，
 * 读取 → 校验边界 → 归一化 → 应用编辑 → 写回 → 生成稳定 diff。
 * 不依赖 @opencode-ai/plugin 的 Tool 上下文，也不做 v2 注册。
 */
import { access, readFile, stat, writeFile } from "node:fs/promises"
import { normalizeHashlineEdits } from "./normalize"
import type { RawHashlineEdit, HashlineEdit } from "./types"
import { applyHashlineEditsWithReport } from "./edits"
import { canonicalizeFileText, restoreFileText, type FileTextEnvelope } from "./envelope"
import { countLineDiffs, generateHashlineDiff } from "./diff"
import { DEFAULT_BOUNDARY_LIMITS, validateFilePath, validateFileSize, type FileBoundaryLimits } from "./boundaries"

export interface HashlineEditFileOptions {
  limits?: FileBoundaryLimits
  /** 仅用于测试注入：默认使用 node:fs/promises。 */
  fs?: {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    exists(path: string): Promise<boolean>
    size(path: string): Promise<number>
  }
}

export interface HashlineFileResult {
  ok: boolean
  error?: string
  path: string
  created: boolean
  changed: boolean
  before: string
  after: string
  diff: string
  additions: number
  deletions: number
  noopEdits: number
  deduplicatedEdits: number
  firstChangedLine?: number
}

/** 新建文件仅允许"无锚点的 append/prepend"（即直接写入新文件）。 */
function canCreateFromMissingFile(edits: HashlineEdit[]): boolean {
  if (edits.length === 0) return false
  return edits.every((edit) => (edit.op === "append" || edit.op === "prepend") && !edit.pos)
}

function readAsUtf8(buf: Uint8Array): string {
  // ignoreBOM:true 让解码保留 BOM 字符，便于封套检测并原样还原。
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf)
}

function firstChangedLine(before: string, after: string): number | undefined {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  const max = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < max; i++) {
    if ((beforeLines[i] ?? "") !== (afterLines[i] ?? "")) {
      return i + 1
    }
  }
  return undefined
}

/** 从封套恢复写回内容，并尝试保留原文件结尾换行语义。 */
function buildWriteContent(canonicalAfter: string, envelope: FileTextEnvelope): string {
  return restoreFileText(canonicalAfter, envelope)
}

/**
 * 对文件执行 hashline 编辑。所有错误都以 { ok:false, error } 返回，
 * 不向外抛异常（便于工具层直接转成用户可见消息）。
 */
export async function applyHashlineEditToFile(
  filePath: string,
  rawEdits: RawHashlineEdit[],
  options: HashlineEditFileOptions = {}
): Promise<HashlineFileResult> {
  try {
    validateFilePath(filePath)
    const limits = options.limits ?? DEFAULT_BOUNDARY_LIMITS

    // 校验编辑输入。
    if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
      return {
        ok: false,
        path: filePath,
        created: false,
        changed: false,
        before: "",
        after: "",
        diff: "",
        additions: 0,
        deletions: 0,
        noopEdits: 0,
        deduplicatedEdits: 0,
        error: `Error: edits parameter must be a non-empty array`,
      }
    }

    const edits = normalizeHashlineEdits(rawEdits)

    const exists = await fsExists(filePath, options.fs)
    if (!exists && !canCreateFromMissingFile(edits)) {
      return {
        ok: false,
        path: filePath,
        created: false,
        changed: false,
        before: "",
        after: "",
        diff: "",
        additions: 0,
        deletions: 0,
        noopEdits: 0,
        deduplicatedEdits: 0,
        error: `Error: File not found: ${filePath}`,
      }
    }

    const rawOldContent = exists ? await fsReadText(filePath, options.fs) : ""
    if (exists) {
      const sizeBytes = Buffer.byteLength(rawOldContent, "utf-8")
      validateFileSize(sizeBytes, limits)
    }

    const envelope = canonicalizeFileText(rawOldContent)
    const applyResult = applyHashlineEditsWithReport(envelope.content, edits)

    if (applyResult.content === envelope.content) {
      let diagnostic = `No changes made to ${filePath}. The edits produced identical content.`
      if (applyResult.noopEdits > 0) {
        diagnostic += ` No-op edits: ${applyResult.noopEdits}. Re-read the file and provide content that differs from current lines.`
      }
      return {
        ok: false,
        path: filePath,
        created: !exists,
        changed: false,
        before: envelope.content,
        after: envelope.content,
        diff: "",
        additions: 0,
        deletions: 0,
        noopEdits: applyResult.noopEdits,
        deduplicatedEdits: applyResult.deduplicatedEdits,
        error: `Error: ${diagnostic}`,
      }
    }

    const writeContent = buildWriteContent(applyResult.content, envelope)
    await fsWrite(filePath, writeContent, options.fs)

    const before = envelope.content
    const after = applyResult.content
    const { additions, deletions } = countLineDiffs(before, after)

    return {
      ok: true,
      path: filePath,
      created: !exists,
      changed: true,
      before,
      after,
      diff: generateHashlineDiff(before, after, filePath),
      additions,
      deletions,
      noopEdits: applyResult.noopEdits,
      deduplicatedEdits: applyResult.deduplicatedEdits,
      firstChangedLine: firstChangedLine(before, after),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      path: filePath,
      created: false,
      changed: false,
      before: "",
      after: "",
      diff: "",
      additions: 0,
      deletions: 0,
      noopEdits: 0,
      deduplicatedEdits: 0,
      error: message,
    }
  }
}

// --- 文件访问抽象 ---

async function fsExists(path: string, fs?: HashlineEditFileOptions["fs"]): Promise<boolean> {
  if (fs) return fs.exists(path)
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fsReadText(path: string, fs?: HashlineEditFileOptions["fs"]): Promise<string> {
  if (fs) return fs.readFile(path)
  const buf = await readFile(path)
  return readAsUtf8(buf)
}

async function fsWrite(path: string, content: string, fs?: HashlineEditFileOptions["fs"]): Promise<void> {
  if (fs) {
    await fs.writeFile(path, content)
    return
  }
  await writeFile(path, content, "utf-8")
}

export async function fsSizeBytes(path: string, fs?: HashlineEditFileOptions["fs"]): Promise<number> {
  if (fs) {
    const content = await fs.readFile(path)
    return Buffer.byteLength(content, "utf-8")
  }
  const s = await stat(path)
  return s.size
}
