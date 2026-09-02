import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ConfigEntry } from "./config-entry"

export type UpdateDecision = "update" | "latest" | "file" | "major" | "prerelease" | "current" | "skipped" | "error"
export function compareVersions(a: string, b: string): number {
  const x = a.split("-")[0].split(".").map(Number), y = b.split("-")[0].split(".").map(Number)
  for (let i=0;i<3;i++) if ((x[i]||0)!==(y[i]||0)) return (x[i]||0)-(y[i]||0)
  return a.includes("-") === b.includes("-") ? 0 : a.includes("-") ? -1 : 1
}
export function canUpdate(current: string, next: string): boolean { return !next.includes("-") && current.split(".")[0] === next.split(".")[0] && compareVersions(next, current) > 0 }
export function decide(current: string, next: string, entry?: ConfigEntry): UpdateDecision {
  if (entry && typeof entry.value === "string" && (entry.value === "@latest" || entry.value.endsWith("@latest"))) return "latest"
  if (entry && typeof entry.value === "string" && entry.value.startsWith("file:")) return "file"
  // 注意：OpenCode cache（sandbox）路径不再是拒绝理由——那正是自动更新应发布的 install root。
  if (next.includes("-")) return "prerelease"
  if (current.split(".")[0] !== next.split(".")[0]) return "major"
  return canUpdate(current, next) ? "update" : "current"
}
/**
 * registry 候选链：优先用户显式配置（NPM_CONFIG_REGISTRY），再官方源，最后国内镜像。
 * 修复：固定 npmjs.org + 5s 超时在受限网络下慢性 check_failed（fail-open 静默，
 * 用户只看到"没更新"）。Bun fetch 会读取 HTTP(S)_PROXY 环境变量，代理场景无需额外处理。
 */
export function registryCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = []
  const custom = env.NPM_CONFIG_REGISTRY ?? env.npm_config_registry
  if (custom) out.push(custom.replace(/\/+$/, ""))
  out.push("https://registry.npmjs.org", "https://registry.npmmirror.com")
  return [...new Set(out)]
}
export async function queryRegistry(packageName = "opencode-oceanus", timeoutMs = 5000, fetcher: typeof fetch = fetch, registries: string[] = registryCandidates()): Promise<string> {
  let lastError: unknown
  for (const registry of registries) {
    try {
      const signal = AbortSignal.timeout(timeoutMs)
      const response = await fetcher(`${registry}/${encodeURIComponent(packageName)}/latest`, { signal, headers: { accept: "application/json" } })
      if (!response.ok) throw new Error(`registry HTTP ${response.status}`)
      const data = await response.json() as any
      if (typeof data?.version !== "string") throw new Error("registry 返回无效版本")
      return data.version
    } catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
export function currentPackageVersion(packageFile = join(process.cwd(), "package.json")): string { return JSON.parse(readFileSync(packageFile, "utf8")).version }
