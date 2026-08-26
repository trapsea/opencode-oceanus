import { describe, expect, test } from "bun:test"
import { computeLineHash, computeLegacyLineHash, formatHashLine, formatHashLines } from "./hash"
import { hashXxh32 } from "./xxhash32"

describe("hashXxh32", () => {
  test("输出为 32 位无符号整数", () => {
    expect(hashXxh32("hello world", 0)).toBeGreaterThanOrEqual(0)
    expect(hashXxh32("hello world", 0)).toBeLessThanOrEqual(0xffffffff)
  })

  test("同一输入同一 seed 结果稳定", () => {
    expect(hashXxh32("foo bar", 42)).toBe(hashXxh32("foo bar", 42))
  })

  test("不同输入通常产生不同 hash", () => {
    expect(hashXxh32("foo", 0)).not.toBe(hashXxh32("bar", 0))
  })

  test("不同 seed 产生不同结果", () => {
    expect(hashXxh32("foo", 1)).not.toBe(hashXxh32("foo", 2))
  })
})

describe("computeLineHash 稳定性", () => {
  test("同一行内容在同一位置 hash 稳定", () => {
    expect(computeLineHash(3, "const a = 1")).toBe(computeLineHash(3, "const a = 1"))
  })

  test("有意义行的 hash 与行号无关（位置无关指纹）", () => {
    // 含字母数字的行以 seed=0 计算，行号变化不应改变 hash。
    const content = "export function run() {"
    expect(computeLineHash(1, content)).toBe(computeLineHash(99, content))
  })

  test("行尾空白与 \\r 不改变 hash", () => {
    expect(computeLineHash(1, "hello")).toBe(computeLineHash(1, "hello   "))
    expect(computeLineHash(1, "hello")).toBe(computeLineHash(1, "hello\r"))
  })

  test("空白行 hash 确定可复现", () => {
    expect(computeLineHash(1, "")).toBe(computeLineHash(1, ""))
    expect(computeLineHash(1, "")).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/)
  })

  test("空白行 hash 随行号变化（seed=行号，抽样不全部相同）", () => {
    // 空白行以行号为 seed；虽存在 1/256 碰撞可能，但 40 个样本应出现多值。
    const hashes = new Set<string>()
    for (let line = 1; line <= 40; line++) {
      hashes.add(computeLineHash(line, ""))
    }
    expect(hashes.size).toBeGreaterThan(1)
  })

  test("仅空白行 hash 确定", () => {
    expect(computeLineHash(1, "   ")).toBe(computeLineHash(1, "   "))
    expect(computeLineHash(3, "\t")).toBe(computeLineHash(3, "\t"))
  })
})

describe("computeLegacyLineHash", () => {
  test("去掉全部空白后计算，兼容旧引用", () => {
    expect(computeLegacyLineHash(1, "a  b  c")).toBe(computeLegacyLineHash(1, "abc"))
  })
})

describe("formatHashLine", () => {
  test("格式为 {line}#{hash}|{content}", () => {
    const line = "const x = 1"
    const hash = computeLineHash(1, line)
    expect(formatHashLine(1, line)).toBe(`1#${hash}|${line}`)
  })

  test("hash 为两字符，来自 HASHLINE_DICT 字符集", () => {
    const out = formatHashLine(1, "foo")
    const match = out.match(/^1#([A-Z]{2})\|/)
    expect(match).toBeTruthy()
  })
})

describe("formatHashLines", () => {
  test("每行带行号", () => {
    const out = formatHashLines("a\nb\nc")
    const lines = out.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^1#/)
    expect(lines[1]).toMatch(/^2#/)
    expect(lines[2]).toMatch(/^3#/)
  })

  test("空内容返回空串", () => {
    expect(formatHashLines("")).toBe("")
  })
})
