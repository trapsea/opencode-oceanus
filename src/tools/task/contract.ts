export type WorkspaceRef = { gitHead: string | null; dirty: boolean };
export type Diagnostic = { code: string; path: string; message: string };
export type ParseResult<T> = { value?: T; diagnostics: Diagnostic[] };

export interface LedgerV1 { schemaVersion: 1; plan: string; workspaceRef: WorkspaceRef; tasks: LedgerTask[]; [key: string]: unknown }
export interface LedgerTask { taskId: string; wave: number; dependsOn: string[]; files: string[]; state: 'pending'|'in_progress'|'completed'|'failed'|'blocked'; owner: string; evidence: Evidence[]; updatedAt: string; [key: string]: unknown }
export interface Evidence { kind: string; status: 'missing'|'unverified'|'verified'|'stale'|'degraded'; source: string; command: string; exitCode: number|null; timestamp: string; workspaceRef: WorkspaceRef; note: string; [key: string]: unknown }
export interface ReviewReportV1 { status: 'REVIEW_OKAY'|'REVIEW_REJECT'; plan: string; spec: string; generatedAt: string; workspaceRef: WorkspaceRef; completionMatrix: MatrixRow[]; findings: Finding[]; tests: ReviewTest[]; residualUncertainty: string[]; [key: string]: unknown }
export interface MatrixRow { criterion: string; taskId: string; evidence: string[]; workspaceRef: WorkspaceRef; status: 'verified'|'missing'|'stale'|'degraded' }
export interface Finding { severity: 'info'|'warning'|'error'; summary: string; blocking: boolean }
export interface ReviewTest { command: string; exitCode: number; timestamp: string; workspaceRef: WorkspaceRef; status: 'passed'|'failed'|'skipped' }
export type FinishReasonCode = 'missing_report'|'invalid_report'|'review_rejected'|'stale_report'|'incomplete_matrix'|'blocking_finding'|'tests_not_passed';
export type FinishDecision = { status: 'COMPLETED'|'NOT_COMPLETED'; reasonCodes: FinishReasonCode[] };

const diag = (code: string, path: string, message: string): Diagnostic => ({ code, path, message });
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const iso = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x)) && /Z$/.test(x);
const ref = (x: unknown): x is WorkspaceRef => !!x && typeof x === 'object' && ('gitHead' in x) && (typeof (x as any).gitHead === 'string' || (x as any).gitHead === null) && typeof (x as any).dirty === 'boolean';
// null 也是有效的 gitHead：两个都无法取得 HEAD 时，只要 dirty 状态一致即可视为同一快照。
const sameRef = (a: WorkspaceRef, b: WorkspaceRef) => a.gitHead === b.gitHead && a.dirty === b.dirty;
function block(text: string, marker: string): { value?: any; diagnostics: Diagnostic[] } {
  const m = text.match(new RegExp('<!-- ' + marker + ' -->\\s*```json\\s*([\\s\\S]*?)\\s*```'));
  if (!m) return { diagnostics: [diag('missing_block', '$', '缺少 JSON block')] };
  try { return { value: JSON.parse(m[1]), diagnostics: [] }; } catch { return { diagnostics: [diag('invalid_json', '$', 'JSON 无效')] }; }
}
function ledgerChecks(x: any): Diagnostic[] {
  const d: Diagnostic[] = [];
  if (!x || typeof x !== 'object') return [diag('invalid_json', '$', '根对象无效')];
  if (x.schemaVersion !== 1) d.push(diag('unsupported_version', '.schemaVersion', '不支持的版本'));
  if (!nonEmpty(x.plan) || !ref(x.workspaceRef) || !Array.isArray(x.tasks)) d.push(diag('invalid_json', '$', 'Ledger 字段无效'));
  (x.tasks || []).forEach((t: any, i: number) => {
    if (!nonEmpty(t.taskId) || !Number.isInteger(t.wave) || t.wave < 1 || !Array.isArray(t.dependsOn) || !Array.isArray(t.files) || !nonEmpty(t.owner) || !Array.isArray(t.evidence) || !['pending','in_progress','completed','failed','blocked'].includes(t.state)) d.push(diag('invalid_json', `.tasks[${i}]`, '任务字段无效'));
    if (Array.isArray(t.dependsOn)) t.dependsOn.forEach((v: unknown, j: number) => { if (!nonEmpty(v)) d.push(diag('invalid_dependency', `.tasks[${i}].dependsOn[${j}]`, '依赖标识不能为空')); });
    if (Array.isArray(t.files)) t.files.forEach((v: unknown, j: number) => { if (!nonEmpty(v)) d.push(diag('invalid_file', `.tasks[${i}].files[${j}]`, '文件路径不能为空')); });
    if (!iso(t.updatedAt)) d.push(diag('invalid_timestamp', `.tasks[${i}].updatedAt`, '时间戳无效'));
    (t.evidence || []).forEach((e: any, j: number) => { if (!nonEmpty(e.kind)||!nonEmpty(e.status)||!nonEmpty(e.source)||!nonEmpty(e.command)||!(Number.isInteger(e.exitCode)||e.exitCode===null)||!ref(e.workspaceRef)||!nonEmpty(e.note)) d.push(diag('invalid_json', `.tasks[${i}].evidence[${j}]`, '证据字段无效')); if (!iso(e.timestamp)) d.push(diag('invalid_timestamp', `.tasks[${i}].evidence[${j}].timestamp`, '时间戳无效')); });
  });
  const ids = new Set<string>(); for (const t of x.tasks || []) { if (ids.has(t.taskId)) d.push(diag('duplicate_task_id', '.tasks', 'taskId 重复')); ids.add(t.taskId); }
  return d;
}
export function parseLedger(text: string): ParseResult<LedgerV1> { const p=block(text,'sisyphus-ledger:v1'); if (!p.value) return p; const diagnostics=ledgerChecks(p.value); return { value: p.value, diagnostics }; }
export function validateLedger(ledger: LedgerV1, currentRef: WorkspaceRef): Diagnostic[] {
  const d: Diagnostic[]=[]; const map=new Map(ledger.tasks.map(t=>[t.taskId,t])); const visiting=new Set<string>(), done=new Set<string>();
  const visit=(id:string)=>{ if(visiting.has(id)){d.push(diag('dependency_cycle',`.tasks.${id}`,'依赖循环'));return;} if(done.has(id))return; const t=map.get(id); if(!t)return; visiting.add(id); for(const dep of t.dependsOn){if(!map.has(dep))d.push(diag('missing_dependency',`.tasks.${id}`,'依赖缺失')); else {visit(dep); const u=map.get(dep)!; if(u.state==='failed'||u.state==='blocked')d.push(diag('upstream_failed_or_blocked',`.tasks.${id}`,'上游失败或阻塞'));}} visiting.delete(id);done.add(id);}; ledger.tasks.forEach(t=>visit(t.taskId)); const files=new Map<string,string>(); ledger.tasks.forEach(t=>t.files.forEach(f=>{if(files.has(f)&&files.get(f)!==t.taskId)d.push(diag('file_scope_conflict',`.tasks.${t.taskId}.files`,'文件范围冲突')); else files.set(f,t.taskId);})); ledger.tasks.forEach((t,i)=>t.evidence.forEach((e,j)=>{if(e.status==='degraded'||!sameRef(e.workspaceRef,currentRef))d.push(diag('stale_evidence',`.tasks[${i}].evidence[${j}]`,'证据已过期或降级'));})); return d;
}
 function reviewChecks(x:any): Diagnostic[] { const d:Diagnostic[]=[]; if(!x||typeof x!=='object')return [diag('invalid_json','$','报告无效')]; const strings=['plan','spec']; if(!['REVIEW_OKAY','REVIEW_REJECT'].includes(x.status))d.push(diag('invalid_json','.status','状态无效')); for(const k of strings)if(!nonEmpty(x[k]))d.push(diag('invalid_json',`.${k}`,'不能为空')); if(!iso(x.generatedAt))d.push(diag('invalid_timestamp','.generatedAt','时间戳无效')); if(!ref(x.workspaceRef)||!Array.isArray(x.completionMatrix)||!Array.isArray(x.findings)||!Array.isArray(x.tests)||!Array.isArray(x.residualUncertainty))d.push(diag('invalid_json','$','报告字段无效')); if(Array.isArray(x.residualUncertainty))x.residualUncertainty.forEach((v:unknown,i:number)=>{if(!nonEmpty(v))d.push(diag('invalid_json',`.residualUncertainty[${i}]`,'不能为空'));}); const matrixIds=new Set<string>(); (x.completionMatrix||[]).forEach((r:any,i:number)=>{if(!nonEmpty(r.criterion)||!nonEmpty(r.taskId)||!Array.isArray(r.evidence)||!ref(r.workspaceRef)||!['verified','missing','stale','degraded'].includes(r.status))d.push(diag('invalid_json',`.completionMatrix[${i}]`,'矩阵行无效')); if(matrixIds.has(r.taskId))d.push(diag('duplicate_task_id',`.completionMatrix[${i}].taskId`,'taskId 重复')); matrixIds.add(r.taskId); if(Array.isArray(r.evidence))r.evidence.forEach((v:unknown,j:number)=>{if(!nonEmpty(v))d.push(diag('invalid_json',`.completionMatrix[${i}].evidence[${j}]`,'不能为空'));});}); (x.findings||[]).forEach((f:any,i:number)=>{if(!['info','warning','error'].includes(f.severity)||!nonEmpty(f.summary)||typeof f.blocking!=='boolean')d.push(diag('invalid_json',`.findings[${i}]`,'发现项无效'));}); (x.tests||[]).forEach((t:any,i:number)=>{if(!nonEmpty(t.command)||!Number.isInteger(t.exitCode)||!iso(t.timestamp)||!ref(t.workspaceRef)||!['passed','failed','skipped'].includes(t.status))d.push(diag('invalid_json',`.tests[${i}]`,'测试项无效'));}); return d; }
export function parseReviewReport(text:string):ParseResult<ReviewReportV1>{const p=block(text,'sisyphus-review:v1');if(!p.value)return p;return {value:p.value,diagnostics:reviewChecks(p.value)};}
export function decideFinish(report:string,currentRef:WorkspaceRef,ledger?:LedgerV1):FinishDecision { if(!report.trim())return {status:'NOT_COMPLETED',reasonCodes:['missing_report']}; const p=parseReviewReport(report); if(!p.value||p.diagnostics.length)return {status:'NOT_COMPLETED',reasonCodes:['invalid_report']}; const r=p.value, codes:FinishReasonCode[]=[]; if(r.status==='REVIEW_REJECT')codes.push('review_rejected'); if(!sameRef(r.workspaceRef,currentRef)||r.completionMatrix.some(x=>!sameRef(x.workspaceRef,currentRef))||r.tests.some(x=>!sameRef(x.workspaceRef,currentRef))||r.completionMatrix.some(x=>x.status==='stale'||x.status==='degraded'))codes.push('stale_report'); const ids=ledger?.tasks.map(t=>t.taskId)??[]; if(!r.completionMatrix.length||r.completionMatrix.some(x=>x.status!=='verified')||(ledger&&(!ids.every(id=>r.completionMatrix.some(x=>x.taskId===id))||r.completionMatrix.some(x=>!ids.includes(x.taskId)))))codes.push('incomplete_matrix'); if(r.findings.some(x=>x.blocking))codes.push('blocking_finding'); if(!r.tests.length||r.tests.some(x=>x.status!=='passed')||r.tests.some(x=>x.workspaceRef.dirty!==currentRef.dirty))codes.push('tests_not_passed'); return {status:codes.length?'NOT_COMPLETED':'COMPLETED',reasonCodes:codes}; }
