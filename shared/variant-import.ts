import { isRecord, ValidationError } from './validation-primitives.js';
import { uuid } from './variants.js';

/** Each group is independently validated and committed by the local server. */
export interface VariantImportResult {
  operationId: string; status: 'completed' | 'dry-run'; familyId: string; rootId: string;
  variantIds: string[]; pendingCount: number; batchId: string | null;
}
export function parseVariantImportGroups(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > 200) throw new ValidationError('联合录入需要 schemaVersion:1 和 1 至 200 个 groups。');
  const ids = new Set<string>();
  return value.groups.map(group => {
    if (!isRecord(group) || !uuid(group.operationId) || ids.has(group.operationId)) throw new ValidationError('每组须使用不同的稳定 operationId UUID。');
    ids.add(group.operationId);
    return group;
  });
}

export function canonicalImportJson(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
  return JSON.stringify(canonical(value));
}
