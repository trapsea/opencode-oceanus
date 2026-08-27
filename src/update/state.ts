import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type UpdatePhase = 'download' | 'staging' | 'quarantine' | 'live' | 'committed' | 'update_failed';
export interface UpdateState { phase: UpdatePhase; staging?: string; quarantine?: string; live?: string; version?: string; }
export interface StateIo { readFile?: (p: string) => string; writeFile?: (p: string, s: string) => void; rename?: (a: string,b: string)=>void; remove?: (p:string)=>void; exists?: (p:string)=>boolean; }

const fsIo: Required<StateIo> = { readFile: p=>readFileSync(p,'utf8'), writeFile:(p,s)=>writeFileSync(p,s), rename:renameSync, remove:p=>rmSync(p,{recursive:true,force:true}), exists:existsSync };
export function statePath(root: string) { return join(root, 'update-state.json'); }
export function readUpdateState(root: string, io: StateIo = {}): UpdateState | null {
  const x={...fsIo,...io}; try { if (!x.exists(statePath(root))) return null; const v=JSON.parse(x.readFile(statePath(root))); if (!v || !['staging','quarantine','live','committed'].includes(v.phase)) return null; return v; } catch { return null; }
}
export function writeUpdateState(root: string, state: UpdateState, io: StateIo = {}) { const x={...fsIo,...io}; const p=statePath(root); x.writeFile(p+'.tmp', JSON.stringify(state)); x.rename(p+'.tmp',p); }
export function recoverUpdateState(root: string, io: StateIo = {}): UpdateState | null {
  const x={...fsIo,...io}; const s=readUpdateState(root,x); if (!s) return null;
  try {
    const live=s.live ?? join(root,'live');
    // staging means the old live is still authoritative; quarantine means the
    // rename may have happened immediately before a crash.
    if (s.phase === 'quarantine' || s.phase === 'live') {
      if (x.exists(live)) {
        if (s.quarantine && x.exists(s.quarantine)) x.remove(s.quarantine);
      } else if (s.quarantine && x.exists(s.quarantine)) x.rename(s.quarantine,live);
    }
    if (s.staging && x.exists(s.staging)) x.remove(s.staging);
    if (s.quarantine && x.exists(s.quarantine)) x.remove(s.quarantine);
    x.remove(statePath(root)); return s;
  } catch { return null; }
}
