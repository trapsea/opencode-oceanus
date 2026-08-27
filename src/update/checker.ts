import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isSandboxPath, entryVersion, type ConfigEntry } from "./config-entry"

export type UpdateDecision = "update" | "latest" | "file" | "sandbox" | "major" | "prerelease" | "current" | "skipped" | "error"
export function compareVersions(a: string, b: string): number {
  const x = a.split("-")[0].split(".").map(Number), y = b.split("-")[0].split(".").map(Number)
  for (let i=0;i<3;i++) if ((x[i]||0)!==(y[i]||0)) return (x[i]||0)-(y[i]||0)
  return a.includes("-") === b.includes("-") ? 0 : a.includes("-") ? -1 : 1
}
export function canUpdate(current: string, next: string): boolean { return !next.includes("-") && current.split(".")[0] === next.split(".")[0] && compareVersions(next, current) > 0 }
export function decide(current: string, next: string, entry?: ConfigEntry): UpdateDecision {
  if (entry && typeof entry.value === "string" && (entry.value === "@latest" || entry.value.endsWith("@latest"))) return "latest"
  if (entry && typeof entry.value === "string" && entry.value.startsWith("file:")) return "file"
  if (entry && isSandboxPath(entry.file)) return "sandbox"
  if (next.includes("-")) return "prerelease"
  if (current.split(".")[0] !== next.split(".")[0]) return "major"
  return canUpdate(current, next) ? "update" : "current"
}
export async function queryRegistry(packageName = "opencode-oceanus", timeoutMs = 5000, fetcher: typeof fetch = fetch): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, { signal, headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`registry HTTP ${response.status}`)
  const data = await response.json() as any
  if (typeof data?.version !== "string") throw new Error("registry 返回无效版本")
  return data.version
}
export function currentPackageVersion(packageFile = join(process.cwd(), "package.json")): string { return JSON.parse(readFileSync(packageFile, "utf8")).version }
