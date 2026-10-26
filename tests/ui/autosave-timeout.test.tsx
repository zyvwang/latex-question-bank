import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "../../src/hooks/useAutosave.js";
import { ApiRequestError, fetchBank, saveBank } from "../../src/api/client.js";
import { bank } from "../fixtures/app-ui.js";

vi.mock("../../src/api/client.js", async (original) => ({
  ...await original<typeof import("../../src/api/client.js")>(),
  saveBank: vi.fn(), fetchBank: vi.fn()
}));
afterEach(() => vi.useRealTimers());

const edited = { ...bank, settings: { ...bank.settings, preamble: "changed" } };
const latest = { ...bank, settings: { ...bank.settings, preamble: "latest" } };
const snapshot = (value = bank, revision = "original") => ({ workspacePath: "/bank", bank: value, revision });

async function timedOutSave() {
  vi.useFakeTimers();
  vi.mocked(saveBank).mockRejectedValueOnce(new ApiRequestError("结果尚未确认", 0, "WRITE_RESULT_UNKNOWN"));
  const notice = vi.fn();
  const hook = renderHook(({ value }) => useAutosave(value, notice), { initialProps: { value: bank } });
  act(() => hook.result.current.resetAutosave(snapshot()));
  // Consume the initial snapshot render before making a real edit.
  hook.rerender({ value: { ...bank } });
  hook.rerender({ value: edited });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(hook.result.current.saveIssue).toMatchObject({ kind: "error", code: "WRITE_RESULT_UNKNOWN" });
  return hook;
}

describe("uncertain save reconciliation", () => {
  it("recognizes a committed write and preserves edits made while checking", async () => {
    const hook = await timedOutSave();
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(fetchBank).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    vi.mocked(saveBank).mockResolvedValueOnce(snapshot(latest, "latest-revision"));
    let retry!: Promise<void>;
    act(() => { retry = hook.result.current.retrySave(); });
    hook.rerender({ value: latest });
    await act(async () => { finish(snapshot(edited, "committed")); await retry; });
    expect(saveBank).toHaveBeenLastCalledWith({ workspacePath: "/bank", bank: latest, baseRevision: "committed" });
    expect(hook.result.current.saveState).toBe("saved");
  });

  it("retries unchanged disk using the original revision", async () => {
    const hook = await timedOutSave();
    vi.mocked(fetchBank).mockResolvedValueOnce(snapshot());
    vi.mocked(saveBank).mockResolvedValueOnce(snapshot(edited, "saved"));
    await act(() => hook.result.current.retrySave());
    expect(saveBank).toHaveBeenLastCalledWith({ workspacePath: "/bank", bank: edited, baseRevision: "original" });
  });

  it("does not overwrite another disk revision", async () => {
    const hook = await timedOutSave();
    const calls = vi.mocked(saveBank).mock.calls.length;
    vi.mocked(fetchBank).mockResolvedValue(snapshot(latest, "external"));
    await act(() => hook.result.current.retrySave());
    expect(hook.result.current.saveIssue?.kind).toBe("conflict");
    expect(saveBank).toHaveBeenCalledTimes(calls);
  });

  it("keeps the pending write when verification fails", async () => {
    const hook = await timedOutSave();
    vi.mocked(fetchBank).mockRejectedValueOnce(new Error("读取超时"));
    await act(async () => { await expect(hook.result.current.retrySave()).rejects.toThrow("读取超时"); });
    expect(hook.result.current.saveIssue).toMatchObject({ code: "WRITE_RESULT_UNKNOWN" });
    vi.mocked(fetchBank).mockResolvedValueOnce(snapshot(edited, "committed"));
    const calls = vi.mocked(saveBank).mock.calls.length;
    await act(() => hook.result.current.retrySave());
    expect(saveBank).toHaveBeenCalledTimes(calls);
    expect(hook.result.current.saveState).toBe("saved");
  });
});
