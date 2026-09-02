import { describe, expect, test } from "bun:test";
import { presentHashlineSuccess } from "./present";
import { generateUnifiedDiff, generateHashlineDiff } from "./diff";
import type { HashlineFileResult } from "./executor";

function successBase(overrides: Partial<HashlineFileResult> = {}): HashlineFileResult {
  const before = "alpha\nbeta\n";
  const after = "alpha\nBETA\n";
  return {
    ok: true,
    path: "notes.txt",
    created: false,
    changed: true,
    before,
    after,
    diff: generateUnifiedDiff(before, after, "notes.txt"),
    hashlineDiff: generateHashlineDiff(before, after, "notes.txt"),
    additions: 1,
    deletions: 1,
    noopEdits: 0,
    deduplicatedEdits: 0,
    ...overrides,
  };
}

describe("presentHashlineSuccess", () => {
  test("编辑成功：头部摘要 + unified diff + hashlineDiff 三段", () => {
    const { text, metadata } = presentHashlineSuccess(successBase());
    expect(text.startsWith("Edited notes.txt (+1 -1)\n")).toBe(true);
    expect(text).toContain("--- notes.txt");
    expect(text).toContain("@@ ");
    expect(text).toContain("-beta");
    expect(text).toContain("+BETA");
    expect(text).toContain("hashlineDiff:");
    // 锚点段携带行 hash 前缀。
    expect(text).toContain("#");
    // metadata 与宿主 edit 渲染器的 filediff 约定对齐。
    const filediff = metadata.filediff as { file: string; patch: string };
    expect(filediff.file).toBe("notes.txt");
    expect(filediff.patch).toContain("@@ ");
    expect(metadata.additions).toBe(1);
    expect(metadata.deletions).toBe(1);
  });

  test("新建文件：头部为 Created", () => {
    const { text, metadata } = presentHashlineSuccess(
      successBase({ created: true, before: "", after: "line1\n", additions: 1, deletions: 0 }),
    );
    expect(text.startsWith("Created notes.txt (+1 -0)\n")).toBe(true);
    expect(metadata.created).toBe(true);
    expect(metadata.filediff).toBeDefined();
  });

  test("delete / rename：无 diff 段，头部描述操作", () => {
    const del = presentHashlineSuccess(successBase({ diff: "", hashlineDiff: "", deleted: true, from: "notes.txt" }));
    expect(del.text).toBe("Deleted notes.txt");
    expect(del.metadata.deleted).toBe(true);
    expect(del.metadata.filediff).toBeUndefined();

    const ren = presentHashlineSuccess(
      successBase({ diff: "", hashlineDiff: "", renamed: true, from: "a.txt", to: "b.txt" }),
    );
    expect(ren.text).toBe("Renamed a.txt -> b.txt");
    expect(ren.metadata.renamed).toBe(true);
    expect(ren.metadata.to).toBe("b.txt");
  });

  test("path 为 null 时头部回退占位符", () => {
    const { text } = presentHashlineSuccess(successBase({ path: null, deleted: true, from: null }));
    expect(text).toContain("(unknown path)");
  });
});
