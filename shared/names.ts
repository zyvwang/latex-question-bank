import { isReservedTag } from "./review-fields.js";

export function normalizeUniqueName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function hasUniqueNormalizedNames(
  values: Array<{ name: string }>
): boolean {
  const names = new Set<string>();
  for (const value of values) {
    const name = normalizeUniqueName(value.name);
    if (!name || names.has(name)) return false;
    names.add(name);
  }
  return true;
}

export function normalizeBookTitle(value: string): string {
  return normalizeUniqueName(value);
}

// 追加新标签：NFKC 规范化、大小写不敏感去重，并丢弃空值和保留标签（如「待审阅」）。
export function mergeTags(existing: string[], added: string[]): string[] {
  const values = [...existing];
  const seen = new Set(existing.map(normalizeUniqueName));
  for (const tag of added) {
    const normalized = tag.trim().normalize("NFKC");
    if (!normalized || isReservedTag(normalized)) continue;
    const key = normalizeUniqueName(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values;
}
