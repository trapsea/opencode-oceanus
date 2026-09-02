import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverUpdateState, writeUpdateState } from './state';

export const STALE_LOCK_MIN_AGE_MS = 60_000;
export interface InstallOptions {
  cacheRoot: string; version: string; packageSpec: string; sourceDir: string; entry?: string; pid?: number; now?:()=>number;
  run?: (cmd:string,args:string[],opts:any)=>Promise<{status:number}>; rename?: (a:string,b:string)=>void;
  download?: (url:string,init?:RequestInit)=>Promise<Response>;
  /** OpenCode 实际的安装根（如 ~/.cache/opencode/packages/opencode-oceanus@latest）。提供时更新直接发布到该目录，而不是 Oceanus 独立 cache。 */
  installRoot?: string;
  /** 安装依赖使用的包管理器候选，按序回退（spawn 失败或非零退出尝试下一个）。默认 bun → npm。 */
  packageManagers?: string[];
}
export interface LockOwner { token:string; pid:number; createdAt:number; stage:string; }
export class UpdateError extends Error { constructor(public code:string,message:string){super(message);} }
function lockPath(r:string){return join(r,'update.lock');}
function acquire(root:string, o:InstallOptions): LockOwner { mkdirSync(root,{recursive:true}); const now=(o.now??Date.now)(), owner={token:randomUUID(),pid:o.pid??process.pid,createdAt:now,stage:'staging'}; try { writeFileSync(lockPath(root),JSON.stringify(owner),{flag:'wx'}); return owner; } catch { try { const old=JSON.parse(readFileSync(lockPath(root),'utf8')) as LockOwner; const age=now-old.createdAt; let alive=true; try { process.kill(old.pid,0); } catch { alive=false; } if (!alive && age>STALE_LOCK_MIN_AGE_MS) { rmSync(lockPath(root),{force:true}); writeFileSync(lockPath(root),JSON.stringify(owner),{flag:'wx'}); return owner; } } catch {} throw new UpdateError('lock','update lock is busy'); } }
function release(root:string, owner:LockOwner){try { const current=JSON.parse(readFileSync(lockPath(root),'utf8')); if(current.token===owner.token) rmSync(lockPath(root),{force:true}); } catch {} }
function verifyPackage(dir:string, entry?:string){ let p; try { p=JSON.parse(readFileSync(join(dir,'package.json'),'utf8')); } catch { throw new UpdateError('verify','invalid package.json'); } if(p.name!=='opencode-oceanus' || typeof p.version!=='string') throw new UpdateError('verify','invalid package metadata'); const ep=entry??p.main??p.module??'dist/index.js'; if(!existsSync(join(dir,ep))) throw new UpdateError('verify','package entry is missing'); return {packageJson:p,entry:ep}; }
function safeTarPath(name:string) { if(!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name) || name.startsWith('//')) throw new UpdateError('download','unsafe archive path'); const p=posix.normalize(name); if(p==='..'||p.startsWith('../')) throw new UpdateError('download','unsafe archive path'); return p; }
function extractTar(data:Buffer, staging:string) { for(let off=0; off+512<=data.length;) { const h=data.subarray(off,off+512); if(h.every(x=>x===0)) break; const name=h.subarray(0,100).toString().replace(/\0.*$/,''); const size=parseInt(h.subarray(124,136).toString().replace(/\0.*$/,'').trim()||'0',8); const type=h[156]; const path=safeTarPath(name); if(!path.startsWith('package/')) throw new UpdateError('download','archive must contain package prefix'); const rel=path.slice(8); if(!rel) { off+=512+Math.ceil(size/512)*512; continue; } const out=join(staging,rel); if(type===1||type===2||type===3||type===4||type===5||type===6||type===7) { if(type!==5) throw new UpdateError('download','links are not allowed'); mkdirSync(out,{recursive:true}); } else if(type===0) { mkdirSync(join(out,'..'),{recursive:true}); writeFileSync(out,data.subarray(off+512,off+512+size)); } else throw new UpdateError('download','unsupported archive entry'); off+=512+Math.ceil(size/512)*512; } }

/** OpenCode 安装上下文：插件当前被加载的安装根目录（含 package.json 与 node_modules/opencode-oceanus）。 */
export interface OpenCodeInstallContext { installRoot: string; identity?: string }

/**
 * 从运行时模块路径推导 OpenCode 的安装上下文（参考 oh-my-opencode-slim 的做法）。
 * 布局：<installRoot>/node_modules/opencode-oceanus/...，installRoot 形如
 * ~/.cache/opencode/packages/opencode-oceanus@<identity>。sandbox（OpenCode cache）路径
 * 不再是拒绝理由，而是发布更新的目标位置。
 */
export function resolveOpenCodeInstallContext(modulePath?: string): OpenCodeInstallContext | null {
  let dir = dirname(modulePath ?? fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    let name: unknown
    try { name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name } catch { name = undefined }
    if (name === 'opencode-oceanus') {
      if (basename(dirname(dir)) === 'node_modules') {
        // dir = <installRoot>/node_modules/opencode-oceanus
        const installRoot = dirname(dirname(dir))
        const identity = /^opencode-oceanus@(.+)$/.exec(basename(installRoot))?.[1]
        return { installRoot, identity }
      }
      return null
    }
    const parent = dirname(dir); if (parent === dir) break; dir = parent
  }
  return null
}

export async function installStaged(o:InstallOptions){
  const owner=acquire(o.cacheRoot,o);
  const useRoot=o.installRoot;
  // staging / quarantine 与目标保持同一文件系统，保证 rename 原子性。
  const stagingArea=useRoot?dirname(useRoot):o.cacheRoot;
  const staging=join(stagingArea,`staging-${owner.token}`);
  const pkgDir=(root:string)=>useRoot?join(root,'node_modules','opencode-oceanus'):root;
  const live=useRoot?pkgDir(useRoot):join(o.cacheRoot,'live');
  const targetRoot=useRoot??join(o.cacheRoot,'live');
  const quarantine=join(stagingArea,`quarantine-${owner.token}`);
  const partial=join(o.cacheRoot,'downloads',`${o.version}.tgz.partial`);
  const mv=o.rename??renameSync;
  try {
    recoverUpdateState(o.cacheRoot); mkdirSync(join(o.cacheRoot,'downloads'),{recursive:true});
    writeUpdateState(o.cacheRoot,{phase:'download',version:o.version});
    const url=`https://registry.npmjs.org/opencode-oceanus/-/opencode-oceanus-${encodeURIComponent(o.version)}.tgz`;
    const ac=new AbortController(); const timer=setTimeout(()=>ac.abort(),30_000);
    let response:Response;
    try { response=await (o.download??fetch)(url,{signal:ac.signal}); } finally { clearTimeout(timer); }
    if(!response.ok) throw new UpdateError('download',`download failed: ${response.status}`);
    writeFileSync(partial,Buffer.from(await response.arrayBuffer()));
    mkdirSync(pkgDir(staging),{recursive:true});
    extractTar(gunzipSync(readFileSync(partial)),pkgDir(staging));
    if(useRoot) {
      // 保持 OpenCode 安装根的 wrapper package.json 布局（private + dependencies）。
      writeFileSync(join(staging,'package.json'),JSON.stringify({private:true,dependencies:{'opencode-oceanus':o.version}},null,2)+'\n');
    }
    rmSync(partial,{force:true});
    /** 传给依赖安装的最小环境：PATH/HOME/TMPDIR 之外透传代理与 registry 配置，
 * 修复剥离 env 导致代理/镜像环境下 bun install 必然失败的问题。 */
function installEnv(): Record<string,string> {
  const env: Record<string,string> = { PATH:process.env.PATH??'', HOME:process.env.HOME??'', TMPDIR:process.env.TMPDIR??'' }
  for (const key of ['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy','ALL_PROXY','all_proxy','NPM_CONFIG_REGISTRY','npm_config_registry']) {
    const value = process.env[key]; if (value !== undefined) env[key] = value
  }
  return env
}
/** 依赖安装：按候选包管理器顺序执行，spawn 失败或非零退出回退下一个；全部失败才抛错。 */
async function runPackageManager(o:InstallOptions, cwd:string, env:Record<string,string>): Promise<void> {
  const managers = o.packageManagers ?? ['bun','npm']
  const failures: string[] = []
  for (const pm of managers) {
    const args = pm === 'npm' ? ['install','--ignore-scripts','--no-audit','--no-fund'] : ['install','--ignore-scripts']
    try {
      const result = o.run
        ? await o.run(pm, args, { cwd, env })
        : await (async()=>{ const p=Bun.spawn([pm,...args],{cwd,env}); return {status:await p.exited}; })()
      if (result.status === 0) return
      failures.push(`${pm} exit ${result.status}`)
    } catch (error) { failures.push(`${pm} ${error instanceof Error ? error.message : String(error)}`) }
  }
  throw new UpdateError('install', `dependency install failed (${managers.join(' → ')}): ${failures.join('; ')}`)
}
    await runPackageManager(o, pkgDir(staging), installEnv());
    verifyPackage(pkgDir(staging),o.entry);
    writeUpdateState(o.cacheRoot,{phase:'staging',staging,live,version:o.version});
    mkdirSync(dirname(targetRoot),{recursive:true});
    if(existsSync(targetRoot)) {
      mv(targetRoot,quarantine);
      writeUpdateState(o.cacheRoot,{phase:'quarantine',staging,quarantine,live,version:o.version});
    }
    mv(staging,targetRoot);
    writeUpdateState(o.cacheRoot,{phase:'live',live,version:o.version});
    if(existsSync(quarantine)) rmSync(quarantine,{recursive:true,force:true});
    writeUpdateState(o.cacheRoot,{phase:'committed',live,version:o.version});
    rmSync(join(o.cacheRoot,'update-state.json'),{force:true});
    return live;
  } catch(e) {
    rmSync(partial,{force:true});
    if(existsSync(staging)) rmSync(staging,{recursive:true,force:true});
    if(!existsSync(targetRoot)&&existsSync(quarantine)){ try { mv(quarantine,targetRoot); } catch {} }
    writeUpdateState(o.cacheRoot,{phase:'update_failed',version:o.version});
    throw e;
  } finally { release(o.cacheRoot,owner); }
}
export const installUpdate = installStaged;
