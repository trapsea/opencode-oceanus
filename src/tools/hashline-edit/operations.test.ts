import { describe, expect, test } from "bun:test"
import { formatHashLine } from "./hash"
import {
  applySetLine,
  applyReplaceLines,
  applyInsertAfter,
  applyInsertBefore,
  applyAppend,
  applyPrepend,
} from "./operations"
import { applyHashlineEdits, applyHashlineEditsWithReport } from "./edits"
import { normalizeHashlineEdits } from "./normalize"

const base = ["const a = 1", "const b = 2", "const c = 3"]
const ref = (line: number, content: string): string => formatHashLine(line, content)

describe("applySetLine 单行替换", () => {
  test("替换单行", () => {
    const out = applySetLine(base, ref(2, base[1]), "const b = 20")
    expect(out).toEqual(["const a = 1", "const b = 20", "const c = 3"])
  })

  test("hash 不一致抛错", () => {
    expect(() => applySetLine(base, ref(2, "different"), "x")).toThrow()
  })
})

describe("applyReplaceLines 范围替换", () => {
  test("替换连续多行", () => {
    const out = applyReplaceLines(base, ref(1, base[0]), ref(2, base[1]), ["const x = 0", "const y = 0"])
    expect(out).toEqual(["const x = 0", "const y = 0", "const c = 3"])
  })

  test("start 大于 end 抛错", () => {
    expect(() =>
      applyReplaceLines(base, ref(3, base[2]), ref(1, base[0]), "x")
    ).toThrow(/cannot be greater/)
  })
})

describe("applyInsertAfter / applyInsertBefore 锚点插入", () => {
  test("在锚点行后追加", () => {
    const out = applyInsertAfter(base, ref(1, base[0]), ["const extra = 9"])
    expect(out).toEqual(["const a = 1", "const extra = 9", "const b = 2", "const c = 3"])
  })

  test("在锚点行前前置", () => {
    const out = applyInsertBefore(base, ref(3, base[2]), "const before = 8")
    expect(out).toEqual(["const a = 1", "const b = 2", "const before = 8", "const c = 3"])
  })

  test("去掉锚点行回显", () => {
    const out = applyInsertAfter(base, ref(1, base[0]), [base[0], "const extra = 9"])
    expect(out).toEqual(["const a = 1", "const extra = 9", "const b = 2", "const c = 3"])
  })
})

describe("applyAppend / applyPrepend 文件级", () => {
  test("追加到末尾", () => {
    expect(applyAppend(base, "const d = 4")).toEqual([...base, "const d = 4"])
  })

  test("前置到开头", () => {
    expect(applyPrepend(base, "const z = 0")).toEqual(["const z = 0", ...base])
  })

  test("空文件追加仅返回新内容", () => {
    expect(applyAppend([""], "line1")).toEqual(["line1"])
  })
})

describe("applyHashlineEdits 批量应用", () => {
  test("replace + append + prepend 组合", () => {
    const edits = normalizeHashlineEdits([
      { op: "replace", pos: ref(2, base[1]), lines: "const b = 20" },
      { op: "append", pos: ref(3, base[2]), lines: "const after_c = 4" },
      { op: "prepend", pos: ref(1, base[0]), lines: "const before_a = 0" },
    ])
    const out = applyHashlineEditsWithReport(base.join("\n"), edits)
    expect(out.content.split("\n")).toEqual([
      "const before_a = 0",
      "const a = 1",
      "const b = 20",
      "const c = 3",
      "const after_c = 4",
    ])
  })

  test("重叠范围替换报错", () => {
    const edits = normalizeHashlineEdits([
      { op: "replace", pos: ref(1, base[0]), end: ref(2, base[1]), lines: "x" },
      { op: "replace", pos: ref(2, base[1]), end: ref(3, base[2]), lines: "y" },
    ])
    expect(() => applyHashlineEdits(base.join("\n"), edits)).toThrow(/Overlapping range/)
  })

  test("重复编辑去重", () => {
    const edits = normalizeHashlineEdits([
      { op: "replace", pos: ref(2, base[1]), lines: "const b = 20" },
      { op: "replace", pos: ref(2, base[1]), lines: "const b = 20" },
    ])
    const report = applyHashlineEditsWithReport(base.join("\n"), edits)
    expect(report.deduplicatedEdits).toBe(1)
    expect(report.content.split("\n")[1]).toBe("const b = 20")
  })

  test("no-op 编辑计数", () => {
    const edits = normalizeHashlineEdits([
      { op: "replace", pos: ref(2, base[1]), lines: base[1] },
    ])
    const report = applyHashlineEditsWithReport(base.join("\n"), edits)
    expect(report.noopEdits).toBe(1)
    expect(report.content).toBe(base.join("\n"))
  })
})
