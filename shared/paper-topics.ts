import type { QuestionItem } from './types.js';
import type { PaperSection, Subject } from './papers.js';
import { isRecord, ValidationError } from './validation-primitives.js';

export const topicGroups = [
  ['C01', '极限与连续'], ['C02', '导数与微分（含泰勒展开）'],
  ['C03', '微分应用与中值定理'], ['C04', '一元积分计算与性质'],
  ['C05', '一元积分应用'], ['C06', '微分方程'], ['C07', '多元微分与极值'],
  ['C08', '重积分'], ['C09', '曲线曲面积分'], ['C10', '无穷级数'], ['C11', '空间解析几何'],
  ['L01', '行列式'], ['L02', '矩阵与秩'], ['L03', '向量与线性方程组'],
  ['L04', '特征值与相似对角化'], ['L05', '二次型'],
  ['P01', '随机事件与概率'], ['P02', '一维随机变量及分布'],
  ['P03', '多维随机变量及分布'], ['P04', '数字特征'], ['P05', '大数定律与极限定理'],
  ['P06', '统计量与抽样分布'], ['P07', '参数估计'], ['P08', '假设检验']
].map(([id, name]) => ({ id, name, subject: (id.startsWith('C') ? 'calculus' : id.startsWith('L') ? 'linear' : 'probability') as Subject }));
export const topicGroup = (id: string) => topicGroups.find(group => group.id === id);
export const groupName = (id: string | null | undefined) => topicGroup(id ?? '')?.name ?? '未分类';
export const legacyBlueprintId = 'math1-2021-2025-v1';
export const blueprintId = 'math1-2021-2026-v2';
// Saved papers keep the blueprint they were built with; a new year must not invalidate their slots.
export const blueprintYears: Record<string, string[]> = {
  [legacyBlueprintId]: ['2021','2022','2023','2024','2025'],
  [blueprintId]: ['2021','2022','2023','2024','2025','2026']
};
export const isBlueprint = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(blueprintYears,id);
// Editorial primary-topic annotations, not official classifications. Source PDF pages 35–49.
// Composite decisions: 2021/19 spatial geometry; 2021/20 line/surface integrals;
// 2022/17, 2023/17 and 2025/18 differential equations; 2025/21 eigenvalues.
// 2026 is annotated from an institutional paper-and-solutions PDF, not an official release.
// Composite decisions: 2026/11 line/surface integrals (divergence); 2026/18 differential equations;
// 2026/20 mean-value theorems; 2026/21 vectors and linear systems.
export const historicalTopics: Record<string, string[]> = Object.fromEntries(Object.entries({
  2021: 'C02 C07 C02 C04 L05 L03 L02 P01 P07 P08 C04 C02 C06 C09 L01 P04 C01 C10 C11 C09 L04 P02',
  2022: 'C02 C07 C01 C04 L04 L03 L03 P04 P05 P04 C07 C04 C07 C10 L02 P01 C06 C08 C09 C03 L05 P07',
  2023: 'C03 C06 C02 C10 L02 L04 L03 P04 P06 P07 C01 C07 C10 C04 L03 P03 C06 C07 C09 C03 L05 P03',
  2024: 'C04 C09 C10 C02 L03 L03 L04 P02 P04 P02 C01 C07 C10 C06 L05 P01 C08 C07 C03 C09 L04 P07',
  2025: 'C03 C10 C01 C08 L05 L03 L02 P04 P05 P08 C01 C10 C07 C09 L03 P01 C04 C06 C03 C09 L04 P02',
  2026: 'C07 C10 C03 C08 L02 L03 L05 P04 P04 P02 C09 C01 C02 C04 L04 P04 C07 C06 C09 C03 L03 P07'
}).map(([year, row]) => [year, row.split(' ')]));

export interface TopicStamp { groupId: string; fingerprint: string }
export interface TopicProposal extends TopicStamp { reason: string }
export interface TopicRecord { approved: TopicStamp | null; proposal: TopicProposal | null }
export interface TopicStore { version: 1; items: Record<string, TopicRecord> }
export interface TopicRow {
  item: QuestionItem;
  approved: TopicStamp | null;
  proposal: TopicProposal | null;
  state: 'unclassified' | 'pending' | 'approved' | 'stale';
  proposalStale: boolean;
}
export interface TopicsResponse { revision: string; bankRevision: string; rows: TopicRow[]; warning?: string }
export interface TopicDecision { itemId: string; action: 'approve' | 'reject' | 'set' | 'clear'; groupId?: string }

export function parseTopicStamp(value: unknown): TopicStamp | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.groupId !== 'string' || !topicGroup(value.groupId) || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new ValidationError('主考点分类记录无效。');
  return { groupId: value.groupId, fingerprint: value.fingerprint };
}
export function parseTopicStore(value: unknown): TopicStore {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.items)) throw new ValidationError('考点分类文件无效。');
  const items: TopicStore['items'] = Object.create(null);
  for (const [id, record] of Object.entries(value.items)) {
    if (!id || !isRecord(record)) throw new ValidationError('考点分类记录无效。');
    const approved = parseTopicStamp(record.approved);
    const proposalStamp = parseTopicStamp(record.proposal);
    let proposal: TopicProposal | null = null;
    if (proposalStamp) {
      if (!isRecord(record.proposal) || typeof record.proposal.reason !== 'string' || record.proposal.reason.length > 500) throw new ValidationError('分类理由无效。');
      proposal = { ...proposalStamp, reason: record.proposal.reason };
    }
    items[id] = { approved, proposal };
  }
  return { version: 1, items };
}

/** Immutable paper asset copies rename paths; IDs preserve fingerprint identity. */
export function topicFingerprintSource(item: QuestionItem): string {
  let tex = item.modules.question.tex;
  for (const asset of item.assets) {
    tex = tex.replaceAll(asset.relativePath, `{{asset:${asset.id}}}`).replaceAll(`assets/${asset.fileName}`, `{{asset:${asset.id}}}`);
  }
  return JSON.stringify({ tex, chapterId: item.chapterId, topics: [...item.topics].sort(), questionTypes: [...item.questionTypes].sort(), assets: item.assets.map(a => [a.id, a.mimeType, a.size]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))) });
}
export function seedHash(text: string): number {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function quotaRequirements(seed: string, id: string = blueprintId): string[] {
  const years = blueprintYears[id] ?? blueprintYears[blueprintId];
  const result: string[] = Array(22).fill('');
  const bins: [PaperSection, Subject, number[]][] = [
    ['choice','calculus',[0,1,2,3]], ['choice','linear',[4,5,6]], ['choice','probability',[7,8,9]],
    ['blank','calculus',[10,11,12,13]], ['blank','linear',[14]], ['blank','probability',[15]],
    ['answer','calculus',[16,17,18,19]], ['answer','linear',[20]], ['answer','probability',[21]]
  ];
  for (const [section,subject,indices] of bins) {
    const counts = new Map<string,number>();
    for (const year of years) for (const i of indices) counts.set(historicalTopics[year][i], (counts.get(historicalTopics[year][i]) ?? 0) + 1);
    const offset = seedHash(`${seed}:${section}:${subject}`) % years.length;
    let cumulative = offset;
    const groups: string[] = [];
    for (const [id,count] of [...counts].sort(([a],[b]) => a.localeCompare(b))) {
      const before = Math.floor(cumulative / years.length);
      cumulative += count % years.length;
      const amount = Math.floor(count / years.length) + Math.floor(cumulative / years.length) - before;
      groups.push(...Array<string>(amount).fill(id));
    }
    indices.forEach((i,n) => { result[i] = groups[n]; });
  }
  return result;
}
