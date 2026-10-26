import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSaveConflictActions } from "../../src/hooks/useSaveConflictActions.js";
import { appInfo, bank, json } from "../fixtures/app-ui.js";

it("keeps an uncertain save-as inert and confirms the original response without copying twice", async () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(window, "prompt").mockReturnValue("/tmp/copy");
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const apply = vi.fn();
    const { result } = renderHook(() => useSaveConflictActions({
      appInfo, bank, activeView: "editor",
      saveIssue: { kind: "conflict", message: "conflict", diskSnapshot: null, diskReadError: null },
      applyBankSnapshot: apply, refreshConflict: vi.fn(), overwriteConflict: vi.fn(),
      hasPendingUploads: () => false, setNotice: vi.fn(), beginDraftCommit: vi.fn(),
      takeDraftCommitRejection: () => null
    }));
    let save!: Promise<void>;
    act(() => { save = result.current.saveConflictAs(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await save; });
    expect(result.current.isSavingConflictAs).toBe(true);
    expect(result.current.isSaveAsUncertain).toBe(true);
    await expect(result.current.waitForSaveAs()).rejects.toThrow("尚未确认");
    act(() => result.current.closeConflictDialog());
    expect(result.current.isConflictDialogOpen).toBe(true);
    const copiedInfo = { ...appInfo, currentWorkspacePath: "/tmp/copy", currentWorkspaceName: "copy" };
    const snapshot = { workspacePath: "/tmp/copy", bank, revision: "copied" };
    finish(json({ appInfo: copiedInfo, snapshot }));
    await act(() => result.current.saveConflictAs());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.prompt).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(copiedInfo, snapshot, "editor");
    expect(result.current.isSavingConflictAs).toBe(false);
    await expect(result.current.waitForSaveAs()).resolves.toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
