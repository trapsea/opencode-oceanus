import { describe, expect, test } from "bun:test"
import { registerAutoUpdate } from "./index"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function context(events: unknown[]) {
  let index = 0
  let returned = false
  const iterator = {
    async next() {
      if (index < events.length) return { done: false, value: events[index++] }
      await new Promise<void>(() => {})
      return { done: true, value: undefined }
    },
    async return() { returned = true; return { done: true, value: undefined } },
  }
  const iterable = { [Symbol.asyncIterator]: () => iterator }
  return {
    ctx: { event: { subscribe: () => iterable } },
    iterator,
    wasReturned: () => returned,
  }
}

const managedEntry = { file: "/tmp/opencode.json", path: "plugins.0", value: { package: "opencode-oceanus", version: "1.0.0" }, kind: "object" as const, managed: true }
const deps = (overrides: Record<string, unknown> = {}) => ({
  getCacheRoot: () => "/tmp/auto-update-test",
  now: () => 1_000,
  storage: { read: async () => null, write: async () => {} },
  currentVersion: () => "1.0.0",
  checker: async () => "1.1.0",
  discover: () => [managedEntry],
  ...overrides,
})

describe("registerAutoUpdate", () => {
  test("读取 v2 event.data，根会话触发而子会话不触发", async () => {
    const stream = context([
      { type: "session.created", data: { sessionID: "child", parentID: "root" } },
      { type: "session.created", data: { sessionID: "root" } },
    ])
    let checks = 0
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { checks++; return "1.1.0" } }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(1)
  })

  test("读取 OpenCode v2 event.properties.info，根会话触发而子会话不触发", async () => {
    const stream = context([
      { type: "session.created", properties: { info: { id: "child", parentID: "root" } } },
      { type: "session.created", properties: { info: { id: "root" } } },
    ])
    let checks = 0
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { checks++; return "1.1.0" } }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(1)
  })

  test("宿主不发 session.created 时由 execution.started / inbox.enqueued 兜底触发；子会话不触发", async () => {
    for (const type of ["session.execution.started", "session.inbox.enqueued"]) {
      const stream = context([
        { type, data: { sessionID: "child", parentID: "root" } },
        { type, data: { sessionID: "root" } },
      ])
      let checks = 0
      const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { checks++; return "1.1.0" } }))
      await tick(); await tick(); await cleanup()
      expect(checks).toBe(1)
    }
  })

  test("重复根会话事件只运行一次", async () => {
    const stream = context([
      { type: "session.created", data: { sessionID: "a" } },
      { type: "session.created", data: { sessionID: "b" } },
    ])
    let checks = 0
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { checks++; return "1.1.0" } }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(1)
  })

  test("disabled 时不订阅且不调用 checker", async () => {
    let subscribed = false; let checks = 0
    const cleanup = registerAutoUpdate({ event: { subscribe: () => { subscribed = true; return context([]).iterator } } }, { autoUpdate: { enabled: false } }, deps({ checker: async () => { checks++; return "1.1.0" } }))
    await tick(); cleanup()
    expect(subscribed).toBe(false); expect(checks).toBe(0)
  })

  test("无 managed pinned 入口时只记录 no_entry", async () => {
    let reads = 0; let checks = 0; let installs = 0
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ discover: () => [], storage: { read: async () => { reads++; return null }, write: async () => {} }, checker: async () => { checks++; return "1.1.0" }, installer: async () => { installs++ } }))
    await tick(); await cleanup()
    expect(reads).toBe(0); expect(checks).toBe(0); expect(installs).toBe(0)
  })

  test("已锁（非 managed）入口同样自动更新：安装成功后由 installer 同步回写配置", async () => {
    let checks = 0; let installs = 0
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const pinned = { file: "/tmp/opencode.json", path: "plugins.0", value: "opencode-oceanus@1.0.0", kind: "string" as const, managed: false }
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ discover: () => [pinned], checker: async () => { checks++; return "1.1.0" }, installer: async () => { installs++ } }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(1); expect(installs).toBe(1)
  })

  test("未锁入口（v2 默认 plugins: [\"opencode-oceanus\"]）会调用 checker 与 installer", async () => {
    const installed: string[] = []
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const unlocked = { file: "/tmp/opencode.json", path: "plugins.0", value: "opencode-oceanus", kind: "string" as const, managed: false }
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ discover: () => [unlocked], installer: async (version) => { installed.push(version) } }))
    await tick(); await tick(); await cleanup()
    expect(installed).toEqual(["1.1.0"])
  })

  test("未锁入口：file:/@latest 跳过、major/prerelease 不安装", async () => {
    for (const [value, next, shouldInstall] of [
      ["file:../local", "1.1.0", false],
      ["opencode-oceanus@latest", "1.1.0", false],
      ["opencode-oceanus", "2.0.0", false],
      ["opencode-oceanus", "1.2.0-beta", false],
    ] as const) {
      const installed: string[] = []
      const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
      const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({
        discover: () => [{ file: "/tmp/opencode.json", path: "plugins.0", value, kind: "string" as const, managed: false }],
        checker: async () => next,
        installer: async (v) => { installed.push(v) },
      }))
      await tick(); await tick(); await cleanup()
      expect(installed).toEqual(shouldInstall ? ["1.1.0"] : [])
    }
  })

  test("节流状态命中时不调用 checker，但记录 throttled 决策（黑洞可观测）", async () => {
    let checks = 0
    const logs: Record<string, unknown>[] = []
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ storage: { read: async () => JSON.stringify({ lastCheckedAt: 900 }), write: async () => {} }, checker: async () => { checks++; return "1.1.0" }, logger: (event) => logs.push(event) }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(0)
    expect(logs).toContainEqual(expect.objectContaining({ decision: "throttled" }))
  })

  test("订阅建立后由延迟定时器触发初始检查（兜底事件注册间隙，不依赖任何事件到达）", async () => {
    let checks = 0
    const stream = context([]) // 无任何事件到达
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({
      initialDelayMs: 0,
      checker: async () => { checks++; return "1.1.0" },
      installer: async () => {},
    }))
    await tick(); await tick(); await tick(); await tick()
    await cleanup()
    expect(checks).toBe(1)
  })

  test("checker 失败 fail-open 并记录错误日志", async () => {
    const logs: Record<string, unknown>[] = []
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { throw new Error("网络失败") }, logger: (event) => logs.push(event) }))
    await tick(); await tick(); await cleanup()
    expect(logs).toContainEqual(expect.objectContaining({ decision: "check_failed", error: "网络失败" }))
  })

  test("update 决策调用 installer 并写入状态", async () => {
    const writes: string[] = []; const installed: string[] = []
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ storage: { read: async () => null, write: async (_path, value) => writes.push(value) }, installer: async (version) => { installed.push(version) } }))
    await tick(); await tick(); await cleanup()
    expect(installed).toEqual(["1.1.0"])
    expect(JSON.parse(writes.at(-1)!)).toEqual({ lastCheckedAt: 1_000, lastResult: "update_installed" })
  })

  test("cleanup 调用 iterator.return", async () => {
    const stream = context([])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps())
    await tick(); await cleanup(); await tick()
    expect(stream.wasReturned()).toBe(true)
  })
})
