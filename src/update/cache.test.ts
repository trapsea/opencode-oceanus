import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installStaged, resolveOpenCodeInstallContext, resolvePackageManagerBin, STALE_LOCK_MIN_AGE_MS } from './cache';
function tarFile(name:string, body:string, typeflag:string = '0') { const h=Buffer.alloc(512); h.write(name); h.write(`0000644\0`,100); h.write('0000000\0',108); h.write('0000000\0',116); h.write(body.length.toString(8).padStart(11,'0')+'\0',124); h[156]=typeflag.charCodeAt(0); const b=Buffer.from(body); return Buffer.concat([h,b,Buffer.alloc((512-b.length%512)%512)]); }
describe('update cache',()=>{ test('陈旧锁阈值固定',()=>expect(STALE_LOCK_MIN_AGE_MS).toBe(60_000)); test('下载 tarball，绝不执行 bun pack',async()=>{const root=mkdtempSync(join(tmpdir(),'au3-')); const calls:string[][]=[]; const result=await installStaged({cacheRoot:root,version:'1.0.0',packageSpec:'ignored',sourceDir:'ignored',download:async()=>new Response(gzipSync(Buffer.concat([tarFile('package/package.json',JSON.stringify({name:'opencode-oceanus',version:'1.0.0',main:'index.js'})),tarFile('package/index.js','ok'),Buffer.alloc(1024)])),{status:200}),run:async(_c,args)=>{calls.push(args); return {status:0};}}); expect(result).toBe(join(root,'live')); expect(calls.map(x=>x[0])).toEqual(['install']);}); });

describe('OpenCode sandbox 布局', () => {
  const tarball = () => gzipSync(Buffer.concat([
    tarFile('package/package.json', JSON.stringify({name:'opencode-oceanus',version:'1.1.0',main:'index.js'})),
    tarFile('package/index.js','ok'),
  ]))

  test("真实 npm tarball 的 ASCII typeflag（0 文件/5 目录/x pax 头）可正确解包", async () => {
    const root = mkdtempSync(join(tmpdir(),'tarflag-'))
    const live = await installStaged({
      cacheRoot: root, version:'1.1.0', packageSpec:'ignored', sourceDir:'ignored',
      download: async () => new Response(gzipSync(Buffer.concat([
        tarFile('package/', '', '5'),
        tarFile('package/pax', '', 'x'),  // pax 扩展头：跳过不落盘
        tarFile('package/package.json', JSON.stringify({name:'opencode-oceanus',version:'1.1.0',main:'index.js'})),
        tarFile('package/index.js', 'ok'),
      ])), {status:200}),
      run: async () => ({status:0}),
    })
    expect(readFileSync(join(live,'index.js'),'utf8')).toBe('ok')
    expect(existsSync(join(live,'package.json'))).toBe(true)
  })

  test('bun 不可用时回退 npm；代理与 registry 环境变量透传给依赖安装', async () => {
    const root = mkdtempSync(join(tmpdir(),'pmfb-'))
    const attempts: Array<{cmd:string,args:string[]}> = []
    const seenEnvs: Record<string,string>[] = []
    const prevProxy = process.env.HTTP_PROXY
    process.env.HTTP_PROXY = 'http://127.0.0.1:7890'
    try {
      const live = await installStaged({
        cacheRoot: root, version:'1.1.0', packageSpec:'ignored', sourceDir:'ignored',
        download: async () => new Response(tarball(),{status:200}),
        run: async (cmd,args,opts) => {
          attempts.push({cmd,args})
          seenEnvs.push(opts.env)
          if (cmd === 'bun') throw new Error('Failed to spawn: bun')  // 模拟 bun 不在 PATH
          return {status:0}
        },
      })
      expect(live).toBe(join(root,'live'))
      expect(attempts.map(a=>a.cmd)).toEqual(['bun','npm'])
      expect(attempts[1]!.args).toContain('--ignore-scripts')
      expect(seenEnvs.every(e => e.HTTP_PROXY === 'http://127.0.0.1:7890' && typeof e.PATH === 'string')).toBe(true)
    } finally { if (prevProxy === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = prevProxy }
  })

  test('win32：npm 解析为 npm.cmd（cmd shim 无法被无 shell 的 spawn 直接执行），Windows 环境变量透传', async () => {
    // resolvePackageManagerBin 直接断言（非 win32 保持原名）
    expect(resolvePackageManagerBin('npm', 'win32')).toBe('npm.cmd')
    expect(resolvePackageManagerBin('npm', 'linux')).toBe('npm')
    expect(resolvePackageManagerBin('bun', 'win32')).toBe('bun')

    const root = mkdtempSync(join(tmpdir(),'pmwin-'))
    const attempts: Array<{cmd:string}> = []
    const seenEnvs: Record<string,string>[] = []
    const prev = { USERPROFILE: process.env.USERPROFILE, TEMP: process.env.TEMP } as const
    process.env.USERPROFILE = 'C:\\Users\\tester'
    process.env.TEMP = 'C:\\Users\\tester\\AppData\\Local\\Temp'
    try {
      const live = await installStaged({
        cacheRoot: root, version:'1.1.0', packageSpec:'ignored', sourceDir:'ignored',
        platform: 'win32',
        download: async () => new Response(tarball(),{status:200}),
        run: async (cmd,_args,opts) => {
          attempts.push({cmd})
          seenEnvs.push(opts.env)
          if (cmd === 'bun') throw new Error('Failed to spawn: bun')
          return {status:0}
        },
      })
      expect(live).toBe(join(root,'live'))
      // bun 保持原名；npm 在 win32 上映射为 npm.cmd
      expect(attempts.map(a=>a.cmd)).toEqual(['bun','npm.cmd'])
      expect(seenEnvs.every(e => e.USERPROFILE === 'C:\\Users\\tester' && e.TEMP.startsWith('C:\\Users'))).toBe(true)
    } finally {
      if (prev.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prev.USERPROFILE
      if (prev.TEMP === undefined) delete process.env.TEMP; else process.env.TEMP = prev.TEMP
    }
  })

  test('全部包管理器失败时抛出含候选链的 install 错误', async () => {
    const root = mkdtempSync(join(tmpdir(),'pmfail-'))
    await expect(installStaged({
      cacheRoot: root, version:'1.1.0', packageSpec:'ignored', sourceDir:'ignored',
      download: async () => new Response(tarball(),{status:200}),
      run: async () => { throw new Error('Failed to spawn') },
    })).rejects.toThrow('dependency install failed (bun → npm)')
  })

  test('从运行时 package.json 解析 install context', () => {
    const base = mkdtempSync(join(tmpdir(),'occtx-'))
    const pkgDir = join(base,'packages','opencode-oceanus@latest','node_modules','opencode-oceanus')
    mkdirSync(pkgDir,{recursive:true})
    writeFileSync(join(pkgDir,'package.json'),JSON.stringify({name:'opencode-oceanus',version:'1.0.0'}))
    const ctx = resolveOpenCodeInstallContext(join(pkgDir,'dist','index.js'))
    expect(ctx?.installRoot).toBe(join(base,'packages','opencode-oceanus@latest'))
    expect(ctx?.identity).toBe('latest')
    expect(resolveOpenCodeInstallContext(join(base,'plain','dist','index.js'))).toBe(null)
  })

  test('安装发布到 OpenCode 实际 install root（sandbox 路径可用）', async () => {
    const root = mkdtempSync(join(tmpdir(),'ocinst-'))
    const installRoot = join(root,'.cache','opencode','packages','opencode-oceanus@latest')
    const oldPkg = join(installRoot,'node_modules','opencode-oceanus')
    mkdirSync(oldPkg,{recursive:true})
    writeFileSync(join(oldPkg,'package.json'),JSON.stringify({name:'opencode-oceanus',version:'1.0.0',main:'index.js'}))
    writeFileSync(join(oldPkg,'index.js'),'old')
    const bunCwds: string[] = []
    const live = await installStaged({
      cacheRoot: join(root,'oceanus-state'),
      version:'1.1.0', packageSpec:'ignored', sourceDir:'ignored',
      installRoot,
      download: async () => new Response(tarball(),{status:200}),
      run: async (_c,_a,opts) => { bunCwds.push(opts.cwd); return {status:0} },
    })
    expect(live).toBe(join(installRoot,'node_modules','opencode-oceanus'))
    expect(bunCwds.length).toBe(1)
    expect(bunCwds[0]!.endsWith(join('node_modules','opencode-oceanus'))).toBe(true)
    expect(JSON.parse(readFileSync(join(live,'package.json'),'utf8')).version).toBe('1.1.0')
    expect(JSON.parse(readFileSync(join(installRoot,'package.json'),'utf8')).dependencies['opencode-oceanus']).toBe('1.1.0')
    // 原目录被整体替换，不残留 quarantine/staging
    expect(readFileSync(join(live,'index.js'),'utf8')).toBe('ok')
    expect(readdirSync(dirname(installRoot)).filter(n=>n.includes('quarantine')||n.includes('staging'))).toEqual([])
  })

  test('依赖安装子进程携带 windowsHide 与显式 stdio（Windows 不弹 cmd 窗口）', async () => {
    // Bun.spawn 默认 windowsHide:false——宿主进程无控制台时（GUI 启动的 TUI），
    // npm.cmd/bun 控制台子进程会新开可见 cmd 窗口（Bun PR #26559 + Win32 默认行为）。
    // stdio 必须显式 pipe/ignore：libuv 在 UV_INHERIT_FD 场景会跳过 CREATE_NO_WINDOW。
    const root = mkdtempSync(join(tmpdir(),'pmhide-'))
    const seenOpts: Array<Record<string, unknown>> = []
    const live = await installStaged({
      cacheRoot: root, version:'1.1.0', packageSpec:'ignored', sourceDir:'ignored',
      download: async () => new Response(tarball(),{status:200}),
      run: async (_c,_a,opts) => { seenOpts.push(opts); return {status:0} },
    })
    expect(live).toBe(join(root,'live'))
    expect(seenOpts.length).toBeGreaterThanOrEqual(1)
    expect(seenOpts.every(o => o.windowsHide === true && o.stdin === 'ignore' && o.stdout === 'pipe' && o.stderr === 'pipe')).toBe(true)
  })

  test('新版本落位后旧目录清理失败（Windows 文件锁模拟）不回滚、不记 update_failed', async () => {
    // Windows 上旧版本目录可能仍被本进程/其他实例占用句柄，rmSync 抛 EPERM/EBUSY；
    // 此时新版本已 mv 落位，清理失败必须 fail-open——报 update_failed 即"假失败"。
    const root = mkdtempSync(join(tmpdir(),'qlock-'))
    const installRoot = join(root,'.cache','opencode','packages','opencode-oceanus@latest')
    const oldPkg = join(installRoot,'node_modules','opencode-oceanus')
    mkdirSync(oldPkg,{recursive:true})
    writeFileSync(join(oldPkg,'package.json'),JSON.stringify({name:'opencode-oceanus',version:'1.0.0',main:'index.js'}))
    const live = await installStaged({
      cacheRoot: join(root,'oceanus-state'),
      version:'1.1.0', packageSpec:'ignored', sourceDir:'ignored',
      installRoot,
      download: async () => new Response(tarball(),{status:200}),
      run: async () => ({status:0}),
      rm: () => { throw new Error('EPERM: directory in use') },
    })
    expect(JSON.parse(readFileSync(join(live,'package.json'),'utf8')).version).toBe('1.1.0')
    // quarantine 残留仅占磁盘，不影响功能（清理失败被吞）
    expect(readdirSync(dirname(installRoot)).some(n=>n.includes('quarantine'))).toBe(true)
  })
});
