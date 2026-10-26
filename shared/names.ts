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
