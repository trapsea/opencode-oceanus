/**
 * hashline 编辑核心执行器（文件级）。
 *
 * 这是一层与具体工具框架无关的纯核心：输入文件路径与原始编辑请求，
 * 读取 → 校验边界 → 归一化 → 应用编辑 → 写回 → 生成稳定 diff。
 * 不依赖 @opencode-ai/plugin 的 Tool 上下文，也不做 v2 注册。
 */
import { access, readFile, stat, lstat, unlink, rename, link, open } from "node:fs/promises"
import { dirname, resolve, relative, sep, isAbsolute } from "node:path"
import { normalizeHashlineEdits } from "./normalize"
import type { RawHashlineEdit, HashlineEdit, HashlineErrorCode } from "./types"
import { applyHashlineEditsWithReport } from "./edits"
import { canonicalizeFileText, restoreFileText, type FileTextEnvelope } from "./envelope"
import { countLineDiffs, generateHashlineDiff } from "./diff"
import { DEFAULT_BOUNDARY_LIMITS, validateFilePath, validateFileSize, type FileBoundaryLimits } from "./boundaries"
import { HashlineMismatchError } from "./refs"

export interface HashlineEditFileOptions {
  limits?: FileBoundaryLimits
  root?: string
  delete?: boolean
  rename?: string
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
  errorCode?: HashlineErrorCode
  path: string | null
  created: boolean
  changed: boolean
  before: string
  after: string
  diff: string
  additions: number
  deletions: number
  noopEdits: number
  deduplicatedEdits: number
  deleted?: boolean
  renamed?: boolean
  from?: string | null
  to?: string | null
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
  const root = options.root ? resolve(options.root) : undefined
  const display = (p: string): string | null => {
    const r = relative(root ?? process.cwd(), resolve(p)).replaceAll(sep, "/")
    return r === "" || (!r.startsWith("../") && r !== ".." && !isAbsolute(r)) ? r : null
  }
  try {
    validateFilePath(filePath)
    const limits = options.limits ?? DEFAULT_BOUNDARY_LIMITS

    const operation = options.delete ? "delete" : options.rename !== undefined ? "rename" : undefined
    const hasEdits = Array.isArray(rawEdits) && rawEdits.length > 0
      if (options.delete && options.rename !== undefined || operation && hasEdits) return failure(filePath, "混合操作不允许", "INVALID_INPUT")
    if (root) {
      const rootInfo = await safePathInfo(root)
      if (!rootInfo || !rootInfo.isDirectory || rootInfo.isSymlink) return failure(filePath, "工作区根目录无效", rootInfo?.isSymlink ? "SYMLINK" : !rootInfo ? "NOT_FOUND" : "DIRECTORY")
      if (!(await securePath(root, filePath, true))) return failure(filePath, "路径位于工作区之外或包含符号链接，已拒绝", "OUTSIDE_WORKSPACE")
    }
    if (operation) {
       const sourceLstat = await safePathInfo(filePath)
       const exists = await fsExists(filePath, options.fs)
       if (sourceLstat?.isSymlink) return failure(display(filePath), "源文件不能是符号链接", "SYMLINK")
      if (!exists) return failure(filePath, `Error: File not found: ${filePath}`, "NOT_FOUND")
      const sourceInfo = await safePathInfo(filePath)
       if (!sourceInfo || sourceInfo.isDirectory || sourceInfo.isSymlink) return failure(filePath, "源文件必须是普通文件", sourceInfo?.isSymlink ? "SYMLINK" : sourceInfo?.isDirectory ? "DIRECTORY" : "NOT_FOUND")
      if (operation === "delete") {
        if (options.fs) throw new Error("Error: delete operation is unavailable with injected fs")
        await unlink(filePath)
        return { ...successBase(display(filePath)), ok: true, changed: true, path: display(filePath), deleted: true, from: display(filePath) ?? undefined }
      }
      if (options.fs) throw new Error("Error: rename operation is unavailable with injected fs")
      validateFilePath(options.rename!)
      const target = root ? resolve(root, options.rename!) : resolve(options.rename!)
       if (root && !(await securePath(root, target, true))) return failure(filePath, "重命名目标位于工作区之外或包含符号链接，已拒绝", "OUTSIDE_WORKSPACE")
      const parentInfo = await safePathInfo(dirname(target))
       if (!parentInfo || !parentInfo.isDirectory || parentInfo.isSymlink) return failure(filePath, "目标父路径不是安全目录", parentInfo?.isSymlink ? "SYMLINK" : !parentInfo ? "NOT_FOUND" : "DIRECTORY")
      const targetInfo = await safePathInfo(target)
       if (targetInfo?.isSymlink) return failure(display(filePath), "目标不能是符号链接", "SYMLINK")
      if (targetInfo) return failure(filePath, `重命名目标已存在: ${target}`, "TARGET_EXISTS")
       if (target === resolve(filePath)) return failure(filePath, "重命名目标与源相同", "TARGET_EXISTS")
       // rename(2) 会覆盖目标；link + unlink 在目标存在时安全失败。
        let linked = false
        try {
          await link(filePath, target)
          linked = true
          await unlink(filePath)
        } catch (error) {
          if (linked) await unlink(target).catch(() => {})
          throw error
        }
        return { ...successBase(display(target)), ok: true, changed: true, path: display(target), renamed: true, from: display(filePath) ?? null, to: display(target) ?? null }
    }
    // 校验编辑输入。
    if (!hasEdits) {
      return {
        ok: false,
         path: display(filePath),
        created: false,
        changed: false,
        before: "",
        after: "",
        diff: "",
        additions: 0,
        deletions: 0,
        noopEdits: 0,
        deduplicatedEdits: 0,
         error: `Error: edits parameter must be a non-empty array`, errorCode: "INVALID_INPUT",
      }
    }

    let edits: HashlineEdit[]
    try {
      edits = normalizeHashlineEdits(rawEdits)
    } catch (error) {
      return failure(filePath, error instanceof Error ? error.message : String(error), "INVALID_INPUT")
    }

    const exists = await fsExists(filePath, options.fs)
    if (!exists) {
      const parentInfo = await safePathInfo(dirname(resolve(filePath)))
      if (!parentInfo || !parentInfo.isDirectory || parentInfo.isSymlink) {
        return failure(filePath, "目标父路径不是安全目录", !parentInfo ? "NOT_FOUND" : parentInfo.isSymlink ? "SYMLINK" : "DIRECTORY")
      }
    }
    if (!exists && !canCreateFromMissingFile(edits)) {
      return {
        ok: false,
         path: display(filePath),
        created: false,
        changed: false,
        before: "",
        after: "",
        diff: "",
        additions: 0,
        deletions: 0,
        noopEdits: 0,
        deduplicatedEdits: 0,
        error: `Error: File not found: ${filePath}`, errorCode: "NOT_FOUND",
      }
    }

    const sizeBytes = exists ? await fsSizeBytes(filePath, options.fs) : 0
    if (exists) {
      validateFileSize(sizeBytes, limits)
    }
    const originalMode = exists && !options.fs ? (await stat(filePath)).mode : undefined
    const rawOldContent = exists ? await fsReadText(filePath, options.fs) : ""

    const envelope = canonicalizeFileText(rawOldContent)
    const applyResult = applyHashlineEditsWithReport(envelope.content, edits)

    if (applyResult.content === envelope.content) {
      let diagnostic = `No changes made to ${filePath}. The edits produced identical content.`
      if (applyResult.noopEdits > 0) {
        diagnostic += ` No-op edits: ${applyResult.noopEdits}. Re-read the file and provide content that differs from current lines.`
      }
      return {
        ok: false,
         path: display(filePath),
        created: !exists,
        changed: false,
        before: envelope.content,
        after: envelope.content,
        diff: "",
        additions: 0,
        deletions: 0,
        noopEdits: applyResult.noopEdits,
        deduplicatedEdits: applyResult.deduplicatedEdits,
        error: diagnostic, errorCode: "NOOP",
      }
    }

    const writeContent = buildWriteContent(applyResult.content, envelope)
    await fsWrite(filePath, writeContent, options.fs, originalMode)

    const before = envelope.content
    const after = applyResult.content
    const { additions, deletions } = countLineDiffs(before, after)

    return {
      ok: true,
       path: display(filePath),
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
      error: message, errorCode: error instanceof HashlineMismatchError ? "HASH_MISMATCH" :
        /exceeds maximum|invalid file size/i.test(message) ? "FILE_TOO_LARGE" : "IO_ERROR",
    }
  }
}

function successBase(filePath: string | null): HashlineFileResult {
  return { ok: false, path: filePath, created: false, changed: false, before: "", after: "", diff: "", additions: 0, deletions: 0, noopEdits: 0, deduplicatedEdits: 0 }
}
function failure(filePath: string | null, error: string, errorCode: HashlineErrorCode = "IO_ERROR"): HashlineFileResult { return { ...successBase(filePath), error, errorCode } }

async function safePathInfo(p: string) {
  try { const s = await lstat(p); return { isDirectory: s.isDirectory(), isSymlink: s.isSymbolicLink() } } catch { return undefined }
}
function within(root: string, target: string) { const r = relative(root, target); return r === "" || (!r.startsWith(".." + sep) && r !== ".." && !isAbsolute(r)) }
async function securePath(root: string, target: string, allowMissingTarget: boolean): Promise<boolean> {
  const abs = resolve(target)
  if (!within(root, abs)) return false
  let cur = abs
  const targetInfo = await safePathInfo(cur)
  if (targetInfo?.isSymlink) return false
  if (!targetInfo && !allowMissingTarget) return false
  while (within(root, cur) && cur !== root) {
    const info = await safePathInfo(cur)
    if (info?.isSymlink) return false
    cur = dirname(cur)
  }
  return cur === root
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

async function fsWrite(path: string, content: string, fs?: HashlineEditFileOptions["fs"], mode?: number): Promise<void> {
  if (fs) {
    await fs.writeFile(path, content)
    return
  }
  const temp = `${path}.hashline-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, "wx", mode === undefined ? 0o600 : mode)
    await handle.writeFile(content, "utf-8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, path)
  } catch (error) {
    await handle?.close().catch(() => {})
    await unlink(temp).catch(() => {})
    throw error
  }
}

export async function fsSizeBytes(path: string, fs?: HashlineEditFileOptions["fs"]): Promise<number> {
  if (fs) {
    return fs.size(path)
  }
  const s = await stat(path)
  return s.size
}
