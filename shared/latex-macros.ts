export interface MacroMatch {
  start: number;
  end: number;
  optional: string | null;
  args: string[];
}

/**
 * Finds `\name[optional]{arg1}...{argN}` occurrences with balanced braces.
 * Occurrences whose arguments are missing or unbalanced are skipped so that
 * half-typed editor content never throws.
 */
export function findMacros(tex: string, name: string, argCount: number): MacroMatch[] {
  const matches: MacroMatch[] = [];
  const token = `\\${name}`;
  let from = 0;
  while (from < tex.length) {
    const start = tex.indexOf(token, from);
    if (start < 0) break;
    from = start + token.length;
    if (start > 0 && tex[start - 1] === "\\") continue;
    if (/[A-Za-z@]/.test(tex[from] ?? "")) continue;

    let cursor = skipSpaces(tex, from);
    let optional: string | null = null;
    if (tex[cursor] === "[") {
      const close = tex.indexOf("]", cursor + 1);
      if (close < 0) continue;
      optional = tex.slice(cursor + 1, close).trim();
      cursor = skipSpaces(tex, close + 1);
    }

    const args: string[] = [];
    while (args.length < argCount) {
      if (tex[cursor] !== "{") break;
      const close = findClosingBrace(tex, cursor);
      if (close < 0) break;
      args.push(tex.slice(cursor + 1, close));
      cursor = close + 1;
      if (args.length < argCount) cursor = skipSpaces(tex, cursor);
    }
    if (args.length !== argCount) continue;

    matches.push({ start, end: cursor, optional, args });
    from = cursor;
  }
  return matches;
}

function skipSpaces(tex: string, index: number): number {
  let cursor = index;
  while (cursor < tex.length && /\s/.test(tex[cursor])) cursor += 1;
  return cursor;
}

function findClosingBrace(tex: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tex.length; index += 1) {
    const ch = tex[index];
    if (ch === "\\") {
      index += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
