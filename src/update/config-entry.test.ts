import { describe, expect, test } from "bun:test"
import { discoverConfigEntries, findConfigFiles, updateManagedEntry } from "./config-entry"
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
    updateManagedEntry(file, "1.1.0")
    const text = readFileSync(file, "utf8")
    expect(text).toContain("opencode-oceanus@1.1.0")
    const objectFile = join(root, "object.jsonc")
    writeFileSync(objectFile, '{"plugins":[{"package":"opencode-oceanus","version":"1.0.0","__oceanusManagedByInstaller":true}]}')
    updateManagedEntry(objectFile, "1.1.0")
    expect(readFileSync(objectFile, "utf8")).toMatch(/"version"\s*:\s*"1\.1\.0"/)
    expect(findConfigFiles(home, root)[0]).toBe(join(root, ".opencode", "opencode.jsonc"))
  })
})
