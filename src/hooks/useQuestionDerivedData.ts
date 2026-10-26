import { useDeferredValue, useMemo, useRef } from "react";
import type { Bank, Chapter, QuestionItem } from "../../shared/types.js";
import {
  orderItemsByChapter,
  orderedChapters
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
  const books = useMemo(() => bank?.books ?? [], [bank?.books]);
  const effectiveFilters = useMemo<QuestionFilters>(
    () => ({
      chapterFilters: filters.chapterFilters,
      tagFilters: filters.tagFilters,
      bookFilters: filters.bookFilters,
      reviewPriorityFilters: filters.reviewPriorityFilters,
      reviewStatusFilters: filters.reviewStatusFilters,
      search: deferredSearch
    }),
    [
      deferredSearch,
      filters.bookFilters,
      filters.chapterFilters,
      filters.reviewPriorityFilters,
      filters.reviewStatusFilters,
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
        const text = buildQuestionSearchText(candidate, chapterName, books);
        searchTextCacheRef.current.set(candidate, { chapterName, text });
        return text;
      }
    }),
    [books, searchTerm]
  );

  const filteredItems = useMemo(() => {
    return orderedItems.filter((item) =>
      matchesQuestionFilters(
        item,
        effectiveFilters,
        chapterById,
        books,
        filterRuntime
      )
    );
  }, [books, chapterById, effectiveFilters, filterRuntime, orderedItems]);

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

  return {
    orderedItems,
    filteredItems,
    listItems,
    numberById,
    chapters,
    chapterById,
    tags,
    activeItem
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

