import { describe, expect, test } from "bun:test"
import {
  parseLineRef,
  validateLineRef,
  validateLineRefs,
  normalizeLineRef,
  HashlineMismatchError,
} from "./refs"
import { computeLegacyLineHash, formatHashLine } from "./hash"

describe("parseLineRef 范围锚点解析", () => {
  test("标准格式 {line}#{hash}", () => {
    const ref = parseLineRef("12#QW")
    expect(ref).toEqual({ line: 12, hash: "QW" })
  })

  test("容忍 >>> / + / - 前缀", () => {
    expect(parseLineRef(">>> 3#XY")).toEqual({ line: 3, hash: "XY" })
    expect(parseLineRef("+ 5#QS").line).toBe(5)
    expect(parseLineRef("- 5#QS").line).toBe(5)
  })

  test("容忍 # 周围空白", () => {
    expect(parseLineRef(" 8 # QK ").line).toBe(8)
  })

  test("从 hashline 输出行截取引用（忽略 | 内容）", () => {
    expect(parseLineRef("2#ZZ|const b = 2").line).toBe(2)
  })

  test("从完整 diff 行提取 N#XX 片段", () => {
    const out = formatHashLine(4, "return x")
    const line = `+ ${out}`
    expect(parseLineRef(line).line).toBe(4)
  })

  test("非法格式抛错", () => {
    expect(() => parseLineRef("abc")).toThrow(/Invalid line reference/)
    expect(() => parseLineRef("notanumber#QW")).toThrow(/not a line number/)
  })

  test("hash 必须是合法字符集", () => {
    expect(() => parseLineRef("5#11")).toThrow()
  })
})

describe("normalizeLineRef", () => {
  test("归一化输出为标准 N#XX", () => {
    expect(normalizeLineRef(">>> 3 # QK | content")).toBe("3#QK")
  })

  test("无法识别时返回原串", () => {
    expect(normalizeLineRef("hello")).toBe("hello")
  })
})

describe("validateLineRef 与 hash mismatch", () => {
  const lines = ["const a = 1", "const b = 2", "const c = 3"]

  test("hash 一致时通过", () => {
    const goodRef = formatHashLine(1, lines[0])
    expect(() => validateLineRef(lines, goodRef)).not.toThrow()
  })

  test("行号越界抛错", () => {
    const ref = formatHashLine(99, "x")
    expect(() => validateLineRef(lines, ref)).toThrow(/out of bounds/)
  })

  test("hash 不一致抛出 HashlineMismatchError", () => {
    const ref = formatHashLine(1, "entirely different content")
    expect(() => validateLineRef(lines, ref)).toThrow(HashlineMismatchError)
  })

  test("mismatch 错误附带更新的行引用 remaps", () => {
    const ref = formatHashLine(1, "entirely different content")
    const refKey = ref.split("|")[0]
    try {
      validateLineRef(lines, ref)
    } catch (e) {
      const err = e as HashlineMismatchError
      expect(err.remaps.size).toBe(1)
      const actual = err.remaps.get(refKey)
      expect(actual).toBe(formatHashLine(1, lines[0]).split("|")[0])
    }
  })

  test("兼容旧 hash（去全部空白）", () => {
    const lines2 = ["const  a = 1"]
    const legacyHash = computeLegacyLineHash(1, lines2[0])
    expect(() => validateLineRef(lines2, `1#${legacyHash}`)).not.toThrow()
  })
})

describe("validateLineRefs 批量校验", () => {
  const lines = ["a", "b", "c", "d"]

  test("全部一致通过", () => {
    const refs = lines.map((line, i) => formatHashLine(i + 1, line))
    expect(() => validateLineRefs(lines, refs)).not.toThrow()
  })

  test("多个 mismatch 汇总为一个错误", () => {
    const refs = [formatHashLine(1, "changed"), formatHashLine(2, "changed too")]
    try {
      validateLineRefs(lines, refs)
    } catch (e) {
      const err = e as HashlineMismatchError
      expect(err.message).toMatch(/2 lines have changed/)
    }
  })
})
