import { describe, expect, test } from "bun:test"
import { canUpdate, compareVersions, decide, queryRegistry, registryCandidates } from "./checker"

describe("update checker", () => {
  test("比较版本并区分 major/prerelease", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0)
    expect(decide("1.2.0", "2.0.0")).toBe("major")
    expect(decide("1.2.0", "1.3.0-beta")).toBe("prerelease")
    expect(canUpdate("1.2.0", "1.3.0")).toBe(true)
  })
  test("识别 latest/file；OpenCode cache（sandbox）路径不再拒绝", () => {
    expect(decide("1.0.0", "1.1.0", { file: "x", path: "", value: "@latest", kind: "string", managed: true })).toBe("latest")
    expect(decide("1.0.0", "1.1.0", { file: "x", path: "", value: "file:x", kind: "string", managed: true })).toBe("file")
    expect(decide("1.0.0", "1.1.0", { file: "/a/.cache/opencode/packages/opencode-oceanus@latest", path: "", value: "opencode-oceanus", kind: "string", managed: false })).toBe("update")
  })
  test("registry timeout propagates", async () => {
    const fetcher = (() => new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1))) as typeof fetch
    await expect(queryRegistry("x", 100, fetcher)).rejects.toThrow("timeout")
  })

  test("registry 候选链：env 覆盖优先、去重、末位镜像", () => {
    expect(registryCandidates({} as NodeJS.ProcessEnv)).toEqual(["https://registry.npmjs.org", "https://registry.npmmirror.com"])
    expect(registryCandidates({ NPM_CONFIG_REGISTRY: "https://mirror.internal/" } as NodeJS.ProcessEnv)).toEqual([
      "https://mirror.internal", "https://registry.npmjs.org", "https://registry.npmmirror.com",
    ])
    expect(registryCandidates({ NPM_CONFIG_REGISTRY: "https://registry.npmjs.org" } as NodeJS.ProcessEnv)).toHaveLength(2)
  })

  test("官方源失败时回退镜像源", async () => {
    const fetcher = (async (url: string) => {
      if (url.includes("registry.npmjs.org")) throw new Error("官方源不可达")
      return new Response(JSON.stringify({ version: "1.2.3" }), { status: 200 })
    }) as typeof fetch
    await expect(queryRegistry("x", 100, fetcher)).resolves.toBe("1.2.3")
  })
})
