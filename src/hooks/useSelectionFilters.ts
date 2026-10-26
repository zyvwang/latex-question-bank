import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bank, QuestionItem } from "../../shared/types.js";
import {
  UNCATEGORIZED_FILTER,
  UNSET_BOOK_FILTER,
  UNSET_PRIORITY_FILTER
} from "../questionFilters.js";

export type QuestionListMode = "current" | "selected";

export function useSelectionFilters(bank: Bank | null) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chapterFilters, setChapterFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [bookFilters, setBookFilters] = useState<string[]>([]);
  const [reviewPriorityFilters, setReviewPriorityFilters] = useState<string[]>([]);
  const [reviewStatusFilters, setReviewStatusFilters] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [listMode, setListMode] = useState<QuestionListMode>("current");
  const hasBank = bank !== null;
  const tagCacheRef = useRef<{
    inputs: Array<{ id: string; tags: string[] }>;
    values: Set<string>;
  } | null>(null);

  const clearFilters = useCallback(() => {
    setChapterFilters([]);
    setTagFilters([]);
    setBookFilters([]);
    setReviewPriorityFilters([]);
    setReviewStatusFilters([]);
    setSearch("");
    setListMode("current");
  }, []);

  const validChapters = useMemo(() => new Set([
    ...(bank?.chapters.map((chapter) => chapter.id) ?? []),
    UNCATEGORIZED_FILTER
  ]), [bank?.chapters]);
  const validBooks = useMemo(() => new Set([
    ...(bank?.books.map((book) => book.id) ?? []),
    UNSET_BOOK_FILTER
  ]), [bank?.books]);
  const validPriorities = useMemo(
    () => new Set(["skip", "recheck", "must", UNSET_PRIORITY_FILTER]),
    []
  );
  const validStatuses = useMemo(() => new Set(["pending", "approved"]), []);
  const validTags = useMemo(() => {
    const inputs = (bank?.items ?? []).map((item) => ({
      id: item.id,
      tags: item.tags
    }));
    const cache = tagCacheRef.current;
    if (cache && sameTagInputs(cache.inputs, inputs)) return cache.values;
    const values = new Set(
      (bank?.items ?? [])
        .flatMap((item) => item.tags.map((tag) => tag.trim()))
        .filter(Boolean)
    );
    tagCacheRef.current = { inputs, values };
    return values;
  }, [bank?.items]);

  useEffect(() => {
    if (!hasBank) return;
    setChapterFilters((current) => retainValid(current, validChapters));
  }, [hasBank, validChapters]);

  useEffect(() => {
    if (!hasBank) return;
    setTagFilters((current) => retainValid(current, validTags));
  }, [hasBank, validTags]);

  useEffect(() => {
    if (!hasBank) return;
    setBookFilters((current) => retainValid(current, validBooks));
  }, [hasBank, validBooks]);

  useEffect(() => {
    if (!hasBank) return;
    setReviewPriorityFilters((current) =>
      retainValid(current, validPriorities)
    );
  }, [hasBank, validPriorities]);

  useEffect(() => {
    if (!hasBank) return;
    setReviewStatusFilters((current) => retainValid(current, validStatuses));
  }, [hasBank, validStatuses]);

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
    bookFilters,
    reviewPriorityFilters,
    reviewStatusFilters,
    search,
    listMode,
    setChapterFilters,
    setTagFilters,
    setBookFilters,
    setReviewPriorityFilters,
    setReviewStatusFilters,
    setSearch,
    setListMode,
    clearFilters,
    selectAllItems,
    toggleSelected,
    toggleAllVisible
  };
}

function sameTagInputs(
  previous: Array<{ id: string; tags: string[] }>,
  next: Array<{ id: string; tags: string[] }>
): boolean {
  return previous.length === next.length && previous.every((value, index) => {
    const candidate = next[index];
    return candidate !== undefined &&
      value.id === candidate.id &&
      value.tags === candidate.tags;
  });
}

function retainValid(current: string[], valid: Set<string>): string[] {
  const next = current.filter((value) => valid.has(value));
  return next.length === current.length ? current : next;
}
