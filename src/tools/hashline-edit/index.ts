/**
 * hashline 编辑核心公共 API。
 *
 * 独立重写的 hashline_edit 核心：稳定行 hash、replace/append/prepend、
 * 范围锚点解析、hash mismatch、换行保留、稳定 diff、路径/文件大小边界。
 * 本模块与具体工具框架解耦，不含 v1 Tool wrapper 或 v2 注册。
 */

// 常量
export { NIBBLE_STR, HASHLINE_DICT, HASHLINE_REF_PATTERN, HASHLINE_OUTPUT_PATTERN } from "./constants"

// 类型
export { HASHLINE_ERROR_CODES } from "./types"
export type { ReplaceEdit, AppendEdit, PrependEdit, HashlineEdit, RawHashlineEdit, HashlineToolOp, LineRef, HashlineErrorCode } from "./types"
export type { HashlineApplyReport } from "./edits"
export type { FileTextEnvelope } from "./envelope"
export type { FileBoundaryLimits } from "./boundaries"
export type { HashlineFileResult, HashlineEditFileOptions } from "./executor"

// 稳定行 hash
export { computeLineHash, computeLegacyLineHash, formatHashLine, formatHashLines } from "./hash"
export { hashXxh32 } from "./xxhash32"

// 范围锚点解析与 hash mismatch
export { parseLineRef, validateLineRef, validateLineRefs, normalizeLineRef, HashlineMismatchError } from "./refs"

// 归一化 / 编辑操作 / 批量应用
export { normalizeHashlineEdits } from "./normalize"
export {
  applySetLine,
  applyReplaceLines,
  applyInsertAfter,
  applyInsertBefore,
  applyAppend,
  applyPrepend,
} from "./operations"
export { applyHashlineEdits, applyHashlineEditsWithReport } from "./edits"
export { dedupeEdits, getEditLineNumber, collectLineRefs, detectOverlappingRanges } from "./ordering"

// 文本归一化
export {
  stripLinePrefixes,
  toNewLines,
  restoreLeadingIndent,
  stripInsertAnchorEcho,
  stripInsertBeforeEcho,
  stripRangeBoundaryEcho,
  autocorrectReplacementLines,
} from "./text"

// 换行保留
export { canonicalizeFileText, restoreFileText } from "./envelope"

// 稳定 diff
export {
  toHashlineContent,
  generateHashlineDiff,
  generateUnifiedDiff,
  countLineDiffs,
} from "./diff"

// 路径 / 文件大小边界
export { validateFilePath, validateFileSize, normalizeDisplayPath, DEFAULT_BOUNDARY_LIMITS } from "./boundaries"

// 文件级执行器
export { applyHashlineEditToFile, fsSizeBytes } from "./executor"
