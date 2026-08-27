import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installStaged, resolveOpenCodeInstallContext, STALE_LOCK_MIN_AGE_MS } from './cache';
function tarFile(name:string, body:string) { const h=Buffer.alloc(512); h.write(name); h.write(`0000644\0`,100); h.write('0000000\0',108); h.write('0000000\0',116); h.write(body.length.toString(8).padStart(11,'0')+'\0',124); h[156]=0; const b=Buffer.from(body); return Buffer.concat([h,b,Buffer.alloc((512-b.length%512)%512)]); }
describe('update cache',()=>{ test('陈旧锁阈值固定',()=>expect(STALE_LOCK_MIN_AGE_MS).toBe(60_000)); test('下载 tarball，绝不执行 bun pack',async()=>{const root=mkdtempSync(join(tmpdir(),'au3-')); const calls:string[][]=[]; const result=await installStaged({cacheRoot:root,version:'1.0.0',packageSpec:'ignored',sourceDir:'ignored',download:async()=>new Response(gzipSync(Buffer.concat([tarFile('package/package.json',JSON.stringify({name:'opencode-oceanus',version:'1.0.0',main:'index.js'})),tarFile('package/index.js','ok'),Buffer.alloc(1024)])),{status:200}),run:async(_c,args)=>{calls.push(args); return {status:0};}}); expect(result).toBe(join(root,'live')); expect(calls.map(x=>x[0])).toEqual(['install']);}); });

describe('OpenCode sandbox 布局', () => {
  const tarball = () => gzipSync(Buffer.concat([
    tarFile('package/package.json', JSON.stringify({name:'opencode-oceanus',version:'1.1.0',main:'index.js'})),
    tarFile('package/index.js','ok'),
  ]))

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
});
