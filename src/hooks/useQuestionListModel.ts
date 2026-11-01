import { useMemo } from "react";
import type { QuestionItem } from "../../shared/types.js";
import { useQuestions, useSelection, useWorkspaceUi } from "../context/questionBankContexts.js";
import { useDesktopQuestionList } from "./useDesktopQuestionList.js";

export function useQuestionListModel() {
  const desktop = useDesktopQuestionList();
  const questions = useQuestions();
  const selection = useSelection();
  const ui = useWorkspaceUi();
  const chapterById = useMemo(
    () => new Map(questions.bank?.chapters.map((chapter) => [chapter.id, chapter.name]) ?? []),
    [questions.bank?.chapters]
  );
  const books = useMemo(
    () => questions.bank?.books ?? [],
    [questions.bank?.books]
  );

  const groups = useMemo(() => {
    const result: { chapterId: string | null; items: QuestionItem[] }[] = [];
    for (const item of selection.listItems) {
      const previous = result.at(-1);
      if (previous && previous.chapterId === item.chapterId) {
        previous.items.push(item);
      } else {
        result.push({ chapterId: item.chapterId, items: [item] });
      }
    }
    return result;
  }, [selection.listItems]);

  return { desktop, questions, selection, ui, chapterById, books, groups };
}
