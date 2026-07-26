import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Dispatch,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  SetStateAction
} from "react";
import { moveItemToPositionInList } from "../itemOrder.js";
import { itemsInChapter } from "../../shared/chapter-order.js";
import { validateReorderTarget } from "../questionReorder.js";
import type { Bank, QuestionItem } from "../../shared/types.js";
import type { AddMenu, Notice, ReorderMenu } from "./controllerTypes.js";

interface QuestionMenusOptions {
  activeItem: QuestionItem | null;
  numberById: Map<string, number>;
  orderedItems: QuestionItem[];
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setNotice: (notice: Notice | null) => void;
  updateBank: (updater: (current: Bank) => Bank) => void;
}

export function useQuestionMenus({
  activeItem,
  numberById,
  orderedItems,
  setActiveId,
  setNotice,
  updateBank
}: QuestionMenusOptions) {
  const [reorderMenu, setReorderMenu] = useState<ReorderMenu | null>(null);
  const [addMenu, setAddMenu] = useState<AddMenu | null>(null);
  const [reorderDialogId, setReorderDialogId] = useState<string | null>(null);
  const [reorderTarget, setReorderTarget] = useState("");
  const [reorderError, setReorderError] = useState("");
  const reorderInputRef = useRef<HTMLInputElement | null>(null);

  const reorderDialogItem = useMemo(
    () => orderedItems.find((item) => item.id === reorderDialogId) ?? null,
    [orderedItems, reorderDialogId]
  );

  useEffect(() => {
    if (!reorderDialogId) return;
    window.setTimeout(() => reorderInputRef.current?.select(), 0);
  }, [reorderDialogId]);

  useEffect(() => {
    if (!reorderMenu && !addMenu) return;
    function closeFromPointer(event: Event) {
      if (event.target instanceof Element && event.target.closest("[data-context-menu]")) return;
      closeMenus();
    }
    function closeFromKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenus();
    }
    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("scroll", closeFromPointer, true);
    window.addEventListener("keydown", closeFromKey);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("scroll", closeFromPointer, true);
      window.removeEventListener("keydown", closeFromKey);
    };
  }, [addMenu, reorderMenu]);

  function closeMenus() {
    setReorderMenu(null);
    setAddMenu(null);
  }

  function openReorderDialog(id: string) {
    const currentNumber = numberById.get(id);
    if (!currentNumber) return;
    closeMenus();
    setReorderDialogId(id);
    setReorderTarget(String(currentNumber));
    setReorderError("");
    setActiveId(id);
  }

  function closeReorderDialog() {
    setReorderDialogId(null);
    setReorderTarget("");
    setReorderError("");
  }

  function submitReorder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reorderDialogItem) return;
    const chapterItemCount = itemsInChapter(
      orderedItems,
      reorderDialogItem.chapterId
    ).length;
    const error = validateReorderTarget(reorderTarget, chapterItemCount);
    if (error) {
      setReorderError(error);
      return;
    }
    const targetNumber = Number(reorderTarget.trim());
    const currentNumber = numberById.get(reorderDialogItem.id);
    if (!currentNumber) return;
    closeReorderDialog();
    if (targetNumber === currentNumber) {
      setNotice({ type: "info", text: "题序未变化。" });
      return;
    }
    const nextItems = moveItemToPositionInList(
      orderedItems,
      reorderDialogItem.id,
      targetNumber
    );
    updateBank((current) => ({ ...current, items: nextItems }));
    setActiveId(reorderDialogItem.id);
    setNotice({ type: "ok", text: `已移动至第 ${targetNumber} 题。` });
  }

  function openReorderMenu(event: ReactMouseEvent<HTMLElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 192);
    const y = Math.min(event.clientY, window.innerHeight - 130);
    setActiveId(id);
    setAddMenu(null);
    setReorderMenu({ id, x: Math.max(8, x), y: Math.max(8, y) });
  }

  function openAddMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const menuHeight = activeItem ? 134 : 50;
    const x = Math.min(bounds.right - 184, window.innerWidth - 192);
    const y = Math.min(bounds.bottom + 6, window.innerHeight - menuHeight - 8);
    setReorderMenu(null);
    setAddMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  }

  return {
    reorderMenu,
    addMenu,
    reorderDialogItem,
    reorderTarget,
    reorderError,
    reorderInputRef,
    setReorderTarget,
    setReorderError,
    closeMenus,
    openReorderDialog,
    closeReorderDialog,
    submitReorder,
    openReorderMenu,
    openAddMenu
  };
}
