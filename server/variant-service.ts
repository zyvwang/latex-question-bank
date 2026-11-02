import { originalImportFingerprint } from './variant-import-service.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canConvert, isExamKind, needsReview, kindNames, normalizeVariantImages, parseVariantContent, standardKinds, uuid, type FamilyView, type VariantEntry, type VariantFamily, type VariantQueue, type VariantRevision } from '../shared/variants.js';
import { isRecord, requiredString, ValidationError } from '../shared/validation-primitives.js';
import type { BankSnapshot, QuestionItem } from '../shared/types.js';
import { readBankSnapshotAt } from './bank-reader.js';
import { createHistorySnapshot } from './bank-storage.js';
import { writeJsonFileAtomic } from './json-file.js';
import { prepareQuestionAsset } from './asset-service.js';
import { withWorkspaceWriteLock } from './storage-lock.js';
import { getCurrentWorkspaceDirs, getWorkspaceDirs } from './workspace-storage.js';
import { resolveRealWorkspaceFile } from './workspace-paths.js';
import { StorageError } from './storage-types.js';
import { revisionForContent, serializeJson } from './storage-utils.js';
import { basisFingerprint, enrichedRoot, familyCatalog, pendingImportFamilies, familyHasTransaction, readFamily, readRevision, readVariantConfig, readVariantJson, variantDir, writeFamily, writeVariantJson } from './variant-storage.js';
import { broadcastPaperChanged, broadcastVariantsChanged } from './events.js';

function conflict(actual:string,expected:unknown,code='VARIANT_CONFLICT') { if (actual !== expected) throw new StorageError('版本或原题已变化，请核对后重试。',code,409); }
export async function familyView(workspace:string,id:string,bank:BankSnapshot): Promise<FamilyView> {
  const data = await readFamily(workspace,id); const family = data.family;
  const root = bank.bank.items.find(q => q.id === family.rootId) ?? null;
  let fingerprint: string | null = null; let warning: string | undefined;
  try { if (root) fingerprint = basisFingerprint(await enrichedRoot(workspace,root)); }
  catch {warning='原题附件缺失或路径无效，版本暂停入卷。';}
  const mismatch = !!root && JSON.stringify(standardKinds(root)) !== JSON.stringify([family.originalKind]);
  const blocked = await familyHasTransaction(workspace,id) || mismatch;
  if (blocked) warning='原题型或纠错事务需要核对，请使用专门纠错重新确认。';
  const rows = [];
  for (const entry of family.versions) {
    for (const id of entry.history) if (revisionForContent(await readVariantJson(workspace,`revision-${id}.json`)) !== entry.revisionHashes[id]) throw new StorageError('修订文件内容与登记哈希不一致，已暂停此族，请核对原文件。','VARIANT_REVISION_CHANGED',409);
    const revision = await readRevision(workspace,entry.currentRevision);
    if (revision.variantId !== entry.id || revision.familyId !== id || !entry.history.includes(revision.id)) throw new StorageError('版本引用不匹配。','VARIANT_INVALID');
    const basis = entry.status === 'approved' ? entry.approvedFingerprint : revision.baseFingerprint;
    const epoch = entry.status === 'approved' ? entry.approvedEpoch : revision.typeEpoch;
    let intact=true;
    try {for (const asset of [...revision.item.assets,...revision.base.assets]) {
      const bytes=await readFile(await resolveRealWorkspaceFile(await variantDir(workspace),asset.fileName));
      if (!asset.sha256 || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) intact=false;
    }} catch {intact=false;}
    const state = !intact ? '附件需核对' : !root ? '原题缺失' : blocked ? '待核对' : !canConvert(family.originalKind,revision.content.targetKind) ? '题型不允许' : fingerprint !== basis || epoch !== family.typeEpoch ? '待复核' : entry.status === 'pending' ? '待审阅' : entry.status === 'rejected' ? '已拒绝' : entry.status === 'withdrawn' ? '已撤回' : root.reviewStatus !== 'approved' ? '原题待审阅' : '已批准';
    const history=await Promise.all(entry.history.map(h => readRevision(workspace,h)));
    if (history.some(h => h.variantId !== entry.id || h.familyId !== family.id || h.base.id !== family.rootId)) throw new ValidationError('版本历史引用不匹配。');
    rows.push({entry,revision,history,state,eligible:state === '已批准'});
  }
  return {...data,root,rows,rootFingerprint:fingerprint,warning,blocked};
}
async function copyMaterial(workspace:string,item:QuestionItem,source:'assets'|'variants'): Promise<QuestionItem> {
  const result = structuredClone(item); const dir = await variantDir(workspace,true);
  for (const a of result.assets) {
    const bytes = await readFile(await resolveRealWorkspaceFile(path.join(workspace,source),a.fileName));
    const prepared = await prepareQuestionAsset({buffer:bytes,mimetype:a.mimeType,originalname:a.fileName,size:bytes.length});
    const name = `asset-${crypto.randomUUID()}${path.extname(a.fileName).toLowerCase()}`;
    await writeFile(await resolveRealWorkspaceFile(dir,name,{allowMissing:true}),bytes,{flag:'wx'});
    for (const module of Object.values(result.modules)) module.tex = module.tex.replaceAll(a.relativePath,`assets/${name}`).replaceAll(`assets/${a.fileName}`,`assets/${name}`);
    a.fileName=name; a.relativePath=`assets/${name}`; a.sha256=prepared.asset.sha256;
  }
  return result;
}
export async function variantOperation(workspacePath:string,action:string,body:Record<string,unknown>,agent=false) {
  const workspace = path.resolve(workspacePath);
  return withWorkspaceWriteLock(workspace,async () => {
    if ((await getCurrentWorkspaceDirs()).workspaceDir !== workspace) throw new StorageError('版本管理目标已不是当前工作区。','WORKSPACE_CHANGED',409);
    if (agent && !['list','read','read-original','propose','revise','refuse'].includes(action)) throw new StorageError('Agent 不可启用、纠错或审批版本。','VARIANT_FORBIDDEN',403);
    const dryRun = body.dryRun === true;
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean' || dryRun && !['propose','revise','refuse','create-family'].includes(action)) throw new ValidationError('dryRun 参数无效。');
    const config = await readVariantConfig(workspace); const bank = await readBankSnapshotAt(workspace);
    const catalog = await familyCatalog(workspace);
    const notify = () => broadcastVariantsChanged({workspacePath:workspace,source:agent?'agent':'ui'});
    if (action === 'list') return {config:config.config,configRevision:config.revision,...catalog,warnings:[...catalog.warnings,...(await pendingImportFamilies(workspace)).map(f => `联合录入原题 ${f.rootId} 的事务尚待核对，该族已暂停入卷。`)],bankRevision:bank.revision};
    if (action === 'read-original') {
      const item=bank.bank.items.find(q => q.id === body.rootId);
      if (!item) throw new ValidationError('指定原题不存在。');
      const root=await enrichedRoot(workspace,item);
      const family=catalog.families.find(f => f.family.rootId === root.id) ?? null;
      return {root,fingerprint:originalImportFingerprint(root),familyId:family?.family.id ?? null,revision:family?.revision ?? null};
    }
    if (action === 'set-agent-auto-enroll') {
      conflict(config.revision,body.configRevision);
      if (typeof body.allowed !== 'boolean' || body.allowed && !config.config.enabled) throw new ValidationError('需先开启版本管理，并提供布尔值 allowed。');
      await writeVariantJson(workspace,'config.json',{...config.config,agentAutoEnroll:body.allowed}); notify(); return readVariantConfig(workspace);
    }
    if (action === 'set-enabled') {
      conflict(config.revision,body.configRevision);
      if (typeof body.enabled !== 'boolean') throw new ValidationError('enabled 必须是布尔值。');
      await writeVariantJson(workspace,'config.json',{...config.config,version:1,enabled:body.enabled}); notify(); return readVariantConfig(workspace);
    }
    if (action === 'read') return familyView(workspace,requiredString(body,'familyId'),bank);
    if (action === 'queue') {
      const order = new Map(bank.bank.items.map((item,index) => [item.id,index]));
      const warnings = [...catalog.warnings];
      const families: VariantQueue['families'] = [];
      for (const {family} of config.config.enabled ? catalog.families : []) {
        try {
          const view = await familyView(workspace,family.id,bank);
          const rows = view.rows.filter(needsReview).map(row => ({...row,history:[]}));
          // Missing or quarantined originals cannot be approved; they stay in the family manager.
          if (rows.length && view.root && !view.blocked) families.push({...view,rows});
        } catch (error) {warnings.push(`原题族 ${family.id} 无法读取：${error instanceof Error ? error.message : '未知错误'}`);}
      }
      families.sort((a,b) => (order.get(a.family.rootId) ?? 0)-(order.get(b.family.rootId) ?? 0));
      return {enabled:config.config.enabled,families,total:families.reduce((sum,f) => sum+f.rows.length,0),warnings} satisfies VariantQueue;
    }
    if (!config.config.enabled && action !== 'correct-type') throw new StorageError('请由用户在应用中开启版本管理。','VARIANTS_DISABLED',409);
    if (catalog.warnings.length) throw new StorageError(catalog.warnings[0],'VARIANT_METADATA_CORRUPT',409);
    conflict(bank.revision,body.bankRevision,'BANK_CONFLICT');
    if (action === 'create-family') {
      const root = bank.bank.items.find(q => q.id === body.rootId);
      if (!root || !isExamKind(body.originalKind) || JSON.stringify(standardKinds(root)) !== JSON.stringify([body.originalKind])) throw new ValidationError('请先为原题整理唯一标准题型，再确认纳入版本管理。');
      if (catalog.families.some(f => f.family.rootId === root.id)) throw new StorageError('原题已纳入版本管理。','VARIANT_EXISTS',409);
      const family: VariantFamily = {schemaVersion:1,id:crypto.randomUUID(),rootId:root.id,originalKind:body.originalKind,typeEpoch:1,createdAt:new Date().toISOString(),corrections:[],versions:[],refusals:[]};
      if (dryRun) return {dryRun:true,family};
      family.baseline=await copyMaterial(workspace,await enrichedRoot(workspace,root),'assets');
      const result=await writeFamily(workspace,family); notify(); return result;
    }
    const view = await familyView(workspace,requiredString(body,'familyId'),bank);
    conflict(view.revision,body.revision);
    const family = structuredClone(view.family);
    if (action === 'correct-type') {
      if (!view.root || !isExamKind(body.originalKind) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) throw new ValidationError('纠错需要现存原题、新题型和明确理由。');
      const from = family.originalKind; family.originalKind=body.originalKind; family.typeEpoch++;
      family.corrections.push({from,to:body.originalKind,reason:body.reason,at:new Date().toISOString()});
      const next = structuredClone(bank.bank); const root = next.items.find(q => q.id === family.rootId)!;
      root.questionTypes=[...root.questionTypes.filter(t => !Object.values(kindNames).includes(t)),kindNames[body.originalKind]]; root.updatedAt=new Date().toISOString();
      const raw = serializeJson(next);
      const intent={version:1,familyId:family.id,bankBefore:bank.revision,bankAfter:revisionForContent(raw),familyBefore:view.revision,familyAfter:family};
      const file=`type-tx-${family.id}.json`;
      // A stale previous intent is replaced only by this explicit human reconciliation.
      await writeVariantJson(workspace,file,intent);
      await createHistorySnapshot(getWorkspaceDirs(workspace),serializeJson(bank.bank),bank.revision);
      await writeJsonFileAtomic(path.join(workspace,'bank.json'),next);
      await writeFamily(workspace,family);
      // The next lock acquisition finalizes the journal by comparing both committed hashes.
      notify(); broadcastPaperChanged({workspacePath:workspace,revision:'',source:'ui'});
      return {snapshot:await readBankSnapshotAt(workspace),family:await readFamily(workspace,family.id)};
    }
    if (!view.root || !view.rootFingerprint || view.blocked) throw new StorageError('原题缺失或需要核对，不能生成或审批版本。','VARIANT_SOURCE_UNAVAILABLE',409);
    const root = view.root;
    if (action === 'refuse') {
      if (!isExamKind(body.targetKind) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) throw new ValidationError('拒绝转换需要目标题型和理由。');
      if (body.rootFingerprint !== view.rootFingerprint) throw new StorageError('原题内容已变化。','BANK_CONFLICT',409);
      family.refusals.push({targetKind:body.targetKind,reason:body.reason,baseFingerprint:view.rootFingerprint,at:new Date().toISOString()});
    } else if (action === 'propose' || action === 'revise') {
      if (body.rootFingerprint !== view.rootFingerprint) throw new StorageError('原题内容已变化。','BANK_CONFLICT',409);
      const content = parseVariantContent(body.content,family.originalKind);
      let entry: VariantEntry;
      if (action === 'propose') {
        if (!uuid(body.variantId) || bank.bank.items.some(q => q.id === body.variantId) || family.versions.some(v => v.id === body.variantId) || catalog.families.some(f => f.family.versions.some(v => v.id === body.variantId))) throw new StorageError('版本 ID 无效或已存在。','VARIANT_EXISTS',409);
        entry={id:body.variantId,currentRevision:'',history:[],revisionHashes:{},status:'pending',approvedFingerprint:null,approvedEpoch:null,reviewedAt:null}; family.versions.push(entry);
      } else {
        const found=family.versions.find(v => v.id === body.variantId); if (!found) throw new ValidationError('找不到待修订版本。'); entry=found;
        conflict(entry.currentRevision,body.versionRevision);
      }
      let sourceAssets=root.assets;
      let base = await enrichedRoot(workspace,root);
      let item: QuestionItem = {...structuredClone(base),id:entry.id,questionTypes:[kindNames[content.targetKind]],solutionSource:agent?'agent':'user',solutionRef:null,reviewStatus:'pending',modules:{question:{tex:content.question},solution:{tex:content.solution},note:{tex:''}}};
      if (action === 'revise') {
        const previous=await readRevision(workspace,entry.currentRevision);
        sourceAssets=previous.item.assets;
        item.assets=structuredClone(previous.item.assets);
      }
      for (const key of ['question','solution','answer'] as const) content[key]=normalizeVariantImages(content[key],sourceAssets);
      item.modules.question.tex=content.question;item.modules.solution.tex=content.solution;
      if (!dryRun) item=await copyMaterial(workspace,item,action === 'revise'?'variants':'assets');
      if (!dryRun) base=await copyMaterial(workspace,base,'assets');
      let answer=content.answer;
      sourceAssets.forEach((a,i) => {answer=answer.replaceAll(a.relativePath,item.assets[i].relativePath).replaceAll(`assets/${a.fileName}`,item.assets[i].relativePath);});
      const storedContent={...content,answer,question:item.modules.question.tex,solution:item.modules.solution.tex};
      const revision: VariantRevision={schemaVersion:1,id:crypto.randomUUID(),variantId:entry.id,familyId:family.id,content:storedContent,item,base,baseFingerprint:view.rootFingerprint,typeEpoch:family.typeEpoch,createdAt:new Date().toISOString(),generator:agent ? 'agent' : 'user'};
      entry.revisionHashes[revision.id]=revisionForContent(serializeJson(revision));
      entry.currentRevision=revision.id; entry.history.push(revision.id); entry.status='pending'; entry.reviewedAt=null; entry.approvedEpoch=null; entry.approvedFingerprint=null;
      if (dryRun) return {dryRun:true,family,revision};
      await writeVariantJson(workspace,`revision-${revision.id}.json`,revision,true);
    } else if (action === 'review') {
      if (body.rootFingerprint !== view.rootFingerprint) throw new StorageError('原题内容已变化，请重新对照。','BANK_CONFLICT',409);
      if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 100 || root.reviewStatus !== 'approved') throw new ValidationError('先批准原题，再勾选当前族的 1 至 100 个版本。');
      const seen=new Set<string>();
      for (const decision of body.entries) {
        if (!isRecord(decision) || typeof decision.variantId !== 'string' || seen.has(decision.variantId)) throw new ValidationError('审阅项重复或无效。');
        seen.add(decision.variantId);
        const entry=family.versions.find(v => v.id === decision.variantId); if (!entry) throw new ValidationError('版本不属于当前原题族。');
        conflict(entry.currentRevision,decision.versionRevision);
        const revision=await readRevision(workspace,entry.currentRevision);
        if (decision.action === 'approve') {
          if (view.rows.find(r => r.entry.id === entry.id)?.state === '附件需核对') throw new ValidationError('版本附件不完整或已变化，请恢复文件后重试。');
          if (!canConvert(family.originalKind,revision.content.targetKind)) throw new ValidationError('版本不符合纠错后的转换限制。');
          if ((revision.baseFingerprint !== view.rootFingerprint || revision.typeEpoch !== family.typeEpoch) && decision.confirmCurrentBasis !== true) throw new ValidationError('基准已变化，请对照当前原题并明确确认所有条件与目标一致。');
          entry.status='approved'; entry.approvedFingerprint=view.rootFingerprint; entry.approvedEpoch=family.typeEpoch;
        } else if (decision.action === 'reject') entry.status='rejected';
        else if (decision.action === 'withdraw') entry.status='withdrawn';
        else throw new ValidationError('审批操作无效。');
        entry.reviewedAt=new Date().toISOString();
        (entry.reviews ??= []).push({revision:entry.currentRevision,action:String(decision.action),fingerprint:view.rootFingerprint,epoch:family.typeEpoch,at:entry.reviewedAt});
      }
    } else throw new ValidationError('未知版本操作。');
    if (dryRun) return {dryRun:true,family};
    const result=await writeFamily(workspace,family); notify(); return result;
  });
}
