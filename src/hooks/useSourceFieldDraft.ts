import { useLayoutEffect, useRef, useState } from "react";
import { normalizeSourceLabel } from "../../shared/question-source.js";
import { useQuestions, useBankSettings, useLifecycle } from "../context/questionBankContexts.js";

export function useSourceFieldDraft() {
  const questions = useQuestions();
  const settings = useBankSettings();
  const lifecycle = useLifecycle();
  const item = questions.activeItem;
  const [bookId, setBookId] = useState(item?.source?.bookId ?? "");
  const [label, setLabel] = useState(item?.source?.label ?? "");
  const bookIdRef = useRef(item?.source?.bookId ?? "");
  const labelRef = useRef(item?.source?.label ?? "");
  const committedRef = useRef({
    bookId: item?.source?.bookId ?? "",
    label: item?.source?.label ?? ""
  });
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    const nextBookId = item?.source?.bookId ?? "";
    const nextLabel = item?.source?.label ?? "";
    setBookId(nextBookId);
    setLabel(nextLabel);
    bookIdRef.current = nextBookId;
    labelRef.current = nextLabel;
    committedRef.current = { bookId: nextBookId, label: nextLabel };
  }, [item?.id, item?.source?.bookId, item?.source?.label]);

  const currentItem = item;

  function commit(
    nextBookId = bookIdRef.current,
    nextLabel = labelRef.current
  ) {
    if (!currentItem) return;
    const resolvedBookId = nextBookId || null;
    const resolvedLabel = normalizeSourceLabel(nextLabel);
    if (resolvedBookId && !resolvedLabel) {
      lifecycle.setNotice({
        type: "error",
        text: "选择了书目时请填写题号。"
      });
      return;
    }
    const nextSource =
      resolvedBookId || resolvedLabel
        ? { bookId: resolvedBookId, label: resolvedLabel }
        : null;
    if (questions.commitSource(currentItem.id, nextSource)) {
      committedRef.current = {
        bookId: nextBookId,
        label: resolvedLabel
      };
    } else {
      bookIdRef.current = committedRef.current.bookId;
      labelRef.current = committedRef.current.label;
      setBookId(committedRef.current.bookId);
      setLabel(committedRef.current.label);
    }
  }

  function changeBookId(nextBookId: string) {
    bookIdRef.current = nextBookId;
    setBookId(nextBookId);
    if (labelRef.current.trim()) commit(nextBookId, labelRef.current);
  }

  function changeLabel(nextLabel: string) {
    labelRef.current = nextLabel;
    setLabel(nextLabel);
  }

  function createBook() {
    const title = window.prompt("新建书目名称");
    if (!title?.trim()) return;
    const nextBookId = settings.createBook(title);
    if (!nextBookId) return;
    bookIdRef.current = nextBookId;
    setBookId(nextBookId);
    if (labelRef.current.trim()) commit(nextBookId, labelRef.current);
    else labelInputRef.current?.focus();
  }

  return {
    item, books: settings.books, bookId, label,
    changeBookId, changeLabel, labelInputRef, commit, createBook
  };
}
