import { questionSourceSearchText } from "../shared/question-source.js";
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
  topicFilters: string[];
  typeFilters: string[];
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
    item.topics.join(" "),
    item.questionTypes.join(" "),
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
  // 考点、题型各自内部是「或」，两者之间是「且」。
  const matchesTopic =
    filters.topicFilters.length === 0 ||
    filters.topicFilters.some((filter) => item.topics.includes(filter));
  const matchesType =
    filters.typeFilters.length === 0 ||
    filters.typeFilters.some((filter) => item.questionTypes.includes(filter));
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
    !matchesTopic ||
    !matchesType ||
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
