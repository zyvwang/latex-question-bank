import { broadcastBankChanged, broadcastVariantsChanged } from './events.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../shared/validation-primitives.js';
import { uuid } from '../shared/variants.js';
import { canonicalImportJson, type VariantImportResult } from '../shared/variant-import.js';
import { writeJsonFileAtomic } from './json-file.js';
import { isNotFound, revisionForContent, serializeJson } from './storage-utils.js';
import { StorageError } from './storage-types.js';
import { assertRealWorkspaceSubdir, resolveRealWorkspaceFile } from './workspace-paths.js';
import { readVariantJson, variantDir, variantFiles, writeVariantJson } from './variant-storage.js';

export interface ImportWrite { area: 'bank' | 'variants' | 'assets'; name: string; before: string | null; content: string; binary?: boolean }
export interface ImportIntent { version: 1; operationId: string; digest: string; familyId: string; rootId: string; writes: ImportWrite[]; result: VariantImportResult; isolated?: boolean }
export const bytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function importDigest(value: unknown): string {
  return revisionForContent(canonicalImportJson(value));
}
async function target(workspace: string, write: ImportWrite) {
  if (write.area === 'bank') {
    if (write.name !== 'bank.json') throw new Error('Invalid bank target');
    return path.join(workspace,'bank.json');
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(write.name)) throw new Error('Invalid transaction path');
  return resolveRealWorkspaceFile(path.join(workspace,write.area),write.name,{allowMissing:true});
}
async function currentHash(workspace: string, write: ImportWrite) {
  try { return bytesHash(await readFile(await target(workspace,write))); } catch(e) { if (isNotFound(e)) return null; throw e; }
}
export async function readImportReceipt(workspace: string, operationId: string) {
  if (!uuid(operationId)) throw new StorageError('operationId 必须是 UUID。','VARIANT_INVALID');
  try {
    const receipt = JSON.parse(await readVariantJson(workspace,`operation-${operationId}.json`)) as {digest:string;result:VariantImportResult};
    if (!/^[a-f0-9]{64}$/.test(receipt.digest) || receipt.result?.operationId !== operationId) throw new Error('Invalid receipt');
    return receipt;
  } catch(e) { if (isNotFound(e)) return null; throw e; }
}
/** Preflight every target before rolling forward. Unknown bytes are retained for human reconciliation. */
export async function finishImport(workspace: string, intent: ImportIntent) {
  const file = `import-tx-${intent.operationId}.json`;
  if (intent.isolated) return false;
  for (const write of intent.writes) {
    const hash = await currentHash(workspace,write);
    const after = bytesHash(Buffer.from(write.content,write.binary?'base64':'utf8'));
    if (hash !== write.before && hash !== after) {
      intent.isolated=true; await writeVariantJson(workspace,file,intent); return false;
    }
  }
  for (const write of intent.writes) {
    const bytes = Buffer.from(write.content,write.binary?'base64':'utf8');
    if (await currentHash(workspace,write) === bytesHash(bytes)) continue;
    if (write.area !== 'bank') await mkdir(await assertRealWorkspaceSubdir(path.join(workspace,write.area)),{recursive:true});
    const destination = await target(workspace,write);
    if (write.binary) {
      // A crash may leave a partial new binary. Its hash will isolate the group on recovery.
      await writeFile(destination,bytes,{flag:'wx',flush:true});
    }
    else {
      if (write.area !== 'bank') await resolveRealWorkspaceFile(path.join(workspace,write.area),`${write.name}.bak`,{allowMissing:true});
      await writeJsonFileAtomic(destination,JSON.parse(write.content),{backup:write.before !== null});
    }
  }
  await writeVariantJson(workspace,`operation-${intent.operationId}.json`,{digest:intent.digest,result:intent.result},true);
  await rm(await resolveRealWorkspaceFile(await variantDir(workspace),file));
  return true;
}
export async function importIntents(workspace: string): Promise<ImportIntent[]> {
  const intents: ImportIntent[]=[];
  for (const name of (await variantFiles(workspace)).filter(f => /^import-tx-.*\.json$/.test(f))) {
    const v: unknown = JSON.parse(await readVariantJson(workspace,name));
    if (!isRecord(v) || v.version !== 1 || !uuid(v.operationId) || name !== `import-tx-${v.operationId}.json` || !uuid(v.familyId) || typeof v.rootId !== 'string' || typeof v.digest !== 'string' || !Array.isArray(v.writes) || !isRecord(v.result)) throw new StorageError('联合录入事务损坏，请保留文件并核对。','VARIANT_IMPORT_ISOLATED',409);
    for (const w of v.writes) if (!isRecord(w) || !['bank','assets','variants'].includes(String(w.area)) || typeof w.name !== 'string' || typeof w.content !== 'string' || !(w.before === null || typeof w.before === 'string' && /^[a-f0-9]{64}$/.test(w.before))) throw new StorageError('联合录入事务路径或哈希无效。','VARIANT_IMPORT_ISOLATED',409);
    intents.push(v as unknown as ImportIntent);
  }
  return intents;
}
export async function recoverVariantImports(workspace: string) {
  let intents: ImportIntent[];
  try {intents=await importIntents(workspace);} catch(e) {
    if (e instanceof StorageError && ['WORKSPACE_SUBDIR_SYMLINK','WORKSPACE_SUBDIR_INVALID','WORKSPACE_SUBDIR_ESCAPE'].includes(e.code)) return;
    throw e;
  }
  for (const intent of intents) {
    const receipt = await readImportReceipt(workspace,intent.operationId);
    if (receipt) {
      if (receipt.digest !== intent.digest || JSON.stringify(receipt.result) !== JSON.stringify(intent.result)) throw new StorageError('联合录入结果与事务不一致。','VARIANT_IMPORT_ISOLATED',409);
      await rm(await resolveRealWorkspaceFile(await variantDir(workspace),`import-tx-${intent.operationId}.json`));
    } else if (!await finishImport(workspace,intent)) continue;
    broadcastVariantsChanged({workspacePath:workspace,source:'agent'});
    if (intent.result.batchId) broadcastBankChanged({workspacePath:workspace,revision:revisionForContent(await readFile(path.join(workspace,'bank.json'),'utf8')),source:'agent-import',batchId:intent.result.batchId,counts:{created:1,updated:0,skipped:0,conflicts:0,assets:intent.writes.filter(w => w.area === 'assets').length}});
  }
}
export const jsonImportWrite = (area: ImportWrite['area'],name: string,value: unknown,before: string|null = null): ImportWrite => ({area,name,before,content:serializeJson(value)});
