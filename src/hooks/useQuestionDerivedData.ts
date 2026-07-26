import { useMemo } from "react";
import type { Bank } from "../../shared/types.js";
import {
  orderItemsByChapter,
  orderedChapters,
  sourceNumberConflictGroups
} from "../../shared/chapter-order.js";
import {
  matchesQuestionFilters,
  type QuestionFilters
} from "../questionFilters.js";
import type { QuestionListMode } from "./useSelectionFilters.js";

export function useQuestionDerivedData(
  bank: Bank | null,
  activeId: string | null,
  filters: QuestionFilters,
  selectedIds: Set<string>,
  listMode: QuestionListMode
) {
  const orderedItems = useMemo(() => {
    return bank ? orderItemsByChapter(bank.items, bank.chapters) : [];
  }, [bank]);

  const numberById = useMemo(() => {
    return new Map(orderedItems.map((item) => [item.id, item.chapterOrder]));
  }, [orderedItems]);

  const chapters = useMemo(() => {
    return orderedChapters(bank?.chapters ?? []);
  }, [bank?.chapters]);

  const chapterById = useMemo(() => {
    return new Map(chapters.map((chapter) => [chapter.id, chapter]));
  }, [chapters]);

  const tags = useMemo(() => {
    return [...new Set(orderedItems.flatMap((item) => item.tags).map((tag) => tag.trim()).filter(Boolean))].sort();
  }, [orderedItems]);

  const filteredItems = useMemo(() => {
    return orderedItems.filter((item) =>
      matchesQuestionFilters(item, filters, chapterById)
    );
  }, [chapterById, filters, orderedItems]);

  const listItems = useMemo(
    () =>
      listMode === "selected"
        ? orderedItems.filter((item) => selectedIds.has(item.id))
        : filteredItems,
    [filteredItems, listMode, orderedItems, selectedIds]
  );

  const activeItem = useMemo(() => {
    return orderedItems.find((item) => item.id === activeId) ?? orderedItems[0] ?? null;
  }, [activeId, orderedItems]);

  const conflictGroups = useMemo(
    () => sourceNumberConflictGroups(orderedItems),
    [orderedItems]
  );

  return {
    orderedItems,
    filteredItems,
    listItems,
    numberById,
    chapters,
    chapterById,
    tags,
    activeItem,
    conflictGroups
  };
}
