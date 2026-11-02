import { originalCandidates, type Paper, type PaperCandidate } from '../shared/papers.js';
import type { TopicStamp } from '../shared/paper-topics.js';
import type { BankSnapshot } from '../shared/types.js';
import { familyCatalog, readVariantConfig, pendingImportFamilies } from './variant-storage.js';
import { familyView } from './variant-service.js';
export async function paperVariantCandidates(workspace:string,bank:BankSnapshot,paper:Paper,groups:Record<string,TopicStamp>):Promise<PaperCandidate[]> {
  const pending=await pendingImportFamilies(workspace);
  const originals=originalCandidates(bank.bank,groups).filter(c => !pending.some(f => f.rootId === c.item.id));
  const catalog=await familyCatalog(workspace).catch(() => null);
  if (!catalog || catalog.warnings.length) return originals;
  for (const c of originals) {const family=catalog.families.find(f => f.family.rootId === c.item.id)?.family;if (family) {c.origin.familyId=family.id;c.origin.originalKind=family.originalKind;}}
  if (!paper.useVariants || !(await readVariantConfig(workspace)).config.enabled) return originals;
  const result=[...originals];
  for (const {family} of catalog.families) {
    let view;
    try {view=await familyView(workspace,family.id,bank);} catch {continue;}
    const root=view.root; if (!root) continue;
    for (const row of view.rows.filter(r => r.eligible)) {
      const item={...structuredClone(root),id:row.entry.id,questionTypes:row.revision.item.questionTypes,assets:row.revision.item.assets,solutionSource:row.revision.item.solutionSource,solutionRef:row.revision.item.solutionRef,modules:structuredClone(row.revision.item.modules)};
      item.modules.solution.tex=`答案：${row.revision.content.answer}\n\n${item.modules.solution.tex}`;
      result.push({item,origin:{ref:{kind:'variant',id:row.entry.id,revision:row.revision.id},rootId:root.id,familyId:family.id,originalKind:family.originalKind,approvedAt:row.entry.reviewedAt ?? undefined},topic:groups[root.id] ?? null,sourceText:originals.find(c => c.item.id === root.id)?.sourceText ?? ''});
    }
  }
  return result;
}
