import { questionSourceSearchText } from "../shared/question-source.js";
import { tagDimensionOf } from "./tagDimensions.js";
import type {
  BookRecord,
  Chapter,
  QuestionItem
} from "../shared/types.js";

export const UNCATEGORIZED_FILTER = "__uncategorized__";
export const UNSET_BOOK_FILTER = "__unbound__";
export const UNSET_PRIORITY_FILTER = "__unset__";

export interface QuestionFilters {
  chapterFilters: string[];
  tagFilters: string[];
  bookFilters: string[];
  reviewPriorityFilters: string[];
  reviewStatusFilters: string[];
  search: string;
}

export interface QuestionFilterRuntime {
  searchTerm: string;
  getSearchText: (item: QuestionItem, chapterName: string) => string;
}

export function normalizeQuestionSearch(search: string): string {
  return search.trim().toLocaleLowerCase();
}

export function buildQuestionSearchText(
  item: QuestionItem,
  chapterName: string,
  books: BookRecord[]
): string {
  return [
    questionSourceSearchText(item, books),
    chapterName,
    item.tags.join(" "),
    item.modules.question.tex,
    item.modules.solution.tex,
    item.modules.note.tex
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function matchesQuestionFilters(
  item: QuestionItem,
  filters: QuestionFilters,
  chapterById: Map<string, Chapter>,
  books: BookRecord[],
  runtime?: QuestionFilterRuntime
): boolean {
  const matchesChapter =
    filters.chapterFilters.length === 0 ||
    filters.chapterFilters.some((filter) =>
      filter === UNCATEGORIZED_FILTER
        ? item.chapterId === null
        : item.chapterId === filter
    );
  const matchesTag = tagFilterGroups(filters.tagFilters).every((group) =>
    group.some((filter) => item.tags.includes(filter))
  );
  const matchesBook =
    filters.bookFilters.length === 0 ||
    filters.bookFilters.some((filter) =>
      filter === UNSET_BOOK_FILTER
        ? !item.source?.bookId
        : item.source?.bookId === filter
    );
  const matchesPriority =
    filters.reviewPriorityFilters.length === 0 ||
    filters.reviewPriorityFilters.some((filter) =>
      filter === UNSET_PRIORITY_FILTER
        ? item.reviewPriority === null
        : item.reviewPriority === filter
    );
  const matchesStatus =
    filters.reviewStatusFilters.length === 0 ||
    filters.reviewStatusFilters.includes(item.reviewStatus);
  if (
    !matchesChapter ||
    !matchesTag ||
    !matchesBook ||
    !matchesPriority ||
    !matchesStatus
  ) {
    return false;
  }

  const term = runtime?.searchTerm ?? normalizeQuestionSearch(filters.search);
  if (!term) return true;

  const chapterName =
    item.chapterId === null
      ? "未分类"
      : (chapterById.get(item.chapterId)?.name ?? "");
  const haystack = runtime
    ? runtime.getSearchText(item, chapterName)
    : buildQuestionSearchText(item, chapterName, books);
  return haystack.includes(term);
}

// 标签筛选：同一维度（考点/考法/题型/其他）内是「或」，不同维度之间是「且」。
const tagFilterGroupCache = new WeakMap<string[], string[][]>();

function tagFilterGroups(tagFilters: string[]): string[][] {
  if (tagFilters.length === 0) return [];
  const cached = tagFilterGroupCache.get(tagFilters);
  if (cached) return cached;
  const groups = new Map<string, string[]>();
  for (const filter of tagFilters) {
    const key = tagDimensionOf(filter)?.key ?? "other";
    groups.set(key, [...(groups.get(key) ?? []), filter]);
  }
  const result = [...groups.values()];
  tagFilterGroupCache.set(tagFilters, result);
  return result;
}
