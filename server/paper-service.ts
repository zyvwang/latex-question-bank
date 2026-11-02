import { paperVariantCandidates } from './variant-candidates.js';
import { parseRef, refKey } from '../shared/variants.js';
import path from 'node:path';
import { classify, configureQuota, fillPaper, candidatePool, makeSlots, matchesSlot, parsePaper, parsePaperSettings, slotProblems, type PaperCandidate, type Paper, type PaperSlot, type PaperSnapshot } from '../shared/papers.js';
import { blueprintId, historicalTopics, topicGroups, type TopicStamp, type TopicStore } from '../shared/paper-topics.js';
import { readBankSnapshotAt } from './bank-reader.js';
import { withWorkspaceWriteLock } from './storage-lock.js';
import { getCurrentWorkspaceDirs } from './workspace-storage.js';
import { StorageError } from './storage-types.js';
import { isNotFound } from './storage-utils.js';
import { checkRevision, copyPaperAttachments, deletePaper, listPapers, readPaper, readPaperSettings, savePaperSettings, writePaper } from './paper-storage.js';
import { isRecord, requiredString, ValidationError } from '../shared/validation-primitives.js';
import type { Bank } from '../shared/types.js';
import { exportPaper } from './paper-export.js';
import { changeTopics, liveTopicGroups, questionFingerprint, readTopicStore, requireBankRevision, requireTopicsRevision, topicRows } from './paper-topic-service.js';
import { broadcastPaperChanged } from './events.js';

export function paperReport(bank: Bank, paper: Paper, groups: Record<string, TopicStamp>, prepared?: PaperCandidate[]) {
  const buckets = new Map<string, { section: PaperSlot['section']; subject: PaperSlot['subject']; groupId: string; target: number; selected: number; available: number }>();
  for (const slot of paper.slots) {
    if (!slot.requiredGroup) continue;
    const key = `${slot.section}:${slot.subject}:${slot.requiredGroup}`;
    const row = buckets.get(key) ?? { section: slot.section, subject: slot.subject, groupId: slot.requiredGroup, target: 0, selected: 0, available: new Set((prepared ?? bank.items.map(item => ({item,origin:{rootId:item.id},topic:groups[item.id] ?? null}))).filter(c => matchesSlot(c.item,slot,paper,c.topic)).map(c => c.origin.rootId)).size };
    row.target++;
    if (slot.snapshot && matchesSlot(slot.snapshot,slot,paper)) row.selected++;
    buckets.set(key,row);
  }
  const excluded: Record<string, number> = {};
  for (const item of bank.items) {
    const section = classify(item,paper.rules);
    const subject = item.chapterId ? paper.rules.chapters[item.chapterId] : null;
    const reason = item.reviewStatus !== 'approved' ? '待审阅'
      : !section ? '题型未归类或跨部分冲突'
      : paper.kind === 'mock' && !subject ? '章节未映射学科'
      : paper.quota.enabled && !groups[item.id] ? '主考点未确认或已过期'
      : paper.quota.enabled && groups[item.id] && topicGroups.find(g => g.id === groups[item.id].groupId)?.subject !== subject ? '主考点与章节学科冲突'
      : !paper.slots.some(slot => matchesSlot(item,slot,paper,groups[item.id] ?? null)) ? '不符合本卷配额或筛选条件' : '';
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
  }
  return { problems: slotProblems(paper), quotas: [...buckets.values()], excluded };

}
function attachTopics(paper: Paper, store: TopicStore): Paper {
  return { ...paper, slots: paper.slots.map(slot => {
    const stamp = slot.snapshot ? store.items[slot.snapshot.id]?.approved : null;
    return { ...slot, topic: stamp && slot.snapshot && stamp.fingerprint === questionFingerprint(slot.snapshot) ? stamp : slot.topic };
  }) };
}
function slotIndex(value: unknown, paper: Paper): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= paper.slots.length) throw new ValidationError('题位无效。');
  return Number(value);
}
function assignments(value: unknown, paper: Paper): { indices: number[]; manual: Record<number,string> } {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new ValidationError('请指定 1 至 200 个题位。');
  const manual: Record<number,string> = {};
  const indices: number[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw new ValidationError('选题清单项无效。');
    const i = slotIndex(Number(entry.number) - 1,paper);
    if (typeof entry.number !== 'number' || indices.includes(i)) throw new ValidationError('题号重复或无效。');
    indices.push(i);
    if (entry.ref !== undefined) manual[i] = parseRef(entry.ref).id;
    else if (entry.itemId !== undefined) manual[i] = requiredString(entry,'itemId');
  }
  return { indices, manual };
}
export async function paperOperation(workspacePath: string, action: string, body: Record<string, unknown>, options: { agent?: boolean } = {}) {
  const workspace = path.resolve(workspacePath);
  return withWorkspaceWriteLock(workspace, async () => {
    if ((await getCurrentWorkspaceDirs()).workspaceDir !== workspace) throw new StorageError('组卷目标已不是当前工作区。', 'WORKSPACE_CHANGED', 409);
    const agent = options.agent === true;
    if (agent && !['list','catalog','topics-read','topics-propose','read','candidates','create','generate','replace','export'].includes(action)) throw new StorageError('Agent 无此组卷权限。','PAPER_AGENT_FORBIDDEN',403);
    if (body.dryRun === true && !['create','generate','replace','topics-propose','topics-review'].includes(action)) throw new ValidationError('此操作不支持 dry-run。');
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw new ValidationError('dryRun 必须是布尔值。');
    const dryRun = body.dryRun === true;
    const id = () => requiredString(body, 'id');
    const current = async () => {
      const result = await readPaper(workspace, id());
      checkRevision(result.revision, requiredString(body, 'revision'));
      return result;
    };
    const commit = async (paper: Paper) => {
      const result = await writePaper(workspace,paper);
      broadcastPaperChanged({ workspacePath: workspace, id: paper.id, revision: result.revision, source: agent ? "agent" : "ui" });
      return result;
    };
    if (action === 'list') return listPapers(workspace);
    if (action === 'settings') return readPaperSettings(workspace);
    if (action === 'save-settings') return savePaperSettings(workspace, parsePaperSettings(body.settings), requiredString(body, 'revision'));

    if (action === 'read' && !agent) return readPaper(workspace,id());
    const bank = await readBankSnapshotAt(workspace);
    if (action === 'topics-read') return topicRows(bank);
    if (action === 'topics-propose' || action === 'topics-review') {
      if (action === 'topics-propose' && body.schemaVersion !== 1) throw new ValidationError('分类清单版本必须为 1。');
      const result = await changeTopics(bank,body,action === 'topics-propose',dryRun);
      if (!dryRun) broadcastPaperChanged({ workspacePath: workspace, revision: result.revision, topics: true, source: agent ? "agent" : "ui" });
      return result;
    }
    let topics: Awaited<ReturnType<typeof readTopicStore>>;
    let topicsError: StorageError | null = null;
    try { topics = await readTopicStore(workspace); }
    catch(e) {
      // A damaged sidecar must not prevent legacy papers from opening or exporting.
      if (!(e instanceof StorageError) || e.code !== 'PAPER_TOPICS_CORRUPT') throw e;
      topicsError = e;
      topics = { store: { version: 1, items: {} }, revision: '' };
    }
    if (action === 'catalog') return { schemaVersion: 1, blueprintId, groups: topicGroups, historicalTopics, bankRevision: bank.revision, topicsRevision: topics.revision, warning: topicsError?.message };
    const groups = liveTopicGroups(bank,topics.store);
    if (action === 'read') {
      const saved=await readPaper(workspace,id());
      let pool:PaperCandidate[]|undefined;let warning:string|undefined;
      try {pool=await paperVariantCandidates(workspace,bank,saved.paper,groups);} catch {warning='版本库无法读取，已保存试卷快照仍可使用；新选题前请核对版本库。';}
      return {...saved,bankRevision:bank.revision,topicsRevision:topics.revision,report:{...paperReport(bank.bank,saved.paper,groups,pool),warning}};
    }
    const sourceBoundary = (strict: boolean) => {
      if (strict && topicsError) throw topicsError;
      requireBankRevision(bank,body.bankRevision);
      if (agent || strict) requireTopicsRevision(topics.revision,body.topicsRevision);
    };
    const selected = async (paper: Paper, old: Paper, indices?: number[], manualId?: string, manual?: Record<number,string>) => {
      sourceBoundary(paper.quota.enabled);
      let next: Paper;
      const pool=await paperVariantCandidates(workspace,bank,paper,groups);
      try {

        const unstructured=[...(manualId && !body.manualRef ? [manualId] : []),...(Array.isArray(body.assignments)?body.assignments.filter(isRecord).flatMap(a => typeof a.itemId === 'string'?[a.itemId]:[]):[])];
        if (unstructured.some(id => pool.some(c => c.item.id === id && c.origin.ref.kind === 'variant'))) throw new ValidationError('版本选择需要带修订的 ref 引用。');
        const refs=[...(body.manualRef ? [body.manualRef] : []),...(Array.isArray(body.assignments)?body.assignments.filter(isRecord).flatMap(a => a.ref?[a.ref]:[]):[])].map(parseRef);
        if (refs.some(ref => !pool.some(c => refKey(c.origin.ref) === refKey(ref)))) throw new ValidationError('候选版本修订已变化或不可用，请重新查询。');
        next = fillPaper(bank.bank,paper,indices,manualId,groups,manual,pool);
      }
      catch(e) { throw new ValidationError(e instanceof Error ? e.message : '选题失败。'); }
      next.updatedAt = new Date().toISOString();
      const report = paperReport(bank.bank,next,groups,pool);
      if (dryRun) return { dryRun: true, paper: next, revision: '', bankRevision: bank.revision, topicsRevision: topics.revision, report };
      await copyPaperAttachments(workspace,next,old);
      return { ...await commit(next), dryRun: false, bankRevision: bank.revision, topicsRevision: topics.revision, report };
    };
    if (action === 'create') {
      if (!['mock','practice'].includes(String(body.kind))) throw new ValidationError('卷种无效。');
      if (agent && (body.schemaVersion !== 1 || !['auto','manual'].includes(String(body.mode)) || typeof body.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.id))) throw new ValidationError('建卷清单需要 schemaVersion:1、UUID id 及 auto/manual 模式。');
      if (body.quotaEnabled !== undefined && typeof body.quotaEnabled !== 'boolean') throw new ValidationError('quotaEnabled 必须是布尔值。');
      if (body.counts !== undefined && (body.kind !== 'practice' || !Array.isArray(body.counts) || body.counts.length !== 3 || body.counts.some(n => !Number.isInteger(n) || n < 0 || n > 100) || body.counts.reduce((s:number,n:number) => s+n,0) < 1 || body.counts.reduce((s:number,n:number) => s+n,0) > 200)) throw new ValidationError('练习题量无效。');
      const now = new Date().toISOString();
      const paper = parsePaper(configureQuota({ version: 3, useVariants: body.useVariants === true, quota: { enabled: body.kind === 'mock' && body.quotaEnabled !== false, blueprintId }, id: agent ? String(body.id) : crypto.randomUUID(), title: (body.title ?? (body.kind === 'mock' ? '数学一模拟卷' : '练习卷')) as string, kind: body.kind as Paper['kind'], seed: (body.seed ?? crypto.randomUUID()) as string, filters: (body.filters ?? { priorities: [], chapters: [], topics: [], books: [] }) as Paper['filters'], rules: (await readPaperSettings(workspace)).settings, latex: bank.bank.settings, slots: makeSlots(body.kind as Paper['kind'],body.counts as number[] | undefined), createdAt: now, updatedAt: now }));
      try { await readPaper(workspace,paper.id); throw new StorageError('试卷 ID 已存在，请读取核对，不会覆盖。','PAPER_EXISTS',409); }
      catch(e) { if (!isNotFound(e)) throw e; }
      if (agent) {
        const manual = body.mode === 'manual' ? assignments(body.assignments,paper) : undefined;
        if (manual && Object.keys(manual.manual).length !== manual.indices.length) throw new ValidationError('手动建卷的每个题位都需要 itemId。');
        return selected(paper,structuredClone(paper),manual?.indices,undefined,manual?.manual);
      }
      if (dryRun) return { dryRun: true, paper, revision: '', report: paperReport(bank.bank,paper,groups) };
      return commit(paper);
    }
    if (action === 'candidates') {
      const saved = await readPaper(workspace,id());
      const paper = body.paper === undefined ? saved.paper : parsePaper(body.paper);
      if (paper.id !== saved.paper.id) throw new ValidationError('候选查询的试卷身份不匹配。');
      const index = slotIndex(body.index,paper);
      const prepared=await paperVariantCandidates(workspace,bank,paper,groups);
      const pool = candidatePool(prepared,paper,index);
      return { bankRevision: bank.revision, topicsRevision: topics.revision, paperRevision: (await readPaper(workspace,id())).revision, items: pool.map(c => ({ ...c.item, origin:c.origin, primaryGroup:c.topic?.groupId ?? null })), report: paperReport(bank.bank,paper,groups,prepared) };
    }
    const { paper } = await current();
    if (action === 'delete') { await deletePaper(workspace,paper.id,requiredString(body,'revision')); broadcastPaperChanged({ workspacePath: workspace,id: paper.id,revision:'' }); return { ok: true }; }
    if (action === 'copy') {
      const now = new Date().toISOString();
      let copy: Paper = { ...paper, id: crypto.randomUUID(), title: `${paper.title} 副本`, createdAt: now, updatedAt: now };
      if (body.practice === true) copy = configureQuota({ ...copy, kind: 'practice', quota: { enabled: false,blueprintId }, slots: copy.slots.map(s => ({ ...s,subject:null })) });
      return commit(copy);
    }
    if (action === 'save') {
      let draft = parsePaper(body.paper,{ configure: true });
      if (draft.id !== paper.id || draft.kind !== paper.kind || draft.createdAt !== paper.createdAt) throw new ValidationError('不能改变试卷身份。');
      for (const slot of draft.slots) {
        const old = paper.slots.find(s => JSON.stringify(s.snapshot) === JSON.stringify(slot.snapshot) && s.sourceText === slot.sourceText);
        if (slot.snapshot && !old) throw new ValidationError('题目快照不能通过保存修改。');
        slot.topic = old?.topic ?? null;
        slot.origin = old?.origin;
      }
      if (draft.quota.enabled && !paper.quota.enabled) { if (topicsError) throw topicsError; draft = attachTopics(draft,topics.store); }
      draft.updatedAt = new Date().toISOString();
      return commit(draft);
    }
    if (action === 'apply-topics') {
      if (topicsError) throw topicsError;
      requireTopicsRevision(topics.revision,body.topicsRevision);
      return commit({ ...attachTopics(paper,topics.store),updatedAt:new Date().toISOString() });
    }
    if (action === 'generate' || action === 'replace') {
      const batch = action === 'replace' ? assignments(body.assignments,paper) : undefined;
      const indices = batch?.indices ?? (body.index === undefined ? undefined : [slotIndex(body.index,paper)]);
      if (body.manualRef !== undefined) body.manualId = parseRef(body.manualRef).id;
      if (body.manualId !== undefined && (!indices || typeof body.manualId !== 'string')) throw new ValidationError('手动选题参数无效。');
      return selected(paper,paper,indices,body.manualId as string | undefined,batch?.manual);
    }
    if (action === 'export') {
      if (slotProblems(paper).some(Boolean)) throw new StorageError('请先补齐缺题并解决规则冲突。', 'PAPER_INCOMPLETE');
      return exportPaper(workspace,paper);
    }
    throw new ValidationError('未知组卷操作。');
  });
}
export function parsePaperRequest(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError('组卷请求必须是对象。');
  requiredString(value,'workspacePath');
  return value;
}
export type PaperSelectionResult = PaperSnapshot & { bankRevision: string; topicsRevision: string; report: ReturnType<typeof paperReport>; dryRun: boolean };
