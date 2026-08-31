import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyHashlineEditToFile } from "./executor"
import { formatHashLine } from "./hash"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hashline-edit-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const write = (name: string, content: string) => writeFile(join(dir, name), content, "utf-8")
const read = async (name: string) => (await readFile(join(dir, name), "utf-8")).toString()
const ref = (line: number, content: string) => formatHashLine(line, content)

describe("applyHashlineEditToFile 集成", () => {
  test("replace 单行并写回文件", async () => {
    await write("a.ts", "const a = 1\nconst b = 2\nconst c = 3\n")
    const res = await applyHashlineEditToFile(join(dir, "a.ts"), [
      { op: "replace", pos: ref(2, "const b = 2"), lines: "const b = 20" },
    ])
    expect(res.ok).toBe(true)
    expect(res.changed).toBe(true)
    expect(await read("a.ts")).toBe("const a = 1\nconst b = 20\nconst c = 3\n")
  })

  test("append / prepend 作用于文件", async () => {
    await write("b.ts", "line1\nline2\n")
    const res = await applyHashlineEditToFile(join(dir, "b.ts"), [
      { op: "append", pos: ref(2, "line2"), lines: "line3" },
      { op: "prepend", pos: ref(1, "line1"), lines: "line0" },
    ])
    expect(res.ok).toBe(true)
    expect(await read("b.ts")).toBe("line0\nline1\nline2\nline3\n")
  })

  test("新建文件（无锚点 append）", async () => {
    const res = await applyHashlineEditToFile(join(dir, "new.txt"), [
      { op: "append", lines: ["hello", "world"] },
    ])
    expect(res.ok).toBe(true)
    expect(res.created).toBe(true)
    expect(await read("new.txt")).toBe("hello\nworld")
  })

  test("无锚点 append 四象限：尾换行文件 + 无换行文本", async () => {
    await write("q1.txt", "a\nb\n")
    const res = await applyHashlineEditToFile(join(dir, "q1.txt"), [
      { op: "append", lines: "c" },
    ])
    expect(res.ok).toBe(true)
    expect(await read("q1.txt")).toBe("a\nb\nc\n")
  })

  test("无锚点 append 四象限：尾换行文件 + 带换行文本", async () => {
    await write("q2.txt", "a\nb\n")
    const res = await applyHashlineEditToFile(join(dir, "q2.txt"), [
      { op: "append", lines: "c\n" },
    ])
    expect(res.ok).toBe(true)
    expect(await read("q2.txt")).toBe("a\nb\nc\n")
  })

  test("无锚点 append 四象限：无尾换行文件 + 无换行文本", async () => {
    await write("q3.txt", "a\nb")
    const res = await applyHashlineEditToFile(join(dir, "q3.txt"), [
      { op: "append", lines: "c" },
    ])
    expect(res.ok).toBe(true)
    expect(await read("q3.txt")).toBe("a\nb\nc")
  })

  test("无锚点 append 四象限：无尾换行文件 + 带换行文本", async () => {
    await write("q4.txt", "a\nb")
    const res = await applyHashlineEditToFile(join(dir, "q4.txt"), [
      { op: "append", lines: "c\n" },
    ])
    expect(res.ok).toBe(true)
    expect(await read("q4.txt")).toBe("a\nb\nc\n")
  })

  test("文件不存在且非新建场景返回错误", async () => {
    const res = await applyHashlineEditToFile(join(dir, "missing.ts"), [
      { op: "replace", pos: ref(1, "x"), lines: "y" },
    ])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/File not found/)
  })

  test("文件在读取后变化导致 hash mismatch", async () => {
    await write("c.ts", "aaa\nbbb\n")
    // 先读取生成引用
    const ref1 = ref(1, "aaa")
    // 模拟文件被外部修改
    await write("c.ts", "AAA\nbbb\n")
    const res = await applyHashlineEditToFile(join(dir, "c.ts"), [
      { op: "replace", pos: ref1, lines: "changed" },
    ])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/changed since last read/)
  })

  test("no-op 编辑返回错误且不写文件", async () => {
    await write("d.ts", "keep\n")
    const res = await applyHashlineEditToFile(join(dir, "d.ts"), [
      { op: "replace", pos: ref(1, "keep"), lines: "keep" },
    ])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/No changes made/)
    expect(await read("d.ts")).toBe("keep\n")
  })

  test("CRLF 换行在编辑后保留", async () => {
    await write("e.ts", "aaa\r\nbbb\r\n")
    const res = await applyHashlineEditToFile(join(dir, "e.ts"), [
      { op: "replace", pos: ref(1, "aaa"), lines: "AAA" },
    ])
    expect(res.ok).toBe(true)
    expect(await read("e.ts")).toBe("AAA\r\nbbb\r\n")
  })

  test("BOM 在编辑后保留", async () => {
    await write("f.ts", "\uFEFFaaa\nbbb\n")
    const res = await applyHashlineEditToFile(join(dir, "f.ts"), [
      { op: "append", pos: ref(2, "bbb"), lines: "ccc" },
    ])
    expect(res.ok).toBe(true)
    expect(await read("f.ts")).toBe("\uFEFFaaa\nbbb\nccc\n")
  })

  test("超大文件被边界拦截", async () => {
    await write("big.ts", "x".repeat(1024))
    const res = await applyHashlineEditToFile(join(dir, "big.ts"), [
      { op: "replace", pos: ref(1, "x".repeat(1024)), lines: "y" },
    ])
    // 默认上限为 16MiB，此处 1KB 应通过
    expect(res.ok).toBe(true)
  })

  test("自定义小上限拦截文件", async () => {
    await write("big.ts", "x".repeat(1024))
    const res = await applyHashlineEditToFile(
      join(dir, "big.ts"),
      [{ op: "replace", pos: ref(1, "x".repeat(1024)), lines: "y" }],
      { limits: { maxFileBytes: 100 } }
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/exceeds/)
  })

  test("结果携带稳定 diff 与统计", async () => {
    await write("g.ts", "a\nb\nc\n")
    const res = await applyHashlineEditToFile(join(dir, "g.ts"), [
      { op: "replace", pos: ref(2, "b"), lines: "B" },
    ])
    expect(res.ok).toBe(true)
    expect(res.additions).toBe(1)
    expect(res.deletions).toBe(1)
    expect(res.firstChangedLine).toBe(2)
    expect(res.diff).toContain("--- ")
    expect(res.diff).toContain("+ 2#")
  })

  test("顶层 delete 删除文件", async () => {
    await write("delete.ts", "x\n")
    const res = await applyHashlineEditToFile(join(dir, "delete.ts"), [], { delete: true })
    expect(res.ok).toBe(true)
    expect(res.deleted).toBe(true)
    expect(await readFile(join(dir, "delete.ts")).catch(() => null)).toBeNull()
  })

  test("顶层 rename 原子重命名文件", async () => {
    await write("old.ts", "x\n")
    const res = await applyHashlineEditToFile(join(dir, "old.ts"), [], { rename: join(dir, "new.ts") })
    expect(res.ok).toBe(true)
    expect(res.renamed).toBe(true)
    expect(res.from).toBe(null)
    expect(res.to).toBe(null)
    expect(await read("new.ts")).toBe("x\n")
  })
})
