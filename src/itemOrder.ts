import type { Bank, QuestionItem } from "../shared/types.js";
import {
  findSourceNumberConflict,
  itemsInChapter,
  moveItemWithinChapter,
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
 * 删除后的撤销窗口内,题目所属章节或引用的掌握/错因选项可能已被删除,
 * 若原样放回会产生磁盘校验拒绝的悬空引用,导致自动保存持续失败。
 * 章节仍在时插回原章内位置;章节已删则落到未分类末尾,掌握/错因失效项清为未设置。
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
  const targetChapterId = chapterStillExists ? deletedItem.chapterId : null;
  if (findSourceNumberConflict(bank.items, deletedItem.id, targetChapterId, deletedItem.sourceNumber ?? "")) {
    throw new Error(`无法撤销：原编号“${deletedItem.sourceNumber?.trim()}”已被目标章节中的其他题目使用。`);
  }
  const validErrorReasonIds = new Set(
    bank.errorReasonOptions.map((option) => option.id)
  );
  const sanitized: QuestionItem = {
    ...deletedItem,
    chapterId: chapterStillExists ? deletedItem.chapterId : null,
    masteryOptionId:
      deletedItem.masteryOptionId !== null &&
      bank.masteryOptions.some((option) => option.id === deletedItem.masteryOptionId)
        ? deletedItem.masteryOptionId
        : null,
    errorReasonOptionIds: deletedItem.errorReasonOptionIds.filter((id) =>
      validErrorReasonIds.has(id)
    ),
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
          chapterOrder: itemsInChapter(bank.items, null).length + 1
        }
      ];
  return { ...bank, items: normalizeChapterItemOrders(restoredItems, now) };
}
