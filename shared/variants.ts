import type { QuestionAsset, QuestionItem } from './types.js';
import { parseQuestionItem } from './bank-validation.js';
import { findMacros } from './latex-macros.js';
import { isRecord, requiredString, ValidationError } from './validation-primitives.js';

export const examKinds = ['A','B','C','D'] as const;
export type ExamKind = typeof examKinds[number];
export const kindNames: Record<ExamKind,string> = {A:'选择',B:'填空',C:'解答',D:'证明'};
export const isExamKind = (v: unknown): v is ExamKind => examKinds.includes(v as ExamKind);
export const canConvert = (from: ExamKind, to: ExamKind) => from === 'D' ? to === 'D' : to !== 'D';
export function standardKinds(item: QuestionItem): ExamKind[] { return examKinds.filter(k => item.questionTypes.includes(kindNames[k])); }
export interface CandidateRef { kind: 'original' | 'variant'; id: string; revision?: string }
export interface PaperOrigin { ref: CandidateRef; rootId: string; familyId?: string; originalKind?: ExamKind; approvedAt?: string }
export const refKey = (ref: CandidateRef) => JSON.stringify([ref.kind,ref.id,ref.revision ?? '']);
export interface VariantContent { targetKind: ExamKind; question: string; solution: string; answer: string; choiceKey?: string }
export interface VariantRevision {
  schemaVersion: 1; id: string; variantId: string; familyId: string;
  content: VariantContent; item: QuestionItem; base: QuestionItem; baseFingerprint: string;
  typeEpoch: number; createdAt: string; generator: string;
}
export interface VariantEntry {
  id: string; currentRevision: string; history: string[]; revisionHashes: Record<string,string>; status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  reviews?: { revision: string; action: string; fingerprint: string; epoch: number; at: string }[];
  approvedFingerprint: string | null; approvedEpoch: number | null; reviewedAt: string | null;
}
export interface VariantFamily {
  schemaVersion: 1; id: string; rootId: string; originalKind: ExamKind; typeEpoch: number;
  createdAt: string; baseline?: QuestionItem; corrections: { from: ExamKind; to: ExamKind; reason: string; at: string }[];
  versions: VariantEntry[];
  refusals: { targetKind: ExamKind; reason: string; baseFingerprint: string; at: string }[];
}
export interface FamilySnapshot { family: VariantFamily; revision: string }
export interface VariantRow { entry: VariantEntry; revision: VariantRevision; history: VariantRevision[]; state: string; eligible: boolean }
export interface FamilyView extends FamilySnapshot { root: QuestionItem | null; rows: VariantRow[]; rootFingerprint: string | null; warning?: string; blocked: boolean }
/** Rows that still need a human decision: never-reviewed versions and approvals invalidated by a changed basis. */
export const needsReview = (row: Pick<VariantRow,'entry'|'state'>) => row.entry.status === 'pending' || (row.entry.status === 'approved' && row.state === '待复核');
export interface VariantQueue { enabled: boolean; families: FamilyView[]; total: number; warnings: string[] }
export interface VariantConfig { version: 1; enabled: boolean; agentAutoEnroll?: boolean }
export interface VariantOverview { config: VariantConfig; configRevision: string; families: FamilySnapshot[]; warnings: string[]; bankRevision: string }

export function parseRef(v: unknown): CandidateRef {
  if (!isRecord(v) || !['original','variant'].includes(String(v.kind)) || typeof v.id !== 'string' || !v.id || (v.kind === 'variant' && (!uuid(v.id) || typeof v.revision !== 'string' || !uuid(v.revision)))) throw new ValidationError('候选引用无效。');
  return {kind:v.kind as CandidateRef['kind'],id:v.id,...(v.kind === 'variant' ? {revision:String(v.revision)} : {})};
}
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function parseVariantContent(v: unknown, originalKind: ExamKind): VariantContent {
  if (!isRecord(v) || !isExamKind(v.targetKind) || !canConvert(originalKind,v.targetKind)) throw new ValidationError('转换不允许：ABC 之间转换，D 只能转换为 D。');
  const content: VariantContent = {targetKind:v.targetKind,question:requiredString(v,'question'),solution:requiredString(v,'solution'),answer:requiredString(v,'answer')};
  if (!content.question.trim() || !content.solution.trim() || !content.answer.trim() || [content.question,content.solution,content.answer].some(s => s.length > 500_000)) throw new ValidationError('版本必须包含完整题面、答案与解析。');
  if (content.targetKind === 'A') {
    const blocks = findMacros(content.question,'choices',4);
    if (blocks.length !== 1 || blocks[0].args.some(a => !a.trim()) || new Set(blocks[0].args.map(a => a.trim())).size !== 4 || !['A','B','C','D'].includes(String(v.choiceKey))) throw new ValidationError('选择版本须有一组四个不同的非空选项及 choiceKey（A/B/C/D）。');
    content.choiceKey = String(v.choiceKey);
  }
  if (content.targetKind === 'B' && !findMacros(content.question,'blank',0).length) throw new ValidationError('填空版本必须包含 \\blank。');
  return content;
}
export function parseFamily(v: unknown): VariantFamily {
  if (!isRecord(v) || v.schemaVersion !== 1 || !uuid(v.id) || typeof v.rootId !== 'string' || !v.rootId || !isExamKind(v.originalKind) || !Number.isInteger(v.typeEpoch) || Number(v.typeEpoch) < 1 || !Array.isArray(v.versions) || !Array.isArray(v.corrections) || !Array.isArray(v.refusals) || typeof v.createdAt !== 'string') throw new ValidationError('原题族文件无效。');
  if (v.baseline !== undefined) v.baseline=parseQuestionItem(v.baseline);
  const ids = new Set<string>();
  for (const e of v.versions) {
    if (!isRecord(e) || !uuid(e.id) || ids.has(e.id) || !uuid(e.currentRevision) || !Array.isArray(e.history) || !e.history.includes(e.currentRevision) || e.history.some(x => !uuid(x)) || !['pending','approved','rejected','withdrawn'].includes(String(e.status)) || !(e.approvedFingerprint === null || typeof e.approvedFingerprint === 'string' && /^[a-f0-9]{64}$/.test(e.approvedFingerprint)) || !(e.approvedEpoch === null || Number.isInteger(e.approvedEpoch)) || !(e.reviewedAt === null || typeof e.reviewedAt === 'string')) throw new ValidationError('版本索引无效。');
    if (e.reviews !== undefined && (!Array.isArray(e.reviews) || e.reviews.some(r => !isRecord(r) || !uuid(r.revision) || !['approve','reject','withdraw'].includes(String(r.action)) || typeof r.fingerprint !== 'string' || !Number.isInteger(r.epoch) || typeof r.at !== 'string'))) throw new ValidationError('审批历史无效。');
    const hashes=e.revisionHashes;
    if (!isRecord(hashes) || e.history.some(id => typeof hashes[String(id)] !== 'string' || !/^[a-f0-9]{64}$/.test(String(hashes[String(id)])))) throw new ValidationError('修订内容校验记录无效。');
    ids.add(e.id);
  }
  for (const c of v.corrections) if (!isRecord(c) || !isExamKind(c.from) || !isExamKind(c.to) || typeof c.reason !== 'string' || typeof c.at !== 'string') throw new ValidationError('纠错记录无效。');
  for (const r of v.refusals) if (!isRecord(r) || !isExamKind(r.targetKind) || typeof r.reason !== 'string' || typeof r.baseFingerprint !== 'string' || typeof r.at !== 'string') throw new ValidationError('拒绝转换记录无效。');
  return v as unknown as VariantFamily;
}
export function parseVariantRevision(v: unknown): VariantRevision {
  if (!isRecord(v) || v.schemaVersion !== 1 || !uuid(v.id) || !uuid(v.variantId) || !uuid(v.familyId) || typeof v.baseFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.baseFingerprint) || !Number.isInteger(v.typeEpoch) || typeof v.createdAt !== 'string' || typeof v.generator !== 'string' || !isRecord(v.content) || !isExamKind(v.content.targetKind)) throw new ValidationError('版本修订无效。');
  const item=parseQuestionItem(v.item);
  if (item.id !== v.variantId || item.modules.question.tex !== v.content.question || item.modules.solution.tex !== v.content.solution || JSON.stringify(standardKinds(item)) !== JSON.stringify([v.content.targetKind]) || Number(v.typeEpoch) < 1) throw new ValidationError('修订内容与快照不匹配。');
  return {...v,content:parseVariantContent(v.content,v.content.targetKind),item:parseQuestionItem(v.item),base:parseQuestionItem(v.base)} as unknown as VariantRevision;
}
/** The server enriches asset hashes from actual bytes before applying this fingerprint. */
export function variantBasisSource(item: QuestionItem): string {
  let question = item.modules.question.tex; let solution = item.modules.solution.tex;
  for (const a of item.assets) {
    question = question.replaceAll(a.relativePath,`{{${a.id}}}`).replaceAll(`assets/${a.fileName}`,`{{${a.id}}}`);
    solution = solution.replaceAll(a.relativePath,`{{${a.id}}}`).replaceAll(`assets/${a.fileName}`,`{{${a.id}}}`);
  }
  return JSON.stringify({question,solution,assets:item.assets.map(a => [a.id,a.sha256 ?? null]).sort(([a],[b]) => String(a).localeCompare(String(b)))});
}

export function normalizeVariantImages(tex:string,assets:QuestionAsset[]):string {
  const images=[...findMacros(tex,'includegraphics',1),...findMacros(tex,'qimg',1)].sort((a,b) => b.start-a.start);
  for (const image of images) {
    const raw=image.args[0];const name=raw.trim().replace(/^"|"$/g,'');
    const asset=assets.find(a => [a.relativePath,`assets/${a.fileName}`,a.fileName].includes(name));
    if (!asset) throw new ValidationError('版本只能引用原题或当前版本已有的独立附件。');
    const command=tex.slice(image.start,image.end).replace(raw,asset.relativePath);
    tex=tex.slice(0,image.start)+command+tex.slice(image.end);
  }
  return tex;
}
