import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const PACKAGE_NAME = "opencode-oceanus"
export const INSTALLER_MARKER = "__oceanusManagedByInstaller"

export type ConfigEntry = { file: string; path: string; value: string | Record<string, unknown>; kind: "string" | "object"; managed: boolean }

function parse(text: string): any {
  // 只在字符串之外移除 JSONC 注释；这样 URL、正则样式及注释内容都不会误伤。
  text = text.replace(/^\uFEFF/, "")
  let clean = "", quote = false, escaped = false, line = false, block = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1]
    if (line) { if (c === "\n" || c === "\r") { line = false; clean += c } else clean += " " ; continue }
    if (block) { if (c === "*" && n === "/") { block = false; clean += "  "; i++ } else clean += c === "\n" || c === "\r" ? c : " "; continue }
    if (quote) { clean += c; if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quote = false; continue }
    if (c === '"') { quote = true; clean += c; continue }
    if (c === "/" && n === "/") { line = true; clean += "  "; i++; continue }
    if (c === "/" && n === "*") { block = true; clean += "  "; i++; continue }
    clean += c
  }
  return JSON.parse(clean.replace(/,\s*([}\]])/g, "$1"))
}
function entriesIn(value: any, file: string, path: string[] = []): ConfigEntry[] {
  if (!value || typeof value !== "object") return []
  const plugins = value.plugins
  if (!Array.isArray(plugins)) return []
  return plugins.flatMap((item: any, i: number): ConfigEntry[] => {
    const p = [...path, "plugins", String(i)]
    if (typeof item === "string" && (item === PACKAGE_NAME || item.startsWith(`${PACKAGE_NAME}@`) || item.startsWith("file:")))
      return [{ file, path: p.join("."), value: item, kind: "string", managed: value[INSTALLER_MARKER] === true }]
    if (item && typeof item === "object" && typeof item.package === "string" && (item.package === PACKAGE_NAME || item.package.startsWith(`${PACKAGE_NAME}@`) || item.package.startsWith("file:")))
      return [{ file, path: p.join("."), value: item, kind: "object", managed: item[INSTALLER_MARKER] === true }]
    return []
  })
}

export function findConfigFiles(home = process.env.HOME ?? "", cwd = process.cwd()): string[] {
  const candidates: string[] = []
  for (let dir = cwd;;) {
    candidates.push(join(dir, ".opencode", "opencode.json"), join(dir, ".opencode", "opencode.jsonc"))
    const parent = dirname(dir); if (parent === dir) break; dir = parent
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config")
  candidates.push(join(xdg, "opencode", "opencode.json"), join(xdg, "opencode", "opencode.jsonc"))
  return candidates.filter(existsSync)
}
export function discoverConfigEntries(files = findConfigFiles()): ConfigEntry[] {
  return files.flatMap(file => { try { return entriesIn(parse(readFileSync(file, "utf8")), file) } catch { return [] } })
}
export const findConfigEntries = discoverConfigEntries

export function isSandboxPath(path: string): boolean { return path.includes("/.cache/opencode/packages/") || path.includes("\\opencode\\packages\\") }
export function entryVersion(entry: ConfigEntry): string | undefined {
  const raw = typeof entry.value === "string" ? entry.value : entry.value.version
  if (typeof raw !== "string") return undefined
  // 字符串形态支持 "opencode-oceanus@1.2.3"；对象形态直接读取 version 字段。
  const candidate = typeof entry.value === "string" ? raw.slice(raw.lastIndexOf("@") + 1) : raw
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(candidate) ? candidate : undefined
}

/**
 * 把配置文件中固定版本的 oceanus 入口同步到新版本（安装成功后调用）。
 *
 * 与旧 updateManagedEntry 的差异（修复 pinned 入口永不更新 + 非作用域替换两个缺陷）：
 * - 不再要求 INSTALLER_MARKER：生产链路没有任何代码写入该标记，导致所有固定版本
 *   入口被自动更新永久跳过。新策略：固定版本入口同样更新，安装成功后同步回写，
 *   使配置与磁盘保持一致；用户不希望自动更新时用插件配置 autoUpdate.enabled=false 关闭。
 * - 替换按入口作用域进行：字符串形态做精确全文串替换（同值多条全部同步）；
 *   对象形态只在 package 键匹配的窗口内改 version 字段，不再盲改全文件第一处。
 */
export function syncEntryVersion(file: string, nextVersion: string, only?: ConfigEntry): void {
  const original = readFileSync(file, "utf8")
  let updated = original
  const targets = discoverConfigEntries([file]).filter(e => entryVersion(e) !== undefined && (!only || (e.file === only.file && e.path === only.path)))
  for (const entry of targets) {
    if (entry.kind === "string") {
      const from = JSON.stringify(String(entry.value)), to = JSON.stringify(`${PACKAGE_NAME}@${nextVersion}`)
      updated = updated.split(from).join(to)
    } else {
      // 定位该入口对象的 package 键，窗口 = 从该键到下一个 package 键（或有限长度），
      // 只在窗口内替换 version 字段，避免误改其它插件的同值 version。
      const pkgKey = /"package"\s*:\s*"opencode-oceanus(?:@[^"]*)?"/g
      const windows: Array<[number, number]> = []
      const positions: number[] = []
      for (const m of updated.matchAll(pkgKey)) positions.push(m.index ?? 0)
      for (let i = 0; i < positions.length; i++) {
        const start = positions[i]!
        const end = i + 1 < positions.length ? positions[i + 1]! : start + 800
        windows.push([start, end])
      }
      const versionPattern = /("version"\s*:\s*")(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(")/g
      updated = updated.replace(versionPattern, (match, head, ver, tail, offset: number) => {
        if (!windows.some(([s, e]) => offset >= s && offset < e)) return match
        return ver === nextVersion ? match : `${head}${nextVersion}${tail}`
      })
    }
  }
  if (updated === original) return
  const tmp = `${file}.tmp-${process.pid}`; const bak = `${file}.bak`
  copyFileSync(file, bak); writeFileSync(tmp, updated); renameSync(tmp, file)
}
