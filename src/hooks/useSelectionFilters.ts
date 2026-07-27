import { useCallback, useEffect, useState } from "react";
import type { Bank, QuestionItem } from "../../shared/types.js";
import {
  UNCATEGORIZED_FILTER,
  UNSET_REVIEW_FILTER
} from "../questionFilters.js";

export type QuestionListMode = "current" | "selected";

export function useSelectionFilters(bank: Bank | null) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chapterFilters, setChapterFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [masteryFilters, setMasteryFilters] = useState<string[]>([]);
  const [errorReasonFilters, setErrorReasonFilters] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [listMode, setListMode] = useState<QuestionListMode>("current");

  const clearFilters = useCallback(() => {
    setChapterFilters([]);
    setTagFilters([]);
    setMasteryFilters([]);
    setErrorReasonFilters([]);
    setSearch("");
    setListMode("current");
  }, []);

  useEffect(() => {
    if (!bank) return;
    const validChapters = new Set([
      ...bank.chapters.map((chapter) => chapter.id),
      UNCATEGORIZED_FILTER
    ]);
    const validTags = new Set(
      bank.items.flatMap((item) => item.tags.map((tag) => tag.trim())).filter(Boolean)
    );
    const validMastery = new Set([
      ...bank.masteryOptions.map((option) => option.id),
      UNSET_REVIEW_FILTER
    ]);
    const validErrorReasons = new Set([
      ...bank.errorReasonOptions.map((option) => option.id),
      UNSET_REVIEW_FILTER
    ]);
    setChapterFilters((current) => retainValid(current, validChapters));
    setTagFilters((current) => retainValid(current, validTags));
    setMasteryFilters((current) => retainValid(current, validMastery));
    setErrorReasonFilters((current) => retainValid(current, validErrorReasons));
  }, [bank]);

  const selectAllItems = useCallback((items: QuestionItem[]) => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  }, []);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible(visibleItems: QuestionItem[]) {
    const visibleIds = visibleItems.map((item) => item.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }

  return {
    selectedIds,
    setSelectedIds,
    chapterFilters,
    tagFilters,
    masteryFilters,
    errorReasonFilters,
    search,
    listMode,
    setChapterFilters,
    setTagFilters,
    setMasteryFilters,
    setErrorReasonFilters,
    setSearch,
    setListMode,
    clearFilters,
    selectAllItems,
    toggleSelected,
    toggleAllVisible
  };
}

function retainValid(current: string[], valid: Set<string>): string[] {
  const next = current.filter((value) => valid.has(value));
  return next.length === current.length ? current : next;
}
