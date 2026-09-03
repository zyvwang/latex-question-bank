import { useDeferredValue, useMemo, useRef } from "react";
import type { Bank, Chapter, QuestionItem } from "../../shared/types.js";
import {
  orderItemsByChapter,
  orderedChapters,
  sourceNumberConflictGroups
} from "../../shared/chapter-order.js";
import {
  buildQuestionSearchText,
  matchesQuestionFilters,
  normalizeQuestionSearch,
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
  const orderCacheRef = useRef<OrderCache | null>(null);
  const tagCacheRef = useRef<TagCache | null>(null);
  const conflictCacheRef = useRef<ConflictCache | null>(null);
  const searchTextCacheRef = useRef(
    new WeakMap<QuestionItem, { chapterName: string; text: string }>()
  );

  const orderedItems = useMemo(() => {
    if (!bank) {
      orderCacheRef.current = null;
      return [];
    }
    const cache = orderCacheRef.current;
    const itemInputs = bank.items.map(toItemOrderInput);
    const chapterInputs = bank.chapters.map(toChapterOrderInput);
    let orderedIds = cache?.orderedIds;
    let numberById = cache?.numberById;
    if (
      !cache ||
      !sameItemOrderInputs(cache.itemInputs, itemInputs) ||
      !sameChapterOrderInputs(cache.chapterInputs, chapterInputs)
    ) {
      const sorted = orderItemsByChapter(bank.items, bank.chapters);
      orderedIds = sorted.map((item) => item.id);
      numberById = new Map(
        sorted.map((item) => [item.id, item.chapterOrder])
      );
      orderCacheRef.current = {
        itemInputs,
        chapterInputs,
        orderedIds,
        numberById
      };
    }
    const itemById = new Map(bank.items.map((item) => [item.id, item]));
    return (orderedIds ?? []).flatMap((id) => {
      const item = itemById.get(id);
      return item ? [item] : [];
    });
  }, [bank]);

  const numberById = orderCacheRef.current?.numberById ?? EMPTY_NUMBER_BY_ID;

  const chapters = useMemo(() => {
    return orderedChapters(bank?.chapters ?? []);
  }, [bank?.chapters]);

  const chapterById = useMemo(() => {
    return new Map(chapters.map((chapter) => [chapter.id, chapter]));
  }, [chapters]);

  const tags = useMemo(() => {
    const inputs = orderedItems.map((item) => ({ id: item.id, tags: item.tags }));
    const cache = tagCacheRef.current;
    if (cache && sameTagInputs(cache.inputs, inputs)) return cache.tags;
    const nextTags = [
      ...new Set(
        orderedItems
          .flatMap((item) => item.tags)
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    ].sort();
    tagCacheRef.current = { inputs, tags: nextTags };
    return nextTags;
  }, [orderedItems]);

  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo<QuestionFilters>(
    () => ({
      chapterFilters: filters.chapterFilters,
      tagFilters: filters.tagFilters,
      masteryFilters: filters.masteryFilters,
      errorReasonFilters: filters.errorReasonFilters,
      search: deferredSearch
    }),
    [
      deferredSearch,
      filters.chapterFilters,
      filters.errorReasonFilters,
      filters.masteryFilters,
      filters.tagFilters
    ]
  );
  const searchTerm = useMemo(
    () => normalizeQuestionSearch(deferredSearch),
    [deferredSearch]
  );
  const filterRuntime = useMemo(
    () => ({
      searchTerm,
      getSearchText: (candidate: QuestionItem, chapterName: string) => {
        const cached = searchTextCacheRef.current.get(candidate);
        if (cached?.chapterName === chapterName) return cached.text;
        const text = buildQuestionSearchText(candidate, chapterName);
        searchTextCacheRef.current.set(candidate, { chapterName, text });
        return text;
      }
    }),
    [searchTerm]
  );

  const filteredItems = useMemo(() => {
    return orderedItems.filter((item) =>
      matchesQuestionFilters(item, effectiveFilters, chapterById, filterRuntime)
    );
  }, [chapterById, effectiveFilters, filterRuntime, orderedItems]);

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

  const conflictGroups = useMemo(() => {
    const inputs = orderedItems.map((item) => ({
      id: item.id,
      chapterId: item.chapterId,
      sourceNumber: item.sourceNumber
    }));
    const cache = conflictCacheRef.current;
    if (cache && sameConflictInputs(cache.inputs, inputs)) {
      if (cache.groupIds.length === 0) return cache.emptyGroups;
      const itemById = new Map(orderedItems.map((item) => [item.id, item]));
      return cache.groupIds.map((ids) => ids.flatMap((id) => {
        const item = itemById.get(id);
        return item ? [item] : [];
      }));
    }
    const groups = sourceNumberConflictGroups(orderedItems);
    conflictCacheRef.current = {
      inputs,
      groupIds: groups.map((group) => group.map((item) => item.id)),
      emptyGroups: groups.length === 0 ? groups : []
    };
    return groups;
  }, [orderedItems]);

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

interface ItemOrderInput {
  id: string;
  chapterId: string | null;
  chapterOrder: number;
}

interface ChapterOrderInput {
  id: string;
  order: number;
}

interface OrderCache {
  itemInputs: ItemOrderInput[];
  chapterInputs: ChapterOrderInput[];
  orderedIds: string[];
  numberById: Map<string, number>;
}

interface TagInput {
  id: string;
  tags: string[];
}

interface TagCache {
  inputs: TagInput[];
  tags: string[];
}

interface ConflictInput {
  id: string;
  chapterId: string | null;
  sourceNumber?: string;
}

interface ConflictCache {
  inputs: ConflictInput[];
  groupIds: string[][];
  emptyGroups: QuestionItem[][];
}

const EMPTY_NUMBER_BY_ID = new Map<string, number>();

function toItemOrderInput(item: QuestionItem): ItemOrderInput {
  return {
    id: item.id,
    chapterId: item.chapterId,
    chapterOrder: item.chapterOrder
  };
}

function toChapterOrderInput(chapter: Chapter): ChapterOrderInput {
  return { id: chapter.id, order: chapter.order };
}

function sameItemOrderInputs(
  previous: ItemOrderInput[],
  next: ItemOrderInput[]
): boolean {
  return previous.length === next.length && previous.every((value, index) => {
    const candidate = next[index];
    return candidate !== undefined &&
      value.id === candidate.id &&
      value.chapterId === candidate.chapterId &&
      value.chapterOrder === candidate.chapterOrder;
  });
}

function sameChapterOrderInputs(
  previous: ChapterOrderInput[],
  next: ChapterOrderInput[]
): boolean {
  return previous.length === next.length && previous.every((value, index) => {
    const candidate = next[index];
    return candidate !== undefined &&
      value.id === candidate.id &&
      value.order === candidate.order;
  });
}

function sameTagInputs(previous: TagInput[], next: TagInput[]): boolean {
  return previous.length === next.length && previous.every((value, index) => {
    const candidate = next[index];
    return candidate !== undefined &&
      value.id === candidate.id &&
      value.tags === candidate.tags;
  });
}

function sameConflictInputs(
  previous: ConflictInput[],
  next: ConflictInput[]
): boolean {
  return previous.length === next.length && previous.every((value, index) => {
    const candidate = next[index];
    return candidate !== undefined &&
      value.id === candidate.id &&
      value.chapterId === candidate.chapterId &&
      value.sourceNumber === candidate.sourceNumber;
  });
}
