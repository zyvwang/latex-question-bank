import { parseRef, type PaperOrigin } from './variants.js';
import { blueprintId, isBlueprint, parseTopicStamp, quotaRequirements, topicGroup, type TopicStamp } from './paper-topics.js';
import { parseQuestionItem, parseLatexSettings } from './bank-validation.js';
import type { Bank, QuestionItem, ReviewPriority, LatexSettings } from './types.js';
import { isRecord, ValidationError } from './validation-primitives.js';

export const paperSections = ['choice', 'blank', 'answer'] as const;
export type PaperSection = typeof paperSections[number];
export type Subject = 'calculus' | 'linear' | 'probability';
export const sectionNames: Record<PaperSection, string> = { choice: '选择题', blank: '填空题', answer: '解答题' };
export const subjectNames: Record<Subject, string> = { calculus: '高数', linear: '线代', probability: '概率' };
export interface PaperSettings {
  version: 1;
  chapters: Record<string, Subject>;
  types: Record<string, PaperSection>;
}
export interface PaperFilters {
  priorities: (ReviewPriority | 'unset')[];
  chapters: string[];
  topics: string[];
  books: string[];
}
export interface PaperSlot {
  section: PaperSection;
  subject: Subject | null;
  points: number;
  locked: boolean;
  space: 'compact' | 'half' | 'page';
  origin?: PaperOrigin;
  snapshot: QuestionItem | null;
  sourceText: string;
  requiredGroup: string | null;
  topic: TopicStamp | null;
}
export interface Paper {
  version: 3;
  useVariants: boolean;
  quota: { enabled: boolean; blueprintId: string };
  id: string;
  title: string;
  kind: 'mock' | 'practice';
  seed: string;
  filters: PaperFilters;
  rules: PaperSettings;
  latex: LatexSettings;
  slots: PaperSlot[];
  createdAt: string;
  updatedAt: string;
}
export interface PaperSnapshot { paper: Paper; revision: string }
export interface PaperList { papers: { id: string; title: string; kind: Paper['kind']; updatedAt: string; missing: number }[]; warnings: string[] }
export const defaultPaperSettings = (): PaperSettings => ({ version: 1, chapters: {}, types: { '选择': 'choice', '填空': 'blank', '解答': 'answer', '证明': 'answer' } });
export function makeSlots(kind: Paper['kind'], counts = [10, 6, 6]): PaperSlot[] {
  return paperSections.flatMap((section, part) => Array.from({ length: counts[part] }, (_, i) => ({
    section,
    subject: kind === 'practice' ? null : (part === 0 ? (i < 4 ? 'calculus' : i < 7 ? 'linear' : 'probability') : part === 1 ? (i < 4 ? 'calculus' : i === 4 ? 'linear' : 'probability') : (i < 4 ? 'calculus' : i === 4 ? 'linear' : 'probability')) as Subject,
    points: section !== 'answer' ? 5 : i === 0 ? 10 : 12,
    locked: false, space: section === 'answer' ? 'half' : 'compact', snapshot: null, sourceText: '', requiredGroup: null, topic: null
  })));
}
export function classify(item: QuestionItem, rules: PaperSettings): PaperSection | null {
  const sections = new Set(item.questionTypes.map(t => Object.hasOwn(rules.types,t) ? rules.types[t] : undefined).filter(Boolean));
  return sections.size === 1 ? [...sections][0] ?? null : null;
}
export function matchesSlot(item: QuestionItem, slot: PaperSlot, paper: Paper, stamp?: TopicStamp | null): boolean {
  const f = paper.filters;
  const classification = stamp === undefined ? (slot.snapshot?.id === item.id ? slot.topic : null) : stamp;
  const quotaMatch = !paper.quota.enabled || (!!slot.requiredGroup && classification?.groupId === slot.requiredGroup && topicGroup(classification.groupId)?.subject === slot.subject);
  return quotaMatch && item.reviewStatus === 'approved' && classify(item, paper.rules) === slot.section &&
    (paper.kind === 'practice' || (item.chapterId !== null && paper.rules.chapters[item.chapterId] === slot.subject)) &&
    (!f.priorities.length || f.priorities.includes(item.reviewPriority ?? 'unset')) &&
    (paper.kind === 'mock' || ((!f.chapters.length || f.chapters.includes(item.chapterId ?? '')) &&
      (!f.topics.length || item.topics.some(t => f.topics.includes(t))) &&
      (!f.books.length || f.books.includes(item.source?.bookId ?? ''))));
}
export function slotProblems(paper: Paper): string[] {
  const seen = new Set<string>();
  const families = new Set<string>();
  return paper.slots.map(slot => {
    if (!slot.snapshot) return '缺题';
    if (seen.has(slot.snapshot.id)) return '重复题目';
    seen.add(slot.snapshot.id);
    const root = slot.origin?.rootId ?? slot.snapshot.id;
    if (families.has(root)) return '同族题目重复';
    families.add(root);
    return matchesSlot(slot.snapshot, slot, paper) ? '' : '不符合当前规则';
  });
}
function hash(text: string): number {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function candidates(bank: Bank, paper: Paper, index: number, groups?: Record<string, TopicStamp>): QuestionItem[] {
  const used = new Set(paper.slots.filter((_, i) => i !== index).flatMap(s => s.snapshot ? [s.snapshot.id] : []));
  const current = paper.slots[index].snapshot?.id;
  return bank.items.filter(item => !used.has(item.id) && item.id !== current && matchesSlot(item, paper.slots[index], paper, groups ? groups[item.id] ?? null : undefined));
}
export interface PaperCandidate { item: QuestionItem; origin: PaperOrigin; topic: TopicStamp | null; sourceText: string }
export function originalCandidates(bank: Bank, groups: Record<string, TopicStamp> = {}): PaperCandidate[] {
  return bank.items.map(item => ({item, origin:{ref:{kind:'original',id:item.id},rootId:item.id},topic:groups[item.id] ?? null,sourceText:[bank.books.find(b => b.id === item.source?.bookId)?.title,item.source?.label].filter(Boolean).join(' · ')}));
}
export function candidatePool(pool: PaperCandidate[], paper: Paper, index: number): PaperCandidate[] {
  const used = new Set(paper.slots.filter((_,i) => i !== index).flatMap(s => s.snapshot ? [s.origin?.rootId ?? s.snapshot.id] : []));
  return pool.filter(c => !used.has(c.origin.rootId) && c.item.id !== paper.slots[index].snapshot?.id && matchesSlot(c.item,paper.slots[index],paper,c.topic));
}
export function fillPaper(bank: Bank, input: Paper, indices?: number[], manualId?: string, groups: Record<string, TopicStamp> = {}, manualIds?: Record<number, string>, prepared?: PaperCandidate[]): Paper {
  const paper = structuredClone(input);
  const pool = prepared ?? originalCandidates(bank,groups);
  const targets = indices ? [...indices] : paper.slots.flatMap((s,i) => s.locked ? [] : [i]);
  const reserved = new Set(paper.slots.flatMap((s,i) => !targets.includes(i) && s.snapshot ? [s.origin?.rootId ?? s.snapshot.id] : []));
  const previous = new Map(targets.map(i => [i,paper.slots[i].snapshot?.id]));
  const topics = new Set(paper.slots.filter((_,i) => !targets.includes(i)).flatMap(s => s.snapshot?.topics ?? []));
  const edges = new Map<number,PaperCandidate[]>();
  for (const i of targets) {
    if (paper.slots[i].locked) throw new Error('请先解锁题位。');
    const selectedId = manualIds?.[i] ?? manualId;
    const eligible = pool.filter(c => !reserved.has(c.origin.rootId) && (!indices || c.item.id !== previous.get(i)) && (!selectedId || c.item.id === selectedId) && matchesSlot(c.item,paper.slots[i],paper,c.topic));
    const overlap = (c: PaperCandidate) => c.item.topics.filter(t => topics.has(t)).length;
    // Rank families first: having more representations must not increase selection weight.
    eligible.sort((a,b) => overlap(a)-overlap(b) || hash(`${paper.seed}:${i}:${a.origin.rootId}`)-hash(`${paper.seed}:${i}:${b.origin.rootId}`) || a.origin.rootId.localeCompare(b.origin.rootId) || a.item.id.localeCompare(b.item.id));
    edges.set(i,eligible);
    paper.slots[i].snapshot=null; paper.slots[i].origin=undefined; paper.slots[i].topic=null; paper.slots[i].sourceText='';
  }
  const owners=new Map<string,number>(); const chosen=new Map<number,PaperCandidate>();
  const manual = (i:number) => !!(manualIds?.[i] ?? manualId);
  function place(i:number,visited:Set<string>): boolean {
    const chosenTopics=new Set([...topics,...[...chosen.entries()].filter(([slot]) => slot !== i).flatMap(([,c]) => c.item.topics)]);
    const options=[...(edges.get(i) ?? [])];
    const overlap=(c:PaperCandidate) => c.item.topics.filter(t => chosenTopics.has(t)).length;
    options.sort((a,b) => overlap(a)-overlap(b) || hash(`${paper.seed}:${i}:${a.origin.rootId}`)-hash(`${paper.seed}:${i}:${b.origin.rootId}`) || a.origin.rootId.localeCompare(b.origin.rootId) || a.item.id.localeCompare(b.item.id));
    for (const c of options) {
      const key=c.origin.rootId;
      if (visited.has(key)) continue; visited.add(key);
      const owner=owners.get(key);
      if (owner === undefined || (!manual(owner) && place(owner,visited))) {owners.set(key,i); chosen.set(i,c); return true;}
    }
    return false;
  }
  const familyCount=(i:number) => new Set((edges.get(i) ?? []).map(c => c.origin.rootId)).size;
  targets.sort((a,b) => Number(manual(b))-Number(manual(a)) || familyCount(a)-familyCount(b) || a-b);
  for (const i of targets) {
    if (!place(i,new Set()) && manual(i)) throw new Error('所选题不符合题位或同族题已在卷中。');
  }
  if (indices && targets.some(i => !chosen.has(i))) throw new Error('没有符合条件的替换题。');
  for (const [i,c] of chosen) Object.assign(paper.slots[i],{snapshot:structuredClone(c.item),origin:structuredClone(c.origin),topic:c.topic,sourceText:c.sourceText});
  return paper;
}

// Reject malformed persisted documents before any filesystem or renderer use.
export function parsePaperSettings(value: unknown): PaperSettings {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.chapters) || !isRecord(value.types)) throw new ValidationError('组卷设置无效。');
  for (const v of Object.values(value.chapters)) if (!['calculus', 'linear', 'probability'].includes(String(v))) throw new ValidationError('学科映射无效。');
  for (const v of Object.values(value.types)) if (!paperSections.includes(v as PaperSection)) throw new ValidationError('题型映射无效。');
  return { version: 1, chapters: { ...value.chapters } as PaperSettings['chapters'], types: { ...value.types } as PaperSettings['types'] };
}
export function parsePaper(value: unknown, options: { configure?: boolean } = {}): Paper {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3) || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id) || !['mock','practice'].includes(String(value.kind))) throw new ValidationError('试卷格式无效。');
  for (const key of ['title','seed','createdAt','updatedAt']) if (typeof value[key] !== 'string' || String(value[key]).length > 500) throw new ValidationError('试卷文本无效。');
  if (!String(value.title).trim()) throw new ValidationError('试卷标题不能为空。');
  if (!isRecord(value.filters)) throw new ValidationError('筛选条件无效。');
  for (const key of ['priorities','chapters','topics','books']) if (!Array.isArray(value.filters[key]) || value.filters[key].some((v: unknown) => typeof v !== 'string')) throw new ValidationError('筛选条件无效。');
  if ((value.filters.priorities as string[]).some(v => !['skip','recheck','must','unset'].includes(v))) throw new ValidationError('优先级无效。');
  if (value.version === 3 && typeof value.useVariants !== 'boolean') throw new ValidationError('版本候选开关无效。');
  const rules = parsePaperSettings(value.rules);
  if (!Array.isArray(value.slots) || !value.slots.length || value.slots.length > 200) throw new ValidationError('题量需为 1 至 200。');
  for (const s of value.slots) {
    if (!isRecord(s) || !paperSections.includes(s.section as PaperSection) || (s.subject !== null && !Object.hasOwn(subjectNames,String(s.subject))) || typeof s.locked !== 'boolean' || !['compact','half','page'].includes(String(s.space)) || !Number.isInteger(s.points) || Number(s.points) < 1 || Number(s.points) > 150 || typeof s.sourceText !== 'string') throw new ValidationError('题位无效。');
    if (s.snapshot !== null) s.snapshot = parseQuestionItem(s.snapshot);
    if (value.version === 3 && s.origin !== undefined) {
      if (!isRecord(s.origin) || typeof s.origin.rootId !== 'string' || !s.origin.rootId) throw new ValidationError('题目来源引用无效。');
      s.origin.ref = parseRef(s.origin.ref);
      if (parseRef(s.origin.ref).kind === 'original' && s.origin.rootId !== parseRef(s.origin.ref).id) throw new ValidationError('原题引用不匹配。');
      if (!isRecord(s.snapshot) || parseRef(s.origin.ref).id !== s.snapshot.id) throw new ValidationError('题目来源引用不匹配。');
    } else delete s.origin;
    s.requiredGroup = value.version === 1 ? null : s.requiredGroup ?? null;
    if (s.requiredGroup !== null && (typeof s.requiredGroup !== 'string' || !topicGroup(s.requiredGroup))) throw new ValidationError('题位主考点无效。');
    s.topic = value.version === 1 ? null : parseTopicStamp(s.topic ?? null);
  }
  const quota = value.version === 1 ? { enabled: false, blueprintId } : value.quota;
  if (!isRecord(quota) || typeof quota.enabled !== 'boolean' || !isBlueprint(quota.blueprintId)) throw new ValidationError('考点蓝图无效。');
  const paper = { ...value, version: 3, useVariants: value.version === 3 && value.useVariants === true, quota, rules, latex: parseLatexSettings(value.latex) } as unknown as Paper;
  if (paper.kind === 'practice' && paper.quota.enabled) throw new ValidationError('练习卷不启用模拟考点配额。');
  if (!options.configure && paper.quota.enabled && paper.slots.some((slot,i) => slot.requiredGroup !== quotaRequirements(paper.seed,paper.quota.blueprintId)[i])) throw new ValidationError('题位考点配额不匹配蓝图。');
  if (paper.kind === 'mock') {
    const template = makeSlots('mock');
    if (paper.slots.length !== 22 || paper.slots.some((s, i) => s.section !== template[i].section || s.subject !== template[i].subject || s.points !== template[i].points)) throw new ValidationError('模拟卷必须保持固定数一结构。');
  }
  if (paper.slots.some((s,i) => i > 0 && paperSections.indexOf(s.section) < paperSections.indexOf(paper.slots[i-1].section))) throw new ValidationError('题位必须按选择、填空、解答排序。');
  return options.configure ? configureQuota(paper) : paper;
}

export function configureQuota(paper: Paper): Paper {
  const required = paper.quota.enabled ? quotaRequirements(paper.seed,paper.quota.blueprintId) : [];
  return { ...paper, slots: paper.slots.map((slot,i) => ({ ...slot, requiredGroup: required[i] ?? null })) };
}
