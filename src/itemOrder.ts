import type { Bank, QuestionItem } from "../shared/types.js";
import {
  findSourceConflict,
  moveItemWithinChapter,
  nextChapterOrder,
  normalizeChapterItemOrders,
  reorderItemWithinChapterByDrop
} from "../shared/chapter-order.js";

export type DropPosition = "before" | "after";

export function withOrder(item: QuestionItem, index: number, updatedAt = new Date().toISOString()): QuestionItem {
  return { ...item, chapterOrder: index + 1, updatedAt };
}

export function moveItemToPositionInList(
  items: QuestionItem[],
  id: string,
  targetNumber: number,
  updatedAt = new Date().toISOString()
): QuestionItem[] {
  return moveItemWithinChapter(items, id, targetNumber, updatedAt);
}

export function reorderItemByDrop(
  items: QuestionItem[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
  updatedAt = new Date().toISOString()
): QuestionItem[] {
  return reorderItemWithinChapterByDrop(
    items,
    draggedId,
    targetId,
    position,
    updatedAt
  );
}

/**
 * 撤销删除时把题目放回 bank,并按当前 bank 消毒失效引用:
 * 删除后的撤销窗口内,题目所属章节或书目可能已被删除,
 * 若原样放回会产生磁盘校验拒绝的悬空引用,导致自动保存持续失败。
 * 章节仍在时插回原章内位置;章节已删则落到未分类末尾;书目已删则保留题号但解除书目关联。
 */
export function restoreDeletedItem(
  bank: Bank,
  deletedItem: QuestionItem,
  now = new Date().toISOString()
): Bank {
  if (bank.items.some((item) => item.id === deletedItem.id)) return bank;
  const chapterStillExists =
    deletedItem.chapterId !== null &&
    bank.chapters.some((chapter) => chapter.id === deletedItem.chapterId);
  const conflict = findSourceConflict(
    bank.items,
    deletedItem.id,
    deletedItem.source
  );
  if (conflict) {
    throw new Error(
      `无法撤销：来源题号“${deletedItem.source?.label ?? ""}”已被其他题目使用。`
    );
  }
  const bookStillExists =
    !deletedItem.source?.bookId ||
    bank.books.some((book) => book.id === deletedItem.source?.bookId);
  const sanitized: QuestionItem = {
    ...deletedItem,
    chapterId: chapterStillExists ? deletedItem.chapterId : null,
    source:
      deletedItem.source && !bookStillExists
        ? { bookId: null, label: deletedItem.source.label }
        : deletedItem.source,
    updatedAt: now
  };
  const restoredItems = chapterStillExists
    ? [
        ...bank.items.map((item) =>
          item.chapterId === sanitized.chapterId &&
          item.chapterOrder >= deletedItem.chapterOrder
            ? { ...item, chapterOrder: item.chapterOrder + 1, updatedAt: now }
            : item
        ),
        { ...sanitized, chapterOrder: deletedItem.chapterOrder }
      ]
    : [
        ...bank.items,
        {
          ...sanitized,
          chapterOrder: nextChapterOrder(bank.items, null)
        }
      ];
  return { ...bank, items: normalizeChapterItemOrders(restoredItems, now) };
}
