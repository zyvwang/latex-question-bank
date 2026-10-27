import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bank, QuestionItem } from "../../shared/types.js";
import {
  UNCATEGORIZED_FILTER,
  UNSET_BOOK_FILTER,
  UNSET_PRIORITY_FILTER
} from "../questionFilters.js";

export type QuestionListMode = "current" | "selected";

type LabelField = "topics" | "questionTypes";
type LabelInputs = Array<{ id: string; values: string[] }>;

export function useSelectionFilters(bank: Bank | null) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chapterFilters, setChapterFilters] = useState<string[]>([]);
  const [topicFilters, setTopicFilters] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [bookFilters, setBookFilters] = useState<string[]>([]);
  const [reviewPriorityFilters, setReviewPriorityFilters] = useState<string[]>([]);
  const [reviewStatusFilters, setReviewStatusFilters] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [listMode, setListMode] = useState<QuestionListMode>("current");
  const hasBank = bank !== null;

  const clearFilters = useCallback(() => {
    setChapterFilters([]);
    setTopicFilters([]);
    setTypeFilters([]);
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
  const validTopics = useLabelValueSet(bank?.items, "topics");
  const validTypes = useLabelValueSet(bank?.items, "questionTypes");

  useEffect(() => {
    if (!hasBank) return;
    setChapterFilters((current) => retainValid(current, validChapters));
  }, [hasBank, validChapters]);

  useEffect(() => {
    if (!hasBank) return;
    setTopicFilters((current) => retainValid(current, validTopics));
  }, [hasBank, validTopics]);

  useEffect(() => {
    if (!hasBank) return;
    setTypeFilters((current) => retainValid(current, validTypes));
  }, [hasBank, validTypes]);

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
    topicFilters,
    typeFilters,
    bookFilters,
    reviewPriorityFilters,
    reviewStatusFilters,
    search,
    listMode,
    setChapterFilters,
    setTopicFilters,
    setTypeFilters,
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

// 编辑正文不会换掉 topics/questionTypes 数组引用，按引用比较可以跳过重算。
function useLabelValueSet(
  items: QuestionItem[] | undefined,
  field: LabelField
): Set<string> {
  const cacheRef = useRef<{ inputs: LabelInputs; values: Set<string> } | null>(null);
  return useMemo(() => {
    const inputs = (items ?? []).map((item) => ({ id: item.id, values: item[field] }));
    const cache = cacheRef.current;
    if (cache && sameLabelInputs(cache.inputs, inputs)) return cache.values;
    const values = new Set(inputs.flatMap((input) => input.values));
    cacheRef.current = { inputs, values };
    return values;
  }, [items, field]);
}

function sameLabelInputs(previous: LabelInputs, next: LabelInputs): boolean {
  return previous.length === next.length && previous.every((value, index) => {
    const candidate = next[index];
    return candidate !== undefined &&
      value.id === candidate.id &&
      value.values === candidate.values;
  });
}

function retainValid(current: string[], valid: Set<string>): string[] {
  const next = current.filter((value) => valid.has(value));
  return next.length === current.length ? current : next;
}
