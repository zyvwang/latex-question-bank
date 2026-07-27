import type { Bank, Chapter, QuestionItem } from "./types.js";

export function orderedChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
}

export function chapterRankById(chapters: Chapter[]): Map<string, number> {
  return new Map(orderedChapters(chapters).map((chapter, index) => [chapter.id, index]));
}

export function orderItemsByChapter(
  items: QuestionItem[],
  chapters: Chapter[]
): QuestionItem[] {
  const rank = chapterRankById(chapters);
  return [...items].sort((left, right) => {
    const leftRank = left.chapterId === null
      ? chapters.length
      : (rank.get(left.chapterId) ?? chapters.length + 1);
    const rightRank = right.chapterId === null
      ? chapters.length
      : (rank.get(right.chapterId) ?? chapters.length + 1);
    return (
      leftRank - rightRank ||
      left.chapterOrder - right.chapterOrder ||
      left.id.localeCompare(right.id)
    );
  });
}

export function itemsInChapter(
  items: QuestionItem[],
  chapterId: string | null
): QuestionItem[] {
  return items
    .filter((item) => item.chapterId === chapterId)
    .sort(
      (left, right) =>
        left.chapterOrder - right.chapterOrder || left.id.localeCompare(right.id)
    );
}

export function normalizeChapterItemOrders(
  items: QuestionItem[],
  updatedAt?: string
): QuestionItem[] {
  const groups = new Map<string | null, QuestionItem[]>();
  for (const item of items) {
    const group = groups.get(item.chapterId) ?? [];
    group.push(item);
    groups.set(item.chapterId, group);
  }
  const normalized = new Map<string, QuestionItem>();
  for (const group of groups.values()) {
    group
      .sort(
        (left, right) =>
          left.chapterOrder - right.chapterOrder || left.id.localeCompare(right.id)
      )
      .forEach((item, index) => {
        const chapterOrder = index + 1;
        normalized.set(item.id, {
          ...item,
          chapterOrder,
          updatedAt:
            updatedAt && item.chapterOrder !== chapterOrder ? updatedAt : item.updatedAt
        });
      });
  }
  return items.map((item) => normalized.get(item.id) ?? item);
}

export function moveItemWithinChapter(
  items: QuestionItem[],
  id: string,
  targetNumber: number,
  updatedAt = new Date().toISOString()
): QuestionItem[] {
  const movedItem = items.find((item) => item.id === id);
  if (!movedItem) return items;
  const group = itemsInChapter(items, movedItem.chapterId);
  if (targetNumber < 1 || targetNumber > group.length) return items;
  const nextGroup = group.filter((item) => item.id !== id);
  nextGroup.splice(targetNumber - 1, 0, movedItem);
  const replacement = new Map(
    nextGroup.map((item, index) => [
      item.id,
      { ...item, chapterOrder: index + 1, updatedAt }
    ])
  );
  return items.map((item) => replacement.get(item.id) ?? item);
}

export function reorderItemWithinChapterByDrop(
  items: QuestionItem[],
  draggedId: string,
  targetId: string,
  position: "before" | "after",
  updatedAt = new Date().toISOString()
): QuestionItem[] {
  if (draggedId === targetId) return items;
  const dragged = items.find((item) => item.id === draggedId);
  const target = items.find((item) => item.id === targetId);
  if (!dragged || !target || dragged.chapterId !== target.chapterId) return items;
  const group = itemsInChapter(items, dragged.chapterId).filter(
    (item) => item.id !== draggedId
  );
  const targetIndex = group.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return items;
  group.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, dragged);
  const replacement = new Map(
    group.map((item, index) => [
      item.id,
      { ...item, chapterOrder: index + 1, updatedAt }
    ])
  );
  return items.map((item) => replacement.get(item.id) ?? item);
}

export function findSourceNumberConflict(
  items: QuestionItem[],
  itemId: string,
  chapterId: string | null,
  sourceNumber: string | undefined
): QuestionItem | null {
  const normalizedSource = sourceNumber?.trim();
  if (!normalizedSource) return null;
  return (
    items.find(
      (item) =>
        item.id !== itemId &&
        item.chapterId === chapterId &&
        item.sourceNumber?.trim() === normalizedSource
    ) ?? null
  );
}

export function sourceNumberConflictGroups(
  items: QuestionItem[]
): QuestionItem[][] {
  const groups = new Map<string, QuestionItem[]>();
  for (const item of items) {
    const sourceNumber = item.sourceNumber?.trim();
    if (!sourceNumber) continue;
    const key = `${item.chapterId ?? "__uncategorized__"}\u0000${sourceNumber}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function normalizeBankOrder(bank: Bank): Bank {
  const chapters = orderedChapters(bank.chapters).map((chapter, index) => ({
    ...chapter,
    order: index + 1
  }));
  return {
    ...bank,
    chapters,
    items: normalizeChapterItemOrders(bank.items)
  };
}
