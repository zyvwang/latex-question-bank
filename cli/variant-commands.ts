import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../shared/validation-primitives.js';
import { parseVariantImportGroups, canonicalImportJson } from '../shared/variant-import.js';

export async function runVariantCommand(args:string[],flags:Map<string,string|boolean>,workspacePath:string,request:(path:string,init?:RequestInit)=>Promise<unknown>) {
  const [action,id]=args;const root='/api/agent/variants';let result:unknown;
  const usage=(message:string):never => {process.exitCode=2;throw new Error(message);};
  const readManifest=async () => {
    const file=flags.get('file');if (typeof file !== 'string') return usage('需要 --file <清单.json>。');
    let body:unknown;try {body=JSON.parse(await readFile(file,'utf8'));} catch {return usage('无法读取 JSON 清单。');}
    if (!isRecord(body)) return usage('清单必须是对象。');
    return {body,file};
  };
  const query=(operationId:string,digest?:string) => request(`${root}/import-result?${new URLSearchParams({workspacePath,operationId,...(digest?{digest}:{})})}`);
  if (action === 'list' || ['read','read-original'].includes(action) && id) result=await request(`${root}/${action}?${new URLSearchParams({workspacePath,...(id?{[action === 'read-original'?'rootId':'familyId']:id}:{})})}`);
  else if (action === 'import-result' && id) result=await query(id);
  else if (action === 'import') {
    const {body,file}=await readManifest();
    let groups:Record<string,unknown>[];
    try {groups=parseVariantImportGroups(body);} catch(e) {return usage(String(e));}
    const results:unknown[]=[];let failed=0;let unknown=0;
    for (const group of groups) {
      const operationId=String(group.operationId);
      try {
        let uploads:unknown[]|undefined;
        if (isRecord(group.original) && group.original.kind === 'new' && isRecord(group.original.manifest) && Array.isArray(group.original.manifest.assets)) {
          uploads=[];
          for (const asset of group.original.manifest.assets) {
            if (!isRecord(asset) || typeof asset.filePath !== 'string' || typeof asset.originalName !== 'string') throw new Error('新题附件必须提供 filePath 和 originalName。');
            const bytes=await readFile(path.resolve(path.dirname(path.resolve(file)),asset.filePath));
            const extension=path.extname(asset.originalName).toLowerCase();
            uploads.push({key:asset.key,base64:bytes.toString('base64'),mimeType:extension === '.png'?'image/png':'image/jpeg'});
          }
        }
        const payload={...group,...(uploads?{uploads}:{})};
        try {
          const value=await request(`${root}/import`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspacePath,group:payload,dryRun:flags.has('dry-run')})});
          results.push({operationId,status:flags.has('dry-run')?'dry-run':'completed',result:value});
        } catch(e) {
          // Only network/response uncertainty triggers a read. Never automatically replay a write.
          if (isRecord(e) && e.exitCode === 5 || e instanceof Error && 'exitCode' in e && e.exitCode === 5) {
            let status:unknown;
            try {status=await query(operationId,createHash('sha256').update(canonicalImportJson(payload)).digest('hex'));} catch { /* Keep uncertainty visible below. */ }
            if (isRecord(status) && status.status === 'completed') results.push(status);
            else {unknown++;results.push({operationId,status:'unconfirmed',query:status,error:String(e)});}
          } else throw e;
        }
      } catch(e) {failed++;results.push({operationId,status:'failed',error:String(e)});}
    }
    result={status:unknown?'unconfirmed':failed?'partial':'completed',counts:{succeeded:results.length-failed-unknown,failed,unconfirmed:unknown},groups:results};
    if (unknown) process.exitCode=5;else if (failed) process.exitCode=3;
  } else if (['propose','revise','refuse'].includes(action)) {
    const {body}=await readManifest();
    result=await request(`${root}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,workspacePath,dryRun:flags.has('dry-run')})});
  } else return usage('未知 variant 命令。使用 list/read/read-original/import/import-result/propose/revise/refuse。');
  console.log(JSON.stringify(result,null,2));
}
