import type {
  BookRecord,
  LatexSettings,
  QuestionItem
} from "../../shared/types.js";

export function compileContentVersion(
  item: QuestionItem,
  settings: LatexSettings,
  _books: BookRecord[] = []
): string {
  const content = JSON.stringify({
    modules: {
      question: item.modules.question.tex,
      solution: item.modules.solution.tex,
      note: item.modules.note.tex
    },
    assets: item.assets,
    settings
  });
  const bytes = new TextEncoder().encode(content);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
