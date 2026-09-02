import { describe, expect, test } from "bun:test"
import { discoverConfigEntries, findConfigFiles, syncEntryVersion } from "./config-entry"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("config entries", () => {
  test("项目 .opencode 优先，支持 JSONC、BOM、字符串和对象", () => {
    const root = mkdtempSync(join(tmpdir(), "oceanus-")), home = mkdtempSync(join(tmpdir(), "oceanus-home-"))
    mkdirSync(join(root, ".opencode"))
    writeFileSync(join(root, ".opencode", "opencode.jsonc"), "{}")
    mkdirSync(join(home, ".config/opencode"), { recursive: true })
    writeFileSync(join(home, ".config/opencode/opencode.json"), "{}")
    // 使用显式文件列表验证解析；搜索顺序单独验证候选顺序。
    const file = join(root, "config.jsonc")
    writeFileSync(file, '\uFEFF{ // c\n "__oceanusManagedByInstaller": true, "plugins": ["opencode-oceanus@1.0.0", {"package":"opencode-oceanus", "version":"1.0.0",}],\n}')
    const entries = discoverConfigEntries([file])
    expect(entries).toHaveLength(2)
    expect(findConfigFiles(home, root)[0]).toBe(join(root, ".opencode", "opencode.jsonc"))
  })

  test("固定版本入口（无 installer marker）也能同步回写：字符串与对象形态", () => {
    const root = mkdtempSync(join(tmpdir(), "oceanus-sync-"))
    const file = join(root, "pinned.jsonc")
    writeFileSync(file, '{"plugins":["opencode-oceanus@1.0.0"]}')
    syncEntryVersion(file, "1.1.0")
    expect(readFileSync(file, "utf8")).toContain('"opencode-oceanus@1.1.0"')
    const objectFile = join(root, "object.jsonc")
    writeFileSync(objectFile, '{"plugins":[{"package":"opencode-oceanus","version":"1.0.0"}]}')
    syncEntryVersion(objectFile, "1.1.0")
    expect(readFileSync(objectFile, "utf8")).toMatch(/"version"\s*:\s*"1\.1\.0"/)
  })

  test("对象形态只改本入口窗口内的 version，不误伤其它插件的同值字段", () => {
    const root = mkdtempSync(join(tmpdir(), "oceanus-scope-"))
    const file = join(root, "mixed.json")
    // 另一个插件先出现且 version 同值——旧实现会盲改全文件第一处命中。
    writeFileSync(file, '{"plugins":[{"package":"other-plugin","version":"1.0.0"},{"package":"opencode-oceanus","version":"1.0.0"}]}')
    syncEntryVersion(file, "1.2.0")
    const text = readFileSync(file, "utf8")
    expect(text).toContain('"package":"other-plugin","version":"1.0.0"')
    expect(text).toContain('"package":"opencode-oceanus","version":"1.2.0"')
  })

  test("裸入口无版本可写：no-op 不抛错也不改文件", () => {
    const root = mkdtempSync(join(tmpdir(), "oceanus-bare-"))
    const file = join(root, "bare.json")
    const original = '{"plugins":["opencode-oceanus"]}'
    writeFileSync(file, original)
    syncEntryVersion(file, "1.1.0")
    expect(readFileSync(file, "utf8")).toBe(original)
  })
})
