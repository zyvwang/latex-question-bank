import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateAgentImportManifest } from '../shared/agent-manifest.js';
import { parseV4Bank } from '../shared/bank-validation.js';
import type { QuestionItem, ImportBatchRecord } from '../shared/types.js';
import { isRecord, ValidationError } from '../shared/validation-primitives.js';
import { isExamKind, kindNames, normalizeVariantImages, parseVariantContent, standardKinds, uuid, type VariantFamily, type VariantRevision } from '../shared/variants.js';
import type { VariantImportResult } from '../shared/variant-import.js';
import { planBank, buildAssetPlan, collectUsedAssetKeys } from './agent-import-plan.js';
import { prepareQuestionAsset, type PreparedQuestionAsset } from './asset-service.js';
import { readBankSnapshotAt } from './bank-reader.js';
import { createHistorySnapshot } from './bank-storage.js';
import { broadcastBankChanged, broadcastVariantsChanged } from './events.js';
import { withWorkspaceWriteLock } from './storage-lock.js';
import { StorageError } from './storage-types.js';
import { revisionForContent, serializeJson } from './storage-utils.js';
import { resolveRealWorkspaceFile, assertRealWorkspaceSubdir } from './workspace-paths.js';
import { getCurrentWorkspaceDirs, getWorkspaceDirs } from './workspace-storage.js';
import { basisFingerprint, enrichedRoot, familyCatalog, familyHasTransaction, readVariantConfig, writeVariantJson } from './variant-storage.js';
import { bytesHash, finishImport, importDigest, importIntents, jsonImportWrite, readImportReceipt, type ImportIntent, type ImportWrite } from './variant-import-storage.js';

export const originalImportFingerprint = (item: QuestionItem) => importDigest(item);
function fail(message: string, code='VARIANT_IMPORT_CONFLICT'): never { throw new StorageError(message,code,409); }
export async function variantImportStatus(workspacePath: string, operationId: string, expectedDigest?: string) {
  const workspace=path.resolve(workspacePath);
  return withWorkspaceWriteLock(workspace,async () => {
    if ((await getCurrentWorkspaceDirs()).workspaceDir !== workspace) fail('联合录入目标已不是当前工作区。','WORKSPACE_CHANGED');
    const receipt=await readImportReceipt(workspace,operationId);
    if (receipt) {
      if (expectedDigest && expectedDigest !== receipt.digest) fail('操作 ID 已用于其他内容。','VARIANT_OPERATION_REUSED');
      return {status:'completed',digest:receipt.digest,result:receipt.result};
    }
    const intent=(await importIntents(workspace)).find(i => i.operationId === operationId);
    return {status:intent ? 'isolated' : 'not-found',operationId};
  });
}
export async function importVariantGroup(workspacePath: string, group: unknown, dryRun=false): Promise<VariantImportResult> {
  const workspace=path.resolve(workspacePath);
  if (!isRecord(group) || !uuid(group.operationId) || !isRecord(group.original) || !Array.isArray(group.variants) || group.variants.length > 100 || !Array.isArray(group.refusals) || group.refusals.length > 100 || !group.variants.length && !group.refusals.length) throw new ValidationError('联合录入组需要稳定 operationId、original、variants 和 refusals；零版本时必须说明拒绝转换理由。');
  const digest=importDigest(group);
  return withWorkspaceWriteLock(workspace,async () => {
    if ((await getCurrentWorkspaceDirs()).workspaceDir !== workspace) fail('联合录入目标已不是当前工作区。','WORKSPACE_CHANGED');
    const receipt=await readImportReceipt(workspace,group.operationId as string);
    if (receipt) {
      if (receipt.digest !== digest) fail('同一 operationId 的内容不同。','VARIANT_OPERATION_REUSED');
      return {...receipt.result,...(dryRun?{status:'dry-run' as const}:{})};
    }
    const intents=await importIntents(workspace);
    if (intents.some(i => i.operationId === group.operationId)) fail('该组事务待人工核对，请查询结果并保留文件。','VARIANT_IMPORT_ISOLATED');
    const {config}=await readVariantConfig(workspace);
    if (!config.enabled || config.agentAutoEnroll !== true) throw new StorageError('请由用户开启版本管理及允许 Agent 自动纳管新题和指定旧题。','VARIANT_AUTO_ENROLL_DISABLED',403);
    const snapshot=await readBankSnapshotAt(workspace); const catalog=await familyCatalog(workspace);
    if (catalog.warnings.length) fail(catalog.warnings[0],'VARIANT_METADATA_CORRUPT');
    const now=new Date().toISOString(); const writes: ImportWrite[]=[];
    let nextBank=structuredClone(snapshot.bank); let root: QuestionItem; let batchId: string|null=null;
    let bookTitles: string[]=[];
    const original=group.original as Record<string,unknown>;
    const preparedByKey=new Map<string,PreparedQuestionAsset>();
    const newAssetBytes=new Map<string,Buffer>();
    const attachmentRefs=new Map<string,string>();
    if (original.kind === 'new') {
      const parsed=validateAgentImportManifest(original.manifest);
      if (!parsed.ok || !parsed.value) throw new ValidationError(parsed.error ?? '原题清单无效。');
      const manifest=parsed.value;
      if (manifest.questions.length !== 1 || !manifest.questions[0].id || manifest.bank || manifest.chapters?.length || manifest.batch) throw new ValidationError('新原题 manifest 必须只有一道带固定 id 的题，不含 bank、chapters 或 batch；批次 ID 使用 operationId。');
      if (intents.some(i => i.rootId === manifest.questions[0].id) || nextBank.items.some(q => q.id === manifest.questions[0].id) || catalog.families.some(f => f.family.rootId === manifest.questions[0].id || f.family.versions.some(v => v.id === manifest.questions[0].id))) fail('原题 ID 已存在，不会覆盖或自动关联。');
      if (!Array.isArray(group.uploads) && (manifest.assets?.length ?? 0)>0) throw new ValidationError('缺少原题附件 uploads。');
      const uploads=Array.isArray(group.uploads)?group.uploads:[];
      if (uploads.length !== (manifest.assets?.length ?? 0)) throw new ValidationError('附件数量与原题清单不符。');
      for (const asset of manifest.assets ?? []) {
        const upload=uploads.find(u => isRecord(u) && u.key === asset.key);
        if (!isRecord(upload) || typeof upload.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(upload.base64) || typeof upload.mimeType !== 'string') throw new ValidationError('附件必须包含 key、mimeType 和有效 base64。');
        const buffer=Buffer.from(upload.base64,'base64');
        if (!buffer.length || buffer.length>8*1024*1024) throw new ValidationError('单附件必须为 1 字节至 8 MB。');
        preparedByKey.set(asset.key,await prepareQuestionAsset({buffer,mimetype:upload.mimeType,originalname:asset.originalName,size:buffer.length}));
      }
      const assetPlan=buildAssetPlan(nextBank,collectUsedAssetKeys(manifest),preparedByKey);
      for (const [key,asset] of assetPlan.assetsByKey) attachmentRefs.set(key,asset.relativePath);
      batchId=group.operationId as string;
      if (nextBank.imports.some(i => i.id === batchId)) fail('操作 ID 已被其他导入批次使用。');
      // Ordinary imports interpret id as an update target. This path only creates; assign the checked fixed ID after planning.
      const newId=manifest.questions[0].id;
      const plan=planBank({current:nextBank,manifest:{...manifest,questions:[{...manifest.questions[0],id:undefined}]},batchId,now,overwrite:false,assetsByKey:assetPlan.assetsByKey});
      if (plan.updatedIds.length || plan.conflicts.length || plan.createdIds.length !== 1) fail('来源题号或 ID 已存在，不会覆盖或自动关联。');
      nextBank=plan.bank; bookTitles=[...plan.bookTitles]; root=nextBank.items.find(q => q.id === plan.createdIds[0])!;root.id=newId;
      for (const prepared of assetPlan.toWrite) {
        newAssetBytes.set(prepared.asset.fileName,prepared.buffer);
        writes.push({area:'assets',name:prepared.asset.fileName,before:null,content:prepared.buffer.toString('base64'),binary:true});
      }
    } else if (original.kind === 'existing') {
      const found=nextBank.items.find(q => q.id === original.id);
      if (!found) fail('指定原题不存在。');
      root=await enrichedRoot(workspace,found);
      if (original.fingerprint !== originalImportFingerprint(root)) fail('指定原题内容、题型或附件已变化，请重新读取。');
      if (group.uploads !== undefined) throw new ValidationError('旧题不能通过联合录入覆盖附件。');
    } else throw new ValidationError('original.kind 必须是 new 或 existing。');
    const kinds=standardKinds(root);
    if (kinds.length !== 1) throw new ValidationError('原题必须已有唯一标准题型，请由用户整理。');
    const existing=catalog.families.find(f => f.family.rootId === root.id);
    if (original.kind === 'existing' && (original.familyId !== (existing?.family.id ?? null) || existing && original.revision !== existing.revision)) fail('原题关联或族 revision 已变化，请重新读取。');
    if (intents.some(i => i.rootId === root.id) || existing && await familyHasTransaction(workspace,existing.family.id)) fail('原题族事务尚未核对。','VARIANT_IMPORT_ISOLATED');
    if (existing && existing.family.originalKind !== kinds[0]) fail('受保护的原始题型不一致。','ORIGINAL_TYPE_PROTECTED');
    const family: VariantFamily=existing ? structuredClone(existing.family) : {schemaVersion:1,id:randomUUID(),rootId:root.id,originalKind:kinds[0],typeEpoch:1,createdAt:now,corrections:[],versions:[],refusals:[]};
    // Validate and cache bytes before any history, journal, attachment or metadata is written.
    const bytes=new Map(newAssetBytes);
    for (const asset of root.assets) {
      let buffer=bytes.get(asset.fileName);
      if (!buffer) buffer=await readFile(await resolveRealWorkspaceFile(path.join(workspace,'assets'),asset.fileName));
      await prepareQuestionAsset({buffer,mimetype:asset.mimeType,originalname:asset.fileName,size:buffer.length});
      asset.sha256=bytesHash(buffer); bytes.set(asset.fileName,buffer);
    }
    const fingerprint=basisFingerprint(root);
    const copyMaterial=(source: QuestionItem) => {
      const item=structuredClone(source);
      for (const asset of item.assets) {
        const name=`asset-${randomUUID()}${path.extname(asset.fileName)}`;
        writes.push({area:'variants',name,before:null,content:bytes.get(asset.fileName)!.toString('base64'),binary:true});
        for (const module of Object.values(item.modules)) module.tex=module.tex.replaceAll(asset.relativePath,`assets/${name}`);
        asset.fileName=name;asset.relativePath=`assets/${name}`;
      }
      return item;
    };
    if (!existing) family.baseline=copyMaterial(root);
    const ids=new Set([...intents.flatMap(i => i.result.variantIds),...nextBank.items.map(q => q.id),...catalog.families.flatMap(f => [f.family.rootId,...f.family.versions.map(v => v.id)])]);
    const variantIds: string[]=[];
    for (const value of group.variants as unknown[]) {
      if (!isRecord(value) || !uuid(value.id) || ids.has(value.id)) throw new ValidationError('版本必须带未使用的固定 UUID id。');
      ids.add(value.id);variantIds.push(value.id);
      const content=parseVariantContent(value.content,family.originalKind);
      for (const key of ['question','solution','answer'] as const) {
        const tex=content[key].replace(/\{\{asset:\s*([^}]*)\}\}/g,(_match,raw:string) => {
          const ref=attachmentRefs.get(raw.trim());
          if (!ref) throw new ValidationError('版本引用的附件 key 不属于新原题。');
          return ref;
        });
        content[key]=normalizeVariantImages(tex,root.assets);
      }
      const base=copyMaterial(root);
      const item=copyMaterial({...structuredClone(root),id:value.id,questionTypes:[kindNames[content.targetKind]],solutionSource:'agent',solutionRef:null,reviewStatus:'pending',modules:{question:{tex:content.question},solution:{tex:content.solution},note:{tex:''}}});
      root.assets.forEach((a,i) => {content.answer=content.answer.replaceAll(a.relativePath,item.assets[i].relativePath);});
      content.question=item.modules.question.tex;content.solution=item.modules.solution.tex;
      const revision: VariantRevision={schemaVersion:1,id:randomUUID(),variantId:value.id,familyId:family.id,content,item,base,baseFingerprint:fingerprint,typeEpoch:family.typeEpoch,createdAt:now,generator:'agent'};
      family.versions.push({id:value.id,currentRevision:revision.id,history:[revision.id],revisionHashes:{[revision.id]:revisionForContent(serializeJson(revision))},status:'pending',approvedFingerprint:null,approvedEpoch:null,reviewedAt:null});
      writes.push(jsonImportWrite('variants',`revision-${revision.id}.json`,revision));
    }
    for (const value of group.refusals as unknown[]) {
      if (!isRecord(value) || !isExamKind(value.targetKind) || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length>1000) throw new ValidationError('拒绝转换记录需要 targetKind 与明确 reason（至多 1000 字）。');
      family.refusals.push({targetKind:value.targetKind,reason:value.reason,baseFingerprint:fingerprint,at:now});
    }
    const result: VariantImportResult={operationId:group.operationId as string,status:dryRun?'dry-run':'completed',familyId:family.id,rootId:root.id,variantIds,pendingCount:variantIds.length+(original.kind==='new'?1:0),batchId};
    // Resolve every destination, including backup paths, during dry-run as well.
    writes.push(jsonImportWrite('variants',`family-${family.id}.json`,family,existing?.revision ?? null));
    for (const write of writes) {
      const dir=path.join(workspace,write.area);
      const file=await resolveRealWorkspaceFile(dir,write.name,{allowMissing:true});
      await resolveRealWorkspaceFile(dir,`${write.name}.bak`,{allowMissing:true});
      if (write.before === null) {try {await readFile(file);fail('目标文件已存在。');} catch(e) {if (!(isRecord(e) || e instanceof Error) || !('code' in e) || e.code !== 'ENOENT') throw e;}}
    }
    if (batchId) await assertRealWorkspaceSubdir(path.join(workspace,'.history'));
    parseV4Bank(nextBank);
    if (original.kind === 'existing') {
      const raw=await readFile(path.join(workspace,'bank.json'),'utf8');
      writes.unshift({area:'bank',name:'bank.json',before:snapshot.revision,content:raw});
    }
    if (dryRun) return result;
    if (batchId) {
      const raw=await readFile(path.join(workspace,'bank.json'),'utf8');
      const historySnapshot=await createHistorySnapshot(getWorkspaceDirs(workspace),raw,snapshot.revision);
      const record: ImportBatchRecord={id:batchId,createdAt:now,note:'Agent 原题与版本联合录入',bookTitles,newCount:1,updatedCount:0,skippedCount:0,conflictCount:0,itemIds:[root.id],updatedItemIds:[],historySnapshot,status:'completed',undoneAt:null};
      nextBank.imports=[record,...nextBank.imports].slice(0,50);
      writes.splice(writes.length-1,0,jsonImportWrite('bank','bank.json',parseV4Bank(nextBank),snapshot.revision));
    }
    const intent: ImportIntent={version:1,operationId:result.operationId,digest,familyId:family.id,rootId:root.id,writes,result};
    await writeVariantJson(workspace,`import-tx-${result.operationId}.json`,intent,true);
    if (!await finishImport(workspace,intent)) fail('文件出现未知修改，已保留事务并隔离该组。','VARIANT_IMPORT_ISOLATED');
    if (batchId) broadcastBankChanged({workspacePath:workspace,revision:revisionForContent(serializeJson(nextBank)),source:'agent-import',batchId,counts:{created:1,updated:0,skipped:0,conflicts:0,assets:newAssetBytes.size}});
    broadcastVariantsChanged({workspacePath:workspace,source:'agent'});
    return result;
  });
}
