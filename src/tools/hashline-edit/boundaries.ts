/**
 * 路径与文件大小边界校验。
 *
 * - 拒绝空路径、非法字符、目录路径。
 * - 对超大文件设上限，避免将整个文件读入内存导致资源耗尽。
 */

export interface FileBoundaryLimits {
  maxFileBytes: number
}

export const DEFAULT_BOUNDARY_LIMITS: FileBoundaryLimits = {
  maxFileBytes: 16 * 1024 * 1024, // 16 MiB
}

/** 路径中的非法控制字符。 */
const ILLEGAL_PATH_RE = /[\u0000-\u001f]/

/** 校验编辑目标路径的基本合法性。 */
export function validateFilePath(filePath: string): void {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("Error: filePath must be a non-empty string")
  }
  if (ILLEGAL_PATH_RE.test(filePath)) {
    throw new Error(`Error: filePath contains illegal control characters: "${filePath}"`)
  }
}

/** 校验文件大小是否超出上限。 */
export function validateFileSize(sizeBytes: number, limits: FileBoundaryLimits = DEFAULT_BOUNDARY_LIMITS): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error(`Error: invalid file size: ${sizeBytes}`)
  }
  if (sizeBytes > limits.maxFileBytes) {
    const mb = Math.round((limits.maxFileBytes / (1024 * 1024)) * 100) / 100
    throw new Error(
      `Error: file size ${sizeBytes} bytes exceeds the ${mb} MiB limit. ` +
        `hashline edits operate on whole files; split the file or narrow your target.`
    )
  }
}

/** 将文件路径规范化为正斜杠形式，用于校验与展示。 */
export function normalizeDisplayPath(filePath: string): string {
  return filePath.replace(/\\/g, "/")
}
