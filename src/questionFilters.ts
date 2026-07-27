import type { Chapter, QuestionItem } from "../shared/types.js";

export const UNCATEGORIZED_FILTER = "__uncategorized__";
export const UNSET_REVIEW_FILTER = "__unset__";

export interface QuestionFilters {
  chapterFilters: string[];
  tagFilters: string[];
  masteryFilters: string[];
  errorReasonFilters: string[];
  search: string;
}

export function matchesQuestionFilters(
  item: QuestionItem,
  filters: QuestionFilters,
  chapterById: Map<string, Chapter>
): boolean {
  const chapterName =
    item.chapterId === null ? "未分类" : (chapterById.get(item.chapterId)?.name ?? "");
  const matchesChapter =
    filters.chapterFilters.length === 0 ||
    filters.chapterFilters.some((filter) =>
      filter === UNCATEGORIZED_FILTER
        ? item.chapterId === null
        : item.chapterId === filter
    );
  const matchesTag =
    filters.tagFilters.length === 0 ||
    filters.tagFilters.some((filter) => item.tags.includes(filter));
  const matchesMastery =
    filters.masteryFilters.length === 0 ||
    filters.masteryFilters.some((filter) =>
      filter === UNSET_REVIEW_FILTER
        ? item.masteryOptionId === null
        : item.masteryOptionId === filter
    );
  const matchesErrorReason =
    filters.errorReasonFilters.length === 0 ||
    filters.errorReasonFilters.some((filter) =>
      filter === UNSET_REVIEW_FILTER
        ? item.errorReasonOptionIds.length === 0
        : item.errorReasonOptionIds.includes(filter)
    );
  const term = filters.search.trim().toLocaleLowerCase();
  const haystack = [
    item.sourceNumber,
    chapterName,
    item.tags.join(" "),
    item.modules.question.tex,
    item.modules.solution.tex,
    item.modules.note.tex
  ]
    .join(" ")
    .toLocaleLowerCase();

  return (
    matchesChapter &&
    matchesTag &&
    matchesMastery &&
    matchesErrorReason &&
    (!term || haystack.includes(term))
  );
}
