import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { getCacheRoot as defaultCacheRoot } from "../cbm/paths"
import { getAutoUpdateConfig } from "../config/utils"
import { discoverConfigEntries, type ConfigEntry } from "./config-entry"
import { decide, queryRegistry, type UpdateDecision } from "./checker"

export interface UpdateStorage {
  read?(path: string): string | Promise<string | null> | null
  write?(path: string, value: string): void | Promise<void>
}
export interface AutoUpdateDeps {
  now?: () => number
  getCacheRoot?: () => string
  storage?: UpdateStorage
  checker?: (packageName?: string) => Promise<string>
  installer?: (version: string, entry?: ConfigEntry) => Promise<unknown>
  logger?: (event: Record<string, unknown>) => void
  currentVersion?: () => string
  discover?: () => ConfigEntry[]
  loadedPackagePath?: string
}
export interface AutoUpdateContext {
  event: { subscribe(options?: { signal?: AbortSignal }): AsyncIterable<AutoUpdateEvent> }
}
export interface AutoUpdateEvent {
  type?: string
  /** OpenCode v2 实际事件载荷位于 properties.info；data 保留兼容旧测试/适配器。 */
  properties?: { info?: { id?: string; sessionID?: string; parentID?: string } }
  data?: { sessionID?: string; parentID?: string }
}
export type AutoUpdateResult = { lastCheckedAt?: number; lastResult?: string }

function packageVersion(loadedPackagePath?: string): string {
  // `import.meta.url` remains anchored to this module when the plugin is loaded
  // from a different working directory (and also works for the built dist file).
  const base = loadedPackagePath ?? dirname(fileURLToPath(import.meta.url))
  for (const file of [join(base, "package.json"), join(base, "..", "package.json"), join(base, "..", "..", "package.json")]) {
    try { return JSON.parse(readFileSync(file, "utf8")).version } catch {}
  }
  return "0.0.0"
}

/** 在 v2 session.created 事件上注册一次、节流的自动更新检查。失败始终 fail-open。 */
export function registerAutoUpdate(ctx: AutoUpdateContext, config?: any, deps: AutoUpdateDeps = {}): () => Promise<void> {
  const resolved = getAutoUpdateConfig(config)
  const controller = new AbortController()
  const root = (deps.getCacheRoot ?? defaultCacheRoot)()
  const path = join(root, "update-state.json")
  const now = deps.now ?? Date.now
  const storage = deps.storage ?? {
    read: (p: string) => { try { return existsSync(p) ? readFileSync(p, "utf8") : null } catch { return null } },
    write: (p: string, s: string) => { try { mkdirSync(root, { recursive: true }); writeFileSync(p, s) } catch {} },
  }
  let checked = false
  let iterator: AsyncIterator<any> | undefined
  const log = (value: { decision: string; reason?: string; currentVersion?: string; latestVersion?: string; error?: unknown }) => {
    try {
      const { error, ...rest } = value
      deps.logger?.({ event: "auto_update", ...rest, ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }) })
    } catch {}
  }
  const run = async () => {
    if (checked || !resolved.enabled) return
    checked = true // 抢占必须发生在任何异步启动之前
    try {
      const all = (deps.discover ?? discoverConfigEntries)()
      // 入口筛选：file: / @latest / 本地开发路径按既有安全策略跳过（@latest 由
      // OpenCode 自行解析最新版，自动更新与其竞争反而会互相覆盖）。
      // 固定版本（pinned semver）入口**允许**自动更新：此前要求 installer marker，
      // 但生产链路无任何代码写入该标记，导致 pinned 入口永远静默跳过（真实缺陷）。
      // 安装成功后由 installer 同步回写配置版本，用户退出通道是 autoUpdate.enabled=false。
      const entries = all.filter(entry => {
        const raw = entry.kind === "string" ? entry.value : String((entry.value as Record<string, unknown>).package ?? "")
        if (typeof raw === "string" && (raw.startsWith("file:") || raw === "@latest" || raw.endsWith("@latest"))) return false
        return true
      })
      // 没有可管理入口时不能触碰状态存储或启动网络检查。
      if (!entries.length) { log({ decision: "skipped", reason: "no_entry" }); return }
      const raw = await storage.read?.(path)
      let state: AutoUpdateResult = {}
      try { state = raw ? JSON.parse(raw as string) : {} } catch {}
      if (state.lastCheckedAt !== undefined && now() - state.lastCheckedAt < resolved.checkIntervalMs) return
       const at = now(); const save = async (result: string) => {
         try { await storage.write?.(path, JSON.stringify({ ...state, lastCheckedAt: at, lastResult: result })) } catch {}
       }
       // 根事件到达后立即持久化检查时间，避免并发事件重复触发网络检查。
       await save("checking")
       const current = deps.currentVersion ? deps.currentVersion() : packageVersion(deps.loadedPackagePath)
       let next: string
       try { next = await (deps.checker ?? queryRegistry)() }
       catch (error) { await save("check_failed"); log({ decision: "check_failed", error }); return }
      const entry = entries[0]
      const loadedPath = deps.loadedPackagePath ?? fileURLToPath(import.meta.url)
      const decision: UpdateDecision = decide(current, next, { ...entry, file: loadedPath })
       log({ decision, currentVersion: current, latestVersion: next })
       if (decision === "update") {
         try {
           if (!deps.installer) throw new Error("installer 未配置")
           await deps.installer(next, entry)
         } catch (error) { await save("update_failed"); log({ decision: "update_failed", error }); return }
         await save("update_installed"); log({ decision: "update_installed", currentVersion: current, latestVersion: next })
         log({ decision: "restart_required", currentVersion: current, latestVersion: next })
       } else {
         await save(decision)
       }
     } catch (error) { log({ decision: "error", error }) }
  }
  if (!resolved.enabled) return async () => { controller.abort() }
  void (async () => {
    try {
      iterator = ctx.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
      while (!controller.signal.aborted) {
         const item = await iterator.next(); if (item.done || controller.signal.aborted) break
        const event = item.value as AutoUpdateEvent
        const info = event.properties?.info
        const data = event.data
        const sessionID = info?.id ?? info?.sessionID ?? data?.sessionID
        const parentID = info?.parentID ?? data?.parentID
        if (event.type === "session.created" && sessionID && !parentID) void run()
      }
    } catch (error) { if (!controller.signal.aborted) log({ decision: "error", error }) }
  })()
  return async () => {
    controller.abort()
    try { await iterator?.return?.() } catch {}
  }
}
