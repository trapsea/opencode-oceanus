import { describe, expect, test } from "bun:test"
import {
  validateFilePath,
  validateFileSize,
  normalizeDisplayPath,
  DEFAULT_BOUNDARY_LIMITS,
} from "./boundaries"

describe("validateFilePath 路径边界", () => {
  test("非空字符串通过", () => {
    expect(() => validateFilePath("src/index.ts")).not.toThrow()
  })

  test("空字符串抛错", () => {
    expect(() => validateFilePath("")).toThrow(/non-empty/)
    expect(() => validateFilePath("   ")).toThrow(/non-empty/)
  })

  test("控制字符抛错", () => {
    expect(() => validateFilePath("a\u0000b")).toThrow(/illegal control/)
    expect(() => validateFilePath("a\nb")).toThrow(/illegal control/)
  })
})

describe("validateFileSize 大小边界", () => {
  test("正常大小通过", () => {
    expect(() => validateFileSize(1024)).not.toThrow()
  })

  test("负大小抛错", () => {
    expect(() => validateFileSize(-1)).toThrow(/invalid file size/)
  })

  test("超过上限抛错", () => {
    const over = DEFAULT_BOUNDARY_LIMITS.maxFileBytes + 1
    expect(() => validateFileSize(over)).toThrow(/exceeds/)
  })

  test("正好等于上限通过", () => {
    expect(() => validateFileSize(DEFAULT_BOUNDARY_LIMITS.maxFileBytes)).not.toThrow()
  })

  test("自定义上限生效", () => {
    expect(() => validateFileSize(10, { maxFileBytes: 5 })).toThrow(/exceeds/)
  })
})

describe("normalizeDisplayPath", () => {
  test("反斜杠转正斜杠", () => {
    expect(normalizeDisplayPath("a\\b\\c.ts")).toBe("a/b/c.ts")
  })
})
