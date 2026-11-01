import { useMemo } from "react";
import type { Bank } from "../../shared/types.js";
import { useSelectionFilters } from "./useSelectionFilters.js";
import { useQuestionDerivedData } from "./useQuestionDerivedData.js";

export function useQuestionBankLists(
  bank: Bank | null,
  activeId: string | null,
  reviewMode: boolean
) {
  const selection = useSelectionFilters(bank);
  const filters = useMemo(
    () => ({
      chapterFilters: selection.chapterFilters,
      topicFilters: selection.topicFilters,
      typeFilters: selection.typeFilters,
      bookFilters: selection.bookFilters,
      reviewPriorityFilters: selection.reviewPriorityFilters,
      reviewStatusFilters: reviewMode
        ? ["pending"]
        : selection.reviewStatusFilters,
      search: selection.search
    }),
    [
      reviewMode,
      selection.bookFilters,
      selection.chapterFilters,
      selection.reviewPriorityFilters,
      selection.reviewStatusFilters,
      selection.search,
      selection.topicFilters,
      selection.typeFilters
    ]
  );
  const derived = useQuestionDerivedData(
    bank,
    activeId,
    filters,
    selection.selectedIds,
    reviewMode ? "current" : selection.listMode
  );
  return { selection, derived };
}
