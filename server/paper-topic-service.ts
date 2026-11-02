import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BankSnapshot, QuestionItem } from '../shared/types.js';
import { parseTopicStore, topicFingerprintSource, topicGroup, type TopicStamp, type TopicStore, type TopicsResponse } from '../shared/paper-topics.js';
import { isRecord, requiredString, ValidationError } from '../shared/validation-primitives.js';
import { papersDir } from './paper-storage.js';
import { writeJsonFileAtomic } from './json-file.js';
import { isNotFound, revisionForContent } from './storage-utils.js';
import { resolveRealWorkspaceFile } from './workspace-paths.js';
import { StorageError } from './storage-types.js';

export function questionFingerprint(item: QuestionItem): string {
  return createHash('sha256').update(topicFingerprintSource(item)).digest('hex');
}
export async function readTopicStore(workspace: string): Promise<{ store: TopicStore; revision: string }> {
  try {
    const dir = await papersDir(workspace, false);
    const raw = await readFile(await resolveRealWorkspaceFile(dir,'topics.json'),'utf8');
    try { return { store: parseTopicStore(JSON.parse(raw)), revision: revisionForContent(raw) }; }
    catch { throw new StorageError('考点分类文件损坏，已保留原文件；请先恢复 papers/topics.json。','PAPER_TOPICS_CORRUPT',409); }
  } catch(e) {
    if (isNotFound(e)) return { store: { version: 1, items: {} }, revision: '' };
    throw e;
  }
}
export function requireTopicsRevision(actual: string, expected: unknown) {
  if (typeof expected !== 'string' || actual !== expected) throw new StorageError('考点分类已变化，请刷新后重试。','PAPER_TOPICS_CONFLICT',409);
}
export function requireBankRevision(bank: BankSnapshot, expected: unknown) {
  if (bank.revision !== expected) throw new StorageError('题库已变化，请保存并重新读取。','BANK_CONFLICT',409);
}
export function liveTopicGroups(bank: BankSnapshot, store: TopicStore): Record<string, TopicStamp> {
  const groups: Record<string, TopicStamp> = Object.create(null);
  for (const item of bank.bank.items) {
    const approved = store.items[item.id]?.approved;
    if (approved?.fingerprint === questionFingerprint(item)) groups[item.id] = approved;
  }
  return groups;
}
export async function topicRows(bank: BankSnapshot): Promise<TopicsResponse> {
  let data: Awaited<ReturnType<typeof readTopicStore>>;
  let warning: string | undefined;
  try { data = await readTopicStore(bank.workspacePath); }
  catch(e) {
    if (!(e instanceof StorageError) || e.code !== 'PAPER_TOPICS_CORRUPT') throw e;
    warning = e.message;
    data = { store: { version: 1, items: {} }, revision: '' };
  }
  return { revision: data.revision, bankRevision: bank.revision, warning, rows: bank.bank.items.map(item => {
    const record = data.store.items[item.id];
    const fingerprint = questionFingerprint(item);
    const approved = record?.approved ?? null;
    const proposal = record?.proposal ?? null;
    const state = approved && approved.fingerprint !== fingerprint ? 'stale' : proposal ? 'pending' : approved ? 'approved' : 'unclassified';
    return { item, approved, proposal, state, proposalStale: !!proposal && proposal.fingerprint !== fingerprint };
  }) };
}

/** Caller holds the workspace write lock. Proposals never replace approved classifications. */
export async function changeTopics(bank: BankSnapshot, body: Record<string, unknown>, propose: boolean, dryRun = false) {
  const data = await readTopicStore(bank.workspacePath);
  requireBankRevision(bank, body.bankRevision);
  requireTopicsRevision(data.revision, body.topicsRevision);
  if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 500) throw new ValidationError('每批分类必须包含 1 至 500 项。');
  const next = structuredClone(data.store);
  next.items = Object.assign(Object.create(null), next.items);
  const seen = new Set<string>();
  for (const entry of body.entries) {
    if (!isRecord(entry)) throw new ValidationError('分类项必须是对象。');
    const id = requiredString(entry,'itemId');
    const item = bank.bank.items.find(q => q.id === id);
    if (!item || seen.has(id)) throw new ValidationError(`题目不存在或重复：${id}`);
    seen.add(id);
    const fingerprint = questionFingerprint(item);
    const previous = next.items[id] ?? { approved: null, proposal: null };
    const group = typeof entry.groupId === 'string' ? topicGroup(entry.groupId) : null;
    if (propose) {
      if (!group || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 500) throw new ValidationError(`分类组或理由无效：${id}`);
      next.items[id] = { ...previous, proposal: { groupId: group.id, fingerprint, reason: entry.reason } };
    } else {
      switch (entry.action) {
        case 'approve':
          if (!previous.proposal || previous.proposal.fingerprint !== fingerprint) throw new ValidationError(`分类建议已过期或不存在：${id}`);
          next.items[id] = { approved: { groupId: group?.id ?? previous.proposal.groupId, fingerprint }, proposal: null };
          if (entry.groupId !== undefined && !group) throw new ValidationError(`分类组无效：${id}`);
          break;
        case 'set':
          if (!group) throw new ValidationError(`分类组无效：${id}`);
          next.items[id] = { approved: { groupId: group.id, fingerprint }, proposal: null };
          break;
        case 'reject': next.items[id] = { ...previous, proposal: null }; break;
        case 'clear': next.items[id] = { approved: null, proposal: null }; break;
        default: throw new ValidationError('分类确认操作无效。');
      }
    }
  }
  if (dryRun) return { dryRun: true, revision: data.revision, bankRevision: bank.revision, count: seen.size };
  const dir = await papersDir(bank.workspacePath);
  const file = await resolveRealWorkspaceFile(dir,'topics.json',{ allowMissing: true });
  await resolveRealWorkspaceFile(dir,'topics.json.bak',{ allowMissing: true });
  await writeJsonFileAtomic(file, next);
  return { dryRun: false, revision: (await readTopicStore(bank.workspacePath)).revision, bankRevision: bank.revision, count: seen.size };
}
