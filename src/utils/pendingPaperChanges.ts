// Kept outside a screen so navigation and desktop close share the same boundary.
const boundaries = new Set<() => Promise<void>>();
export function registerPaperBoundary(flush: () => Promise<void>) {
  boundaries.add(flush);
  return () => { boundaries.delete(flush); };
}
export async function flushPaperChanges() {
  for (const flush of boundaries) await flush();
}

export function hasPaperBoundaries() { return boundaries.size > 0; }
