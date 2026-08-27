import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installStaged, STALE_LOCK_MIN_AGE_MS } from './cache';
function tarFile(name:string, body:string) { const h=Buffer.alloc(512); h.write(name); h.write(`0000644\0`,100); h.write('0000000\0',108); h.write('0000000\0',116); h.write(body.length.toString(8).padStart(11,'0')+'\0',124); h[156]=0; const b=Buffer.from(body); return Buffer.concat([h,b,Buffer.alloc((512-b.length%512)%512)]); }
describe('update cache',()=>{ test('陈旧锁阈值固定',()=>expect(STALE_LOCK_MIN_AGE_MS).toBe(60_000)); test('下载 tarball，绝不执行 bun pack',async()=>{const root=mkdtempSync(join(tmpdir(),'au3-')); const calls:string[][]=[]; const result=await installStaged({cacheRoot:root,version:'1.0.0',packageSpec:'ignored',sourceDir:'ignored',download:async()=>new Response(gzipSync(Buffer.concat([tarFile('package/package.json',JSON.stringify({name:'opencode-oceanus',version:'1.0.0',main:'index.js'})),tarFile('package/index.js','ok'),Buffer.alloc(1024)])),{status:200}),run:async(_c,args)=>{calls.push(args); return {status:0};}}); expect(result).toBe(join(root,'live')); expect(calls.map(x=>x[0])).toEqual(['install']);}); });
