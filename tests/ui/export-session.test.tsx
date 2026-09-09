import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bank, SaveBankRequest } from "../../shared/types.js";
import { createSampleBank } from "../../server/bank-schema.js";
import { useAutosave } from "../../src/hooks/useAutosave.js";
import { useCompileExportActions } from "../../src/hooks/useCompileExportActions.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const json = (value: unknown) => new Response(JSON.stringify(value), {
  headers: { "Content-Type": "application/json" }
});
let nameGate: ReturnType<typeof deferred<Response>>;
let writes: SaveBankRequest[];
let exports: unknown[];
let names: number;
const notice = vi.fn();

beforeEach(() => {
  nameGate = deferred<Response>();
  writes = [];
  exports = [];
  names = 0;
  notice.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    if (input === "/api/exports/default-name") {
      if (++names === 2) return nameGate.promise;
      return json({ exportName: "questions-test-1" });
    }
    if (input === "/api/bank") {
      const payload = JSON.parse(String(options?.body)) as SaveBankRequest;
      writes.push(payload);
      return json({ ...payload, revision: "saved-revision" });
    }
    if (input === "/api/export") {
      exports.push(JSON.parse(String(options?.body)));
      return json({ ok: true, files: ["questions.pdf"], exportName: "questions-test-1" });
    }
    throw new Error(`Unexpected request: ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function setup() {
  const original = createSampleBank();
  const hook = renderHook(() => {
    const [bank, setBank] = useState(original);
    const [workspacePath, setWorkspacePath] = useState("/synthetic/A");
    const autosave = useAutosave(bank, notice);
    const actions = useCompileExportActions({
      ...autosave,
      isWorkspaceChanging: () => false,
      activeItem: bank.items[0] ?? null, bank, workspacePath,
      selectedIds: new Set(bank.items.map((item) => item.id)),
      setNotice: notice, updateBank: setBank
    });
    return { bank, setBank, setWorkspacePath, autosave, actions };
  });
  async function transition(bank: Bank, workspacePath: string) {
    await act(async () => {
      hook.result.current.autosave.resetAutosave({ bank, workspacePath, revision: "initial-revision" });
      hook.result.current.actions.resetCompileState();
      hook.result.current.setBank(bank);
      hook.result.current.setWorkspacePath(workspacePath);
    });
  }
  await transition(structuredClone(original), "/synthetic/A");
  return { ...hook, original, transition };
}

describe("export workspace sessions", () => {
  it.each([false, true])("rejects a delayed export after a transition (return to A: %s)", async (returnToA) => {
    const { result, original, transition } = await setup();
    let operation!: Promise<void>;
    await act(async () => { operation = result.current.actions.exportSelected(); });
    await transition({ ...original, items: [] }, "/synthetic/B");
    if (returnToA) await transition(structuredClone(original), "/synthetic/A");
    notice.mockClear();
    await act(async () => { nameGate.resolve(json({ exportName: "stale-name" })); await operation; });
    expect(writes).toEqual([]);
    expect(exports).toEqual([]);
    expect(notice).not.toHaveBeenCalled();
    expect(result.current.actions.isExporting).toBe(false);
    expect(result.current.actions.exportName).not.toBe("stale-name");
  });

  it("flushes current edits rather than the bank captured before the name response", async () => {
    const { result, original } = await setup();
    let operation!: Promise<void>;
    await act(async () => { operation = result.current.actions.exportSelected(); });
    const latest = { ...original, settings: { ...original.settings, preamble: "% latest edit" } };
    await act(async () => { result.current.setBank(latest); });
    await act(async () => { await result.current.autosave.flush(latest); });
    expect(writes).toHaveLength(1);
    await act(async () => { nameGate.resolve(json({ exportName: "fresh-name" })); await operation; });
    expect(writes).toHaveLength(1);
    expect(writes[0].bank).toEqual(latest);
    expect(exports).toEqual([expect.objectContaining({ workspacePath: "/synthetic/A", baseRevision: "saved-revision" })]);
  });
});

it("rejects a captured save session after A → B → A before any write", async () => {
  const { result, original, transition } = await setup();
  const session = result.current.autosave.captureSaveSession();
  await transition({ ...original, items: [] }, "/synthetic/B");
  await transition(structuredClone(original), "/synthetic/A");
  await act(async () => {
    await expect(result.current.autosave.flushSession(session)).rejects.toThrow("会话已变化");
  });
  expect(writes).toEqual([]);
});

it("does not export when a pending save completes after a workspace transition", async () => {
  const { result, original, transition } = await setup();
  const saveGate = deferred<Response>();
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, options) => input === "/api/bank" ? saveGate.promise : originalFetch(input, options));
  await act(async () => result.current.setBank({ ...original, settings: { ...original.settings, preamble: "% edited" } }));
  let operation!: Promise<void>;
  await act(async () => { operation = result.current.actions.exportSelected(); });
  await act(async () => { nameGate.resolve(json({ exportName: "name" })); });
  expect(vi.mocked(fetch).mock.calls.some(([input]) => input === "/api/bank")).toBe(true);
  await transition({ ...original, items: [] }, "/synthetic/B");
  notice.mockClear();
  await act(async () => { saveGate.resolve(json({ revision: "old-save", bank: original, workspacePath: "/synthetic/A" })); await operation; });
  expect(exports).toEqual([]);
  expect(notice).not.toHaveBeenCalled();
  expect(result.current.autosave.saveState).toBe("saved");
});

it("surfaces a save failure and never sends an export request", async () => {
  const { result, original } = await setup();
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, options) => input === "/api/bank"
    ? new Response(JSON.stringify({ error: "disk full", code: "INTERNAL_ERROR" }), { status: 500, headers: { "Content-Type": "application/json" } })
    : originalFetch(input, options));
  await act(async () => result.current.setBank({ ...original, settings: { ...original.settings, preamble: "% edited" } }));
  let operation!: Promise<void>;
  await act(async () => { operation = result.current.actions.exportSelected(); });
  await act(async () => { nameGate.resolve(json({ exportName: "name" })); await operation; });
  expect(exports).toEqual([]);
  expect(result.current.actions.isExporting).toBe(false);
  expect(result.current.autosave.saveState).toBe("error");
  expect(notice).toHaveBeenLastCalledWith({ type: "error", text: "disk full" });
});

it("ignores an old export response without clearing a newer export's busy state", async () => {
  const { result, original, transition } = await setup();
  const firstExport = deferred<Response>();
  const secondExport = deferred<Response>();
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  let calls = 0;
  vi.mocked(fetch).mockImplementation(async (input, options) => input === "/api/export"
    ? (++calls === 1 ? firstExport.promise : secondExport.promise)
    : originalFetch(input, options));
  let oldOperation!: Promise<void>;
  await act(async () => { oldOperation = result.current.actions.exportSelected(); });
  await act(async () => { nameGate.resolve(json({ exportName: "old-name" })); });
  expect(calls).toBe(1);
  await transition(structuredClone(original), "/synthetic/B");
  let newOperation!: Promise<void>;
  await act(async () => { newOperation = result.current.actions.exportSelected(); });
  expect(calls).toBe(2);
  notice.mockClear();
  await act(async () => { firstExport.resolve(json({ ok: true, files: ["old.pdf"], exportName: "old-name" })); await oldOperation; });
  expect(result.current.actions.isExporting).toBe(true);
  expect(notice).not.toHaveBeenCalled();
  await act(async () => { secondExport.resolve(json({ ok: true, files: ["new.pdf"], exportName: "new-name" })); await newOperation; });
  expect(result.current.actions.isExporting).toBe(false);
  expect(notice).toHaveBeenLastCalledWith(expect.objectContaining({ type: "ok", text: "导出完成：new.pdf" }));
});

it("loads the automatic name when the bank session becomes ready after app info", async () => {
  const { result } = await setup();
  expect(result.current.actions.exportName).toBe("questions-test-1");
});


it.each([[false, false], [false, true], [true, false], [true, true]])("ignores a stale upload (failure: %s, return to A: %s)", async (failure, returnToA) => {
  const { result, original, transition } = await setup();
  const gate = deferred<Response>();
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, options) => input === "/api/assets" ? gate.promise : originalFetch(input, options));
  let operation!: Promise<void>;
  await act(async () => { operation = result.current.actions.uploadAsset("question", new File(["image"], "x.png")); });
  const uploadCall = vi.mocked(fetch).mock.calls.find(([input]) => input === "/api/assets");
  expect((uploadCall?.[1]?.body as FormData).get("workspacePath")).toBe("/synthetic/A");
  await transition(structuredClone(original), "/synthetic/B");
  if (returnToA) await transition(structuredClone(original), "/synthetic/A");
  notice.mockClear();
  await act(async () => {
    gate.resolve(failure ? new Response(JSON.stringify({ error: "old error" }), { status: 500 }) : json({ asset: { id: "old" }, insertText: "old image" }));
    await operation;
  });
  expect(result.current.bank).toEqual(original);
  expect(notice).not.toHaveBeenCalled();
});


it("does not insert a delayed upload into a deleted question", async () => {
  const { result } = await setup();
  const gate = deferred<Response>();
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, options) => input === "/api/assets" ? gate.promise : originalFetch(input, options));
  let operation!: Promise<void>;
  await act(async () => { operation = result.current.actions.uploadAsset("question", new File(["image"], "x.png")); });
  await act(async () => { result.current.setBank((current) => ({ ...current, items: current.items.slice(1) })); });
  notice.mockClear();
  await act(async () => { gate.resolve(json({ asset: { id: "old" }, insertText: "old image" })); await operation; });
  expect(result.current.bank.items.every((item) => item.assets.length === 0)).toBe(true);
  expect(notice).not.toHaveBeenCalled();
});
