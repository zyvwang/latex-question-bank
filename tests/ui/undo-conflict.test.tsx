import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Bank } from "../../shared/types.js";
import { createSampleBank } from "../../server/bank-schema.js";
import { useQuestionItemActions } from "../../src/hooks/useQuestionItemActions.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("retains a rejected undo for retry without changing the bank or selection", () => {
  vi.useFakeTimers();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const notice = vi.fn();
  const initial = createSampleBank();
  const deleted = { ...initial.items[0], sourceNumber: "42" };
  const replacement = { ...deleted, id: "replacement", sourceNumber: "43", chapterOrder: 2 };
  const { result } = renderHook(() => {
    const [bank, setBank] = useState<Bank>({ ...initial, items: [deleted, replacement] });
    const [activeId, setActiveId] = useState<string | null>(deleted.id);
    const [selectedIds, setSelectedIds] = useState(new Set([deleted.id, replacement.id]));
    const actions = useQuestionItemActions({
      bank, orderedItems: bank.items, activeItem: bank.items.find((item) => item.id === activeId) ?? null,
      setActiveId, setSelectedIds, updateBank: setBank, setNotice: notice,
      clearFilters: () => {}, closeMenus: () => {}, workspacePath: "/synthetic/A"
    });
    return { bank, setBank, activeId, selectedIds, actions };
  });
  act(() => result.current.actions.deleteItem(deleted.id));
  act(() => result.current.setBank((bank) => ({ ...bank, items: bank.items.map((item) => ({ ...item, sourceNumber: "42" })) })));
  const before = result.current.bank;
  act(() => result.current.actions.undoDelete());
  expect(result.current.bank).toBe(before);
  expect(result.current.selectedIds.has(deleted.id)).toBe(false);
  expect(result.current.actions.canUndoDelete).toBe(true);
  expect(notice).toHaveBeenLastCalledWith({ type: "error", text: expect.stringContaining("42") });
  act(() => result.current.setBank((bank) => ({ ...bank, items: bank.items.map((item) => ({ ...item, sourceNumber: "43" })) })));
  act(() => result.current.actions.undoDelete());
  expect(result.current.bank.items.map((item) => item.sourceNumber).sort()).toEqual(["42", "43"]);
  expect(result.current.selectedIds.has(deleted.id)).toBe(true);
  expect(result.current.activeId).toBe(deleted.id);
  expect(result.current.actions.canUndoDelete).toBe(false);
});

it("does not extend the ten-second undo deadline after a conflict", () => {
  vi.useFakeTimers();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const original = createSampleBank();
  const deleted = original.items[0];
  const { result } = renderHook(() => {
    const [bank, setBank] = useState(original);
    const [activeId, setActiveId] = useState<string | null>(deleted.id);
    const [, setSelectedIds] = useState(new Set([deleted.id]));
    const actions = useQuestionItemActions({ bank, orderedItems: bank.items,
      activeItem: bank.items.find((item) => item.id === activeId) ?? null,
      setActiveId, setSelectedIds, updateBank: setBank, setNotice: () => {},
      clearFilters: () => {}, closeMenus: () => {}, workspacePath: "/synthetic/A" });
    return { actions, setBank };
  });
  act(() => result.current.actions.deleteItem(deleted.id));
  act(() => vi.advanceTimersByTime(9_000));
  act(() => result.current.setBank((bank) => ({ ...bank, items: [...bank.items, { ...deleted, id: "replacement" }] })));
  act(() => result.current.actions.undoDelete());
  expect(result.current.actions.canUndoDelete).toBe(true);
  act(() => vi.advanceTimersByTime(1_000));
  expect(result.current.actions.canUndoDelete).toBe(false);
});
