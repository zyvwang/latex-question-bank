import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  itemsInChapter,
  normalizeChapterItemOrders
} from "../../shared/chapter-order.js";
import { restoreDeletedItem } from "../itemOrder.js";
import type { Bank, QuestionItem } from "../../shared/types.js";
import type { AddMode, Notice } from "./controllerTypes.js";

interface QuestionItemActionsOptions {
  activeItem: QuestionItem | null;
  orderedItems: QuestionItem[];
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setNotice: (notice: Notice | null) => void;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  updateBank: (updater: (current: Bank) => Bank) => void;
  clearFilters: () => void;
  closeMenus: () => void;
  workspacePath: string;
}

export function useQuestionItemActions({
  activeItem,
  orderedItems,
  setActiveId,
  setNotice,
  setSelectedIds,
  updateBank,
  clearFilters,
  closeMenus,
  workspacePath
}: QuestionItemActionsOptions) {
  const [deletedItem, setDeletedItem] = useState<QuestionItem | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  function clearDeletedUndo() {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setDeletedItem(null);
  }

  useEffect(() => {
    clearDeletedUndo();
    return () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    };
  }, [workspacePath]);

  function addItem(mode: AddMode = { type: "append" }) {
    const anchor =
      mode.type === "append"
        ? null
        : orderedItems.find((item) => item.id === mode.afterId) ?? null;
    if (mode.type !== "append" && !anchor) return;

    const chapterId = anchor?.chapterId ?? null;
    const chapterItems = itemsInChapter(orderedItems, chapterId);
    const chapterOrder =
      mode.type === "insertAfter" && anchor
        ? anchor.chapterOrder + 1
        : chapterItems.length + 1;
    const item = createQuestionItem(chapterId, chapterOrder);
    const now = item.createdAt;

    updateBank((current) => ({
      ...current,
      items: [
        ...current.items.map((candidate) =>
          candidate.chapterId === chapterId &&
          candidate.chapterOrder >= chapterOrder
            ? {
                ...candidate,
                chapterOrder: candidate.chapterOrder + 1,
                updatedAt: now
              }
            : candidate
        ),
        item
      ]
    }));
    setActiveId(item.id);
    setSelectedIds((current) => new Set([...current, item.id]));
    clearFilters();
    closeMenus();
    window.setTimeout(() => {
      const target = document.getElementById(`question-nav-${item.id}`);
      target?.scrollIntoView?.({ block: "nearest" });
      target?.focus();
    }, 0);
    const location =
      mode.type === "insertAfter"
        ? `当前题后（章内第 ${chapterOrder} 题）`
        : mode.type === "chapterEnd"
          ? `当前章末（章内第 ${chapterOrder} 题）`
          : `末尾未分类区域（章内第 ${chapterOrder} 题）`;
    setNotice({ type: "ok", text: `已插入${location}。` });
  }

  function deleteItem(id: string) {
    const item = orderedItems.find((candidate) => candidate.id === id);
    if (!item) return;
    const label = item.sourceNumber || `章内第 ${item.chapterOrder} 题`;
    if (!window.confirm(`确定删除“${label}”吗？\n\n删除后可在 10 秒内撤销。`)) {
      return;
    }
    const remaining = normalizeChapterItemOrders(
      orderedItems.filter((candidate) => candidate.id !== id),
      new Date().toISOString()
    );
    updateBank((current) => ({ ...current, items: remaining }));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    const sameChapter = itemsInChapter(remaining, item.chapterId);
    setActiveId((currentActiveId) =>
      currentActiveId === id
        ? sameChapter[Math.min(item.chapterOrder - 1, sameChapter.length - 1)]?.id ??
          remaining[0]?.id ??
          null
        : currentActiveId
    );
    closeMenus();
    clearDeletedUndo();
    setDeletedItem(item);
    undoTimerRef.current = window.setTimeout(clearDeletedUndo, 10_000);
    setNotice({ type: "info", text: "题目已删除，可在 10 秒内撤销。" });
  }

  function undoDelete() {
    if (!deletedItem) return;
    updateBank((current) => restoreDeletedItem(current, deletedItem));
    setSelectedIds((current) => new Set([...current, deletedItem.id]));
    setActiveId(deletedItem.id);
    clearDeletedUndo();
    setNotice({ type: "ok", text: "已撤销删除。" });
  }

  function moveActive(direction: -1 | 1) {
    if (!activeItem) return;
    const chapterItems = itemsInChapter(orderedItems, activeItem.chapterId);
    const index = chapterItems.findIndex((item) => item.id === activeItem.id);
    const target = index + direction;
    if (target < 0 || target >= chapterItems.length) return;
    const now = new Date().toISOString();
    const other = chapterItems[target];
    updateBank((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id === activeItem.id) {
          return { ...item, chapterOrder: other.chapterOrder, updatedAt: now };
        }
        if (item.id === other.id) {
          return { ...item, chapterOrder: activeItem.chapterOrder, updatedAt: now };
        }
        return item;
      })
    }));
  }

  return {
    addItem,
    deleteItem,
    deleteActiveItem: () => {
      if (activeItem) deleteItem(activeItem.id);
    },
    moveActive,
    canUndoDelete: Boolean(deletedItem),
    undoDelete
  };
}

function createQuestionItem(
  chapterId: string | null,
  chapterOrder: number
): QuestionItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sourceNumber: "",
    chapterId,
    chapterOrder,
    tags: [],
    masteryOptionId: null,
    errorReasonOptionIds: [],
    modules: {
      question: { tex: "" },
      solution: { tex: "" },
      note: { tex: "" }
    },
    assets: [],
    createdAt: now,
    updatedAt: now
  };
}
