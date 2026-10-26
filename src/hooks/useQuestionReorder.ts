import type { Dispatch, SetStateAction } from "react";
import type { Bank, QuestionItem } from "../../shared/types.js";
import type { Notice } from "./controllerTypes.js";
import { useQuestionDrag } from "./useQuestionDrag.js";
import { useQuestionItemActions } from "./useQuestionItemActions.js";
import { useQuestionMenus } from "./useQuestionMenus.js";

interface QuestionReorderOptions {
  bank: Bank | null;
  activeItem: QuestionItem | null;
  numberById: Map<string, number>;
  orderedItems: QuestionItem[];
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setNotice: (notice: Notice | null) => void;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  updateBank: (updater: (current: Bank) => Bank) => void;
  clearFilters: () => void;
  workspacePath: string;
}

export function useQuestionReorder(options: QuestionReorderOptions) {
  const menus = useQuestionMenus(options);
  const drag = useQuestionDrag(options);
  const actions = useQuestionItemActions({
    ...options,
    closeMenus: menus.closeMenus
  });
  return { ...menus, ...drag, ...actions };
}
