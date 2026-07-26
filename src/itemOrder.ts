import type { QuestionItem } from "../shared/types.js";
import {
  moveItemWithinChapter,
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
