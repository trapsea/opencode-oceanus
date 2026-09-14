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
  /** 历史版本清扫（fail-open）；检查周期开始与更新安装成功后各触发一次。测试注入用。 */
  cleanup?: () => unknown
  /** 订阅建立后延迟触发一次初始检查，兜底事件注册间隙；默认 2000ms，测试可注入 0。 */
  initialDelayMs?: number
}
export interface AutoUpdateContext {
  event: { subscribe(options?: { signal?: AbortSignal }): AsyncIterable<AutoUpdateEvent> }
}
export interface AutoUpdateEvent {
  type?: string
  /**
   * 事件载荷双形态：OpenCode 2.0（beta-19507 起）wire 为 `{id, created, type, location, data:{sessionID, parentID?}, durable}`
   * （2.0.3 隔离 serve SSE 实测）；beta 宿主载荷位于 properties.info。消费按
   * properties.info 优先、data 兜底的顺序兼容读取。
   */
  properties?: { info?: { id?: string; sessionID?: string; parentID?: string } }
  data?: { sessionID?: string; parentID?: string }
}
export type AutoUpdateResult = { lastCheckedAt?: number; lastResult?: string }

/**
 * 触发自动更新检查的事件类型。
 *
 * 实测宿主 beta-18743 的事件流不发布 session.created（探针验证：会话从创建到
 * 执行全程无该事件，schema 有定义但流中不发），原触发器永不命中。改用会话
 * 生命周期中必然出现的事件兜底；保留 session.created 以兼容未来宿主恢复发送。
 * 幂等由 checked 标志（插件生命周期一次）+ checkIntervalMs 节流共同保证。
 */
const TRIGGER_EVENT_TYPES = new Set(["session.created", "session.execution.started", "session.inbox.enqueued"])

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
    // 每进程只查一次（定时器在订阅后 2s 触发首查，事件触发仅在定时器前生效）；
    // 跨进程频率由 checkIntervalMs 节流（默认 3 小时）。抢占必须发生在任何异步启动之前。
    if (checked || !resolved.enabled) return
    checked = true
    // 历史版本兜底清扫：独立于入口发现与节流（幂等、fail-open）。宿主热重载可能
    // 中断"更新成功后"的清理调用链，此处保证每个进程首个检查周期都尝试回收
    // 残留（含更新前已存在的历史时间戳目录）。
    if (resolved.cleanup) { try { deps.cleanup?.() } catch {} }
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
      // 节流命中必须留痕：这是"重启后没反应"的黑洞路径（状态文件刚写过 current 时，
      // 节流窗口内所有触发都被静默吞掉，无任何日志），修复为记录 throttled 决策。
      if (state.lastCheckedAt !== undefined && now() - state.lastCheckedAt < resolved.checkIntervalMs) {
        log({ decision: "throttled", reason: "interval", currentVersion: String(state.lastResult ?? "") })
        return
      }
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
         let installMarker: unknown
         try {
           if (!deps.installer) throw new Error("installer 未配置")
           installMarker = await deps.installer(next, entry)
         } catch (error) { await save("update_failed"); log({ decision: "update_failed", error }); return }
         await save("update_installed"); log({ decision: "update_installed", currentVersion: current, latestVersion: next })
         // 更新成功后尽力清扫历史版本；宿主热重载路径若在此处中断调用链，
         // 清理自然放弃，由下一进程的检查周期兜底（见 run() 开头）。
         if (resolved.cleanup) { try { deps.cleanup?.() } catch {} }
         // 宿主路径热重载成功时无需重启；host-pending（跨实例/验证超时）与自管安装仍需重启。
         if (installMarker === "host-reloaded") {
           log({ decision: "updated_via_host", currentVersion: current, latestVersion: next })
         } else {
           log({ decision: "restart_required", currentVersion: current, latestVersion: next })
         }
       } else {
         await save(decision)
       }
     } catch (error) { log({ decision: "error", error }) }
  }
  if (!resolved.enabled) return async () => { controller.abort() }
  // 注册间隙兜底：事件订阅的底层注册是异步完成的，插件惰性加载（按目录、首次使用时）
  // 与会话创建/首轮执行是同一突发流，开场事件（session.created / execution.started）
  // 结构性落进间隙被丢弃。订阅后延迟触发一次初始检查，不依赖任何事件到达。
  const initialTimer: ReturnType<typeof setTimeout> = setTimeout(() => { void run() }, deps.initialDelayMs ?? 2_000)
  try { (initialTimer as unknown as { unref?: () => void })?.unref?.() } catch {}
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
        if (TRIGGER_EVENT_TYPES.has(String(event.type)) && sessionID && !parentID) void run()
      }
    } catch (error) { if (!controller.signal.aborted) log({ decision: "error", error }) }
  })()
  return async () => {
    clearTimeout(initialTimer)
    controller.abort()
    try { await iterator?.return?.() } catch {}
  }
}
