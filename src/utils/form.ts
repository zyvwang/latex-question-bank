export function appendTex(current: string, addition: string): string {
  return [current.trimEnd(), addition].filter(Boolean).join("\n\n");
}
