import { describe, expect, test } from "bun:test"
import {
  generateHashlineDiff,
  generateUnifiedDiff,
  countLineDiffs,
  toHashlineContent,
} from "./diff"

describe("generateHashlineDiff 稳定 diff", () => {
  test("无变化输出仅文件头", () => {
    const out = generateHashlineDiff("a\nb", "a\nb", "f.ts")
    expect(out).toContain("--- f.ts")
    expect(out).toContain("+++ f.ts")
    expect(out).not.toMatch(/^[+-] \d/m)
  })

  test("单行变化输出 - / + 行", () => {
    const out = generateHashlineDiff("a\nb\nc", "a\nB\nc", "f.ts")
    expect(out).toMatch(/- 2#  \|b/)
    expect(out).toMatch(/\+ 2#[A-Z]{2}\|B/)
  })

  test("追加行输出 + 行", () => {
    const out = generateHashlineDiff("a", "a\nb", "f.ts")
    expect(out).toMatch(/\+ 2#[A-Z]{2}\|b/)
  })

  test("删除行输出 - 行", () => {
    const out = generateHashlineDiff("a\nb", "a", "f.ts")
    expect(out).toMatch(/- 2#  \|b/)
  })

  test("确定可复现", () => {
    const a = generateHashlineDiff("x\ny\nz", "x\nY\nz\nw", "f.ts")
    const b = generateHashlineDiff("x\ny\nz", "x\nY\nz\nw", "f.ts")
    expect(a).toBe(b)
  })
})

describe("generateUnifiedDiff LCS diff", () => {
  test("无变化时只有文件头", () => {
    expect(generateUnifiedDiff("a\nb", "a\nb", "f.ts")).toBe("--- f.ts\n+++ f.ts")
  })

  test("单行修改生成含 +/- 的 hunk", () => {
    const out = generateUnifiedDiff("const a = 1\nconst b = 2\nconst c = 3", "const a = 1\nconst b = 20\nconst c = 3", "f.ts")
    expect(out).toContain("@@")
    expect(out).toContain("-const b = 2")
    expect(out).toContain("+const b = 20")
    expect(out).toContain(" const a = 1")
  })

  test("插入/删除与增删统计一致", () => {
    const out = generateUnifiedDiff("a\nb\nc", "a\nx\nb\nc", "f.ts")
    expect(out).toContain("+x")
    const { additions, deletions } = countLineDiffs("a\nb\nc", "a\nx\nb\nc")
    expect(additions).toBe(1)
    expect(deletions).toBe(0)
  })

  test("跨多行变化聚合为一个 change 段", () => {
    const out = generateUnifiedDiff("1\n2\n3\n4", "1\nX\nY\n4", "f.ts")
    expect(out).toContain("-2")
    expect(out).toContain("-3")
    expect(out).toContain("+X")
    expect(out).toContain("+Y")
  })
})

describe("countLineDiffs", () => {
  test("统计新增与删除", () => {
    expect(countLineDiffs("a\nb\nb", "a\nb\nc\nc")).toEqual({ additions: 2, deletions: 1 })
  })

  test("无变化", () => {
    expect(countLineDiffs("a\nb", "a\nb")).toEqual({ additions: 0, deletions: 0 })
  })
})

describe("toHashlineContent", () => {
  test("每行带 hashline 前缀", () => {
    const out = toHashlineContent("a\nb\nc")
    expect(out.split("\n")).toHaveLength(3)
    expect(out.split("\n")[0]).toMatch(/^1#[A-Z]{2}\|a$/)
  })

  test("保留结尾换行", () => {
    const out = toHashlineContent("a\nb\n")
    expect(out.endsWith("\n")).toBe(true)
  })
})
