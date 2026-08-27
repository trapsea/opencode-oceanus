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
  return typeof raw === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(raw) ? raw : undefined
}
export function updateManagedEntry(file: string, nextVersion: string): void {
  const original = readFileSync(file, "utf8")
  const value = parse(original)
  const found = entriesIn(value, file).find(e => e.managed)
  if (!found) throw new Error("配置入口缺少有效 installer marker")
  const replacement = typeof found.value === "string" ? JSON.stringify(`${PACKAGE_NAME}@${nextVersion}`) : `$1${JSON.stringify(nextVersion)}`
  const pattern = typeof found.value === "string" ? JSON.stringify(found.value) : `("version"\\s*:\\s*)"${String((found.value as any).version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`
  const updated = original.replace(new RegExp(pattern), replacement)
  if (updated === original) throw new Error("未找到可回写的配置入口")
  const tmp = `${file}.tmp-${process.pid}`; const bak = `${file}.bak`
  copyFileSync(file, bak); writeFileSync(tmp, updated); renameSync(tmp, file)
}
