import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseV4Bank } from '../shared/bank-validation.js';
import { parseFamily, parseVariantRevision, standardKinds, uuid, variantBasisSource, type FamilySnapshot, type VariantConfig, type VariantFamily, type VariantRevision } from '../shared/variants.js';
import type { Bank, QuestionItem } from '../shared/types.js';
import { writeJsonFileAtomic } from './json-file.js';
import { assertRealWorkspaceSubdir, resolveRealWorkspaceFile } from './workspace-paths.js';
import { isNotFound, revisionForContent } from './storage-utils.js';
import { StorageError } from './storage-types.js';

export async function variantDir(workspace: string, create = false) {
  const dir = await assertRealWorkspaceSubdir(path.join(workspace,'variants'));
  if (create) await mkdir(dir,{recursive:true});
  return dir;
}
export async function variantFiles(workspace: string): Promise<string[]> {
  try { return await readdir(await variantDir(workspace)); } catch(e) { if (isNotFound(e)) return []; throw e; }
}
export async function readVariantJson(workspace:string,file:string) {
  return readFile(await resolveRealWorkspaceFile(await variantDir(workspace),file),'utf8');
}
export async function writeVariantJson(workspace:string,file:string,value:unknown,immutable=false) {
  const dir = await variantDir(workspace,true);
  const target = await resolveRealWorkspaceFile(dir,file,{allowMissing:true});
  await resolveRealWorkspaceFile(dir,`${file}.bak`,{allowMissing:true});
  if (immutable) {
    try { await readFile(target); throw new StorageError('版本修订 ID 已存在，不会覆盖。','VARIANT_EXISTS',409); }
    catch(e) {if (!isNotFound(e)) throw e;}
  }
  await writeJsonFileAtomic(target,value,{backup:!immutable});
}
export async function readVariantConfig(workspace:string): Promise<{config:VariantConfig;revision:string}> {
  try {
    const raw = await readVariantJson(workspace,'config.json'); const value = JSON.parse(raw);
    if (value?.version !== 1 || typeof value.enabled !== 'boolean' || value.agentAutoEnroll !== undefined && typeof value.agentAutoEnroll !== 'boolean') throw new Error();
    return {config:{version:1,enabled:value.enabled,agentAutoEnroll:value.agentAutoEnroll === true},revision:revisionForContent(raw)};
  } catch(e) {if (isNotFound(e)) return {config:{version:1,enabled:false},revision:''}; if (e instanceof StorageError) throw e; throw new StorageError('版本设置损坏，已保留文件。','VARIANT_CONFIG_CORRUPT',409);}
}
export async function readFamily(workspace:string,id:string): Promise<FamilySnapshot> {
  if (!uuid(id)) throw new StorageError('原题族 ID 无效。','VARIANT_INVALID');
  const raw = await readVariantJson(workspace,`family-${id}.json`);
  const family = parseFamily(JSON.parse(raw));
  if (family.id !== id) throw new StorageError('原题族 ID 不匹配。','VARIANT_INVALID');
  return {family,revision:revisionForContent(raw)};
}
export async function familyCatalog(workspace:string) {
  const families: FamilySnapshot[] = []; const warnings: string[] = [];
  for (const file of (await variantFiles(workspace)).filter(f => /^family-.*\.json$/.test(f))) {
    try {
      const data = await readFamily(workspace,file.slice(7,-5));
      if (families.some(f => f.family.rootId === data.family.rootId)) throw new Error();
      families.push(data);
    } catch {warnings.push(`原题族文件 ${file} 无法读取，已保留；版本选题与题型修改暂停。`);}
  }
  return {families,warnings};
}
export async function writeFamily(workspace:string,family:VariantFamily) { await writeVariantJson(workspace,`family-${family.id}.json`,parseFamily(family)); return readFamily(workspace,family.id); }
export async function readRevision(workspace:string,id:string): Promise<VariantRevision> {
  if (!uuid(id)) throw new StorageError('修订 ID 无效。','VARIANT_INVALID');
  const revision = parseVariantRevision(JSON.parse(await readVariantJson(workspace,`revision-${id}.json`)));
  if (revision.id !== id) throw new StorageError('修订 ID 不匹配。','VARIANT_INVALID');
  return revision;
}
export async function enrichedRoot(workspace:string,item:QuestionItem): Promise<QuestionItem> {
  const result = structuredClone(item);
  for (const asset of result.assets) {
    const bytes = await readFile(await resolveRealWorkspaceFile(path.join(workspace,'assets'),asset.fileName));
    asset.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  return result;
}
export const basisFingerprint = (item:QuestionItem) => createHash('sha256').update(variantBasisSource(item)).digest('hex');
export async function pendingImportFamilies(workspace:string): Promise<VariantFamily[]> {
  const families: VariantFamily[]=[];
  for (const file of (await variantFiles(workspace)).filter(f => /^import-tx-.*\.json$/.test(f))) {
    const tx=JSON.parse(await readVariantJson(workspace,file));
    const write=tx.writes?.find((w:{area:string;name:string}) => w.area === 'variants' && w.name === `family-${tx.familyId}.json`);
    if (write) families.push(parseFamily(JSON.parse(write.content)));
  }
  return families;
}
export async function assertProtectedTypes(workspace:string,before:Bank,after:Bank) {
  const data = await familyCatalog(workspace);
  const changes = after.items.filter(q => {
    const previous = before.items.find(p => p.id === q.id);
    return JSON.stringify(standardKinds(q)) !== JSON.stringify(previous ? standardKinds(previous) : []);
  });
  if (data.warnings.length && changes.length) throw new StorageError(data.warnings[0],'VARIANT_METADATA_CORRUPT',409);
  const pending=await pendingImportFamilies(workspace);
  const protectedFamilies=[...data.families.map(f => f.family),...pending];
  const protectedIds = new Set(protectedFamilies.map(f => f.rootId));
  const blocked = changes.filter(q => protectedIds.has(q.id) && (before.items.some(p => p.id === q.id) || JSON.stringify(standardKinds(q)) !== JSON.stringify([protectedFamilies.find(f => f.rootId === q.id)!.originalKind])));
  if (blocked.length) throw new StorageError(`原始题型受保护，请通过专门纠错修改：${blocked.map(q => q.id).join('、')}`,'ORIGINAL_TYPE_PROTECTED',409);
}
export async function copyVariantWorkspace(source:string,target:string) {
  const files = await variantFiles(source); if (!files.length) return;
  const src = await variantDir(source); const dst = await variantDir(target,true);
  for (const file of files) await copyFile(await resolveRealWorkspaceFile(src,file),await resolveRealWorkspaceFile(dst,file,{allowMissing:true}));
}

export interface TypeCorrectionIntent { version:1; familyId:string; bankBefore:string; bankAfter:string; familyBefore:string; familyAfter:VariantFamily }
/** Runs within the workspace lock, before reading/writing a bank. Unknown external states are never overwritten. */
export async function recoverTypeCorrections(workspace:string) {
  const files = (await variantFiles(workspace).catch(() => [])).filter(f => /^type-tx-[a-f0-9-]+\.json$/.test(f));
  for (const file of files) {
    let tx: TypeCorrectionIntent;
    try {
      tx = JSON.parse(await readVariantJson(workspace,file)) as TypeCorrectionIntent;
      if (tx.version !== 1 || !uuid(tx.familyId) || file !== `type-tx-${tx.familyId}.json` || ![tx.bankBefore,tx.bankAfter,tx.familyBefore].every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) || parseFamily(tx.familyAfter).id !== tx.familyId) continue;
      const bankRaw = await readFile(path.join(workspace,'bank.json'),'utf8');
      parseV4Bank(JSON.parse(bankRaw));
      const bankHash = revisionForContent(bankRaw);
      const family = await readFamily(workspace,tx.familyId);
      if (family.family.rootId !== tx.familyAfter.rootId) continue;
      if (bankHash === tx.bankAfter) {
        if (family.revision === tx.familyBefore) await writeFamily(workspace,tx.familyAfter);
        else if (JSON.stringify(family.family) !== JSON.stringify(tx.familyAfter)) continue;
      } else if (bankHash !== tx.bankBefore || family.revision !== tx.familyBefore) continue;
      await rm(await resolveRealWorkspaceFile(await variantDir(workspace),file));
    } catch { /* Leave the intent visible for explicit reconciliation; bank access stays available. */ }
  }
}
export async function familyHasTransaction(workspace:string,id:string) {
  const files=await variantFiles(workspace);
  if (files.includes(`type-tx-${id}.json`)) return true;
  for (const file of files.filter(f => /^import-tx-.*\.json$/.test(f))) {
    const tx=JSON.parse(await readVariantJson(workspace,file));
    if (tx.familyId === id) return true;
  }
  return false;
}
