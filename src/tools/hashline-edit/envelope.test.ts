import { describe, expect, test } from "bun:test"
import { canonicalizeFileText, restoreFileText } from "./envelope"
import type { FileTextEnvelope } from "./envelope"

describe("canonicalizeFileText / restoreFileText 换行保留", () => {
  test("LF 文件保持 LF", () => {
    const env = canonicalizeFileText("a\nb\nc")
    expect(env.lineEnding).toBe("\n")
    expect(env.hadBom).toBe(false)
    expect(restoreFileText(env.content, env)).toBe("a\nb\nc")
  })

  test("CRLF 文件规范化后恢复 CRLF", () => {
    const env = canonicalizeFileText("a\r\nb\r\nc")
    expect(env.lineEnding).toBe("\r\n")
    expect(env.content).toBe("a\nb\nc")
    expect(restoreFileText("a\nb\nc", env)).toBe("a\r\nb\r\nc")
  })

  test("BOM 被剥离并恢复", () => {
    const env = canonicalizeFileText("\uFEFFa\nb")
    expect(env.hadBom).toBe(true)
    expect(env.content).toBe("a\nb")
    expect(restoreFileText("a\nb", env)).toBe("\uFEFFa\nb")
  })

  test("CRLF + BOM 组合保留", () => {
    const env = canonicalizeFileText("\uFEFFa\r\nb\r\n")
    expect(env.hadBom).toBe(true)
    expect(env.lineEnding).toBe("\r\n")
    const restored = restoreFileText(env.content, env)
    expect(restored).toBe("\uFEFFa\r\nb\r\n")
  })

  test("结尾换行保留", () => {
    const env = canonicalizeFileText("a\nb\n")
    expect(env.content).toBe("a\nb\n")
  })

  test("空内容", () => {
    const env = canonicalizeFileText("")
    expect(env.content).toBe("")
    expect(env.lineEnding).toBe("\n")
    expect(restoreFileText("", env)).toBe("")
  })

  test("检测结果类型正确", () => {
    const env: FileTextEnvelope = canonicalizeFileText("a\nb")
    expect(env.lineEnding === "\n" || env.lineEnding === "\r\n").toBe(true)
  })
})
