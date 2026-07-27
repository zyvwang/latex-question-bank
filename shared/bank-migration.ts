import type {
  Bank,
  Chapter,
  LegacyBank,
  QuestionItem
} from "./types.js";
import {
  cloneDefaultErrorReasonOptions,
  cloneDefaultMasteryOptions,
  normalizeUniqueName
} from "./review-options.js";

export function migrateLegacyBank(bank: LegacyBank): Bank {
  const legacyItems = [...bank.items].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const chapters: Chapter[] = [];
  const chapterByName = new Map<string, Chapter>();
  const usedChapterIds = new Set<string>();

  for (const item of legacyItems) {
    const displayName = item.chapter.trim().normalize("NFKC");
    const normalizedName = normalizeUniqueName(displayName);
    if (!normalizedName || chapterByName.has(normalizedName)) continue;
    const chapter: Chapter = {
      id: deterministicChapterId(normalizedName, usedChapterIds),
      name: displayName,
      order: chapters.length + 1
    };
    chapters.push(chapter);
    chapterByName.set(normalizedName, chapter);
  }

  const nextOrder = new Map<string | null, number>();
  const items: QuestionItem[] = legacyItems.map((item) => {
    const chapterName = normalizeUniqueName(item.chapter);
    const chapterId = chapterName ? (chapterByName.get(chapterName)?.id ?? null) : null;
    const chapterOrder = (nextOrder.get(chapterId) ?? 0) + 1;
    nextOrder.set(chapterId, chapterOrder);
    return {
      id: item.id,
      sourceNumber: item.sourceNumber,
      chapterId,
      chapterOrder,
      tags: [...item.tags],
      masteryOptionId: null,
      errorReasonOptionIds: [],
      modules: {
        question: { ...item.modules.question },
        solution: { ...item.modules.solution },
        note: { ...item.modules.note }
      },
      assets: item.assets.map((asset) => ({ ...asset })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  });

  return {
    version: 2,
    settings: {
      ...bank.settings,
      spacing: { ...bank.settings.spacing }
    },
    chapters,
    masteryOptions: cloneDefaultMasteryOptions(),
    errorReasonOptions: cloneDefaultErrorReasonOptions(),
    masteryHistory: [],
    items
  };
}

function deterministicChapterId(
  normalizedName: string,
  usedIds: Set<string>
): string {
  const base = `chapter-${fnv1a32(normalizedName).toString(16).padStart(8, "0")}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
