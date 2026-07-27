import { useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction
} from "react";
import { reorderItemByDrop, type DropPosition } from "../itemOrder.js";
import type { Bank, QuestionItem } from "../../shared/types.js";
import type { DropTarget } from "./controllerTypes.js";

interface QuestionDragOptions {
  orderedItems: QuestionItem[];
  setActiveId: Dispatch<SetStateAction<string | null>>;
  updateBank: (updater: (current: Bank) => Bank) => void;
}

export function useQuestionDrag({
  orderedItems,
  setActiveId,
  updateBank
}: QuestionDragOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);

  useEffect(() => {
    function setCurrentDropTarget(next: DropTarget | null) {
      dropTargetRef.current = next;
      setDropTarget((current) =>
        current?.id === next?.id && current?.position === next?.position ? current : next
      );
    }

    function updateDropFromPoint(clientX: number, clientY: number) {
      const draggedId = draggingIdRef.current;
      if (!draggedId) return;
      const element = document.elementFromPoint(clientX, clientY);
      const row = element?.closest("[data-question-id]") as HTMLElement | null;
      const targetId = row?.dataset.questionId;
      if (!row || !targetId || targetId === draggedId) {
        setCurrentDropTarget(null);
        return;
      }
      const draggedItem = orderedItems.find((item) => item.id === draggedId);
      const targetItem = orderedItems.find((item) => item.id === targetId);
      if (!draggedItem || !targetItem || draggedItem.chapterId !== targetItem.chapterId) {
        setCurrentDropTarget(null);
        return;
      }
      const bounds = row.getBoundingClientRect();
      const position: DropPosition =
        clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      setCurrentDropTarget({ id: targetId, position });
    }

    function move(event: PointerEvent | MouseEvent) {
      if (!draggingIdRef.current) return;
      event.preventDefault();
      updateDropFromPoint(event.clientX, event.clientY);
    }

    function finishDrag() {
      const draggedId = draggingIdRef.current;
      const target = dropTargetRef.current;
      if (draggedId && target) {
        const nextItems = reorderItemByDrop(
          orderedItems,
          draggedId,
          target.id,
          target.position
        );
        updateBank((current) => ({ ...current, items: nextItems }));
        setActiveId(draggedId);
      }
      resetDrag();
    }

    function cancelDrag(event: KeyboardEvent) {
      if (event.key === "Escape") resetDrag();
    }

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("mousemove", move, { passive: false });
    window.addEventListener("mouseup", finishDrag);
    window.addEventListener("keydown", cancelDrag);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finishDrag);
      window.removeEventListener("keydown", cancelDrag);
    };
  }, [orderedItems, setActiveId, updateBank]);

  function resetDrag() {
    draggingIdRef.current = null;
    dropTargetRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }

  function startDrag(id: string) {
    draggingIdRef.current = id;
    dropTargetRef.current = null;
    setDraggingId(id);
    setDropTarget(null);
  }

  return {
    draggingId,
    dropTarget,
    startPointerDrag(event: ReactPointerEvent<HTMLSpanElement>, id: string) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      startDrag(id);
    },
    startMouseDrag(event: ReactMouseEvent<HTMLSpanElement>, id: string) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      startDrag(id);
    }
  };
}
