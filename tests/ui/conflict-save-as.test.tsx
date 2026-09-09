import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import { useQuestionBankModel } from "../../src/hooks/useQuestionBankModel.js";
import type { AppInfo, SaveBankAsRequest } from "../../shared/types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const bank = createSampleBank();
const appInfo: AppInfo = {
  appState: { version: 1, currentWorkspacePath: "/synthetic/A", recentWorkspacePaths: ["/synthetic/A"] },
  currentWorkspaceName: "A", currentWorkspacePath: "/synthetic/A", recentWorkspaces: [],
  texStatus: { available: false, source: "missing", message: "missing" },
  setupRequired: false, isDesktop: false
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" }
});
let directory: ReturnType<typeof deferred<string | null>>;
let response: ReturnType<typeof deferred<Response>>;
let upload: ReturnType<typeof deferred<Response>>;
let payloads: SaveBankAsRequest[];
beforeEach(() => {
  directory = deferred(); response = deferred(); upload = deferred(); payloads = [];
  window.lqb = {
    platform: "darwin", selectWorkspaceDirectory: vi.fn(() => directory.promise),
    openPath: vi.fn(), openExternal: vi.fn(), revealExportFolder: vi.fn(), onBeforeClose: vi.fn(() => () => undefined)
  };
  vi.stubGlobal("fetch", vi.fn(async (input, options) => {
    if (input === "/api/app") return json(appInfo);
    if (input === "/api/bank") return options?.method === "PUT"
      ? json({ code: "BANK_CONFLICT", error: "conflict" }, 409)
      : json({ bank, workspacePath: appInfo.currentWorkspacePath, revision: "disk" });
    if (input === "/api/exports/default-name") return json({ exportName: "out" });
    if (input === "/api/workspaces/save-as") {
      payloads.push(JSON.parse(String(options?.body)) as SaveBankAsRequest);
      return response.promise;
    }
    if (input === "/api/assets") return upload.promise;
    throw new Error(`Unexpected request ${input}`);
  }));
});
async function setup() {
  const hook = renderHook(useQuestionBankModel);
  await waitFor(() => expect(hook.result.current.questions.bank).not.toBeNull());
  act(() => hook.result.current.questions.updateItem(bank.items[0].id, { sourceNumber: "保留" }));
  await waitFor(() => expect(hook.result.current.lifecycle.saveIssue?.kind).toBe("conflict"));
  return hook;
}

it("serializes save-as and close, then flushes the new session", async () => {
  const { result } = await setup();
  let operation!: Promise<void>;
  act(() => { operation = result.current.lifecycle.saveConflictAs(); });
  expect(result.current.lifecycle.isSavingConflictAs).toBe(true);
  await act(async () => { await result.current.lifecycle.saveConflictAs(); });
  expect(window.lqb!.selectWorkspaceDirectory).toHaveBeenCalledTimes(1);
  act(() => result.current.lifecycle.closeConflictDialog());
  expect(result.current.lifecycle.isConflictDialogOpen).toBe(true);
  await act(async () => { directory.resolve("/synthetic/copy"); });
  expect(payloads).toHaveLength(1);
  expect(payloads[0].bank.items[0].sourceNumber).toBe("保留");
  let closed = false;
  let closing!: Promise<void>;
  act(() => { closing = result.current.lifecycle.flushPendingChanges().then(() => { closed = true; }); });
  expect(closed).toBe(false);
  await act(async () => {
    response.resolve(json({
      appInfo: { ...appInfo, currentWorkspacePath: "/synthetic/copy" },
      snapshot: { bank: payloads[0].bank, workspacePath: "/synthetic/copy", revision: "copy" }
    }));
    await operation;
    await closing;
  });
  expect(closed).toBe(true);
  expect(result.current.workspace.appInfo?.currentWorkspacePath).toBe("/synthetic/copy");
  expect(result.current.lifecycle.saveState).toBe("saved");
});

it("unlocks a cancelled directory picker without discarding the conflict", async () => {
  const { result } = await setup();
  let operation!: Promise<void>;
  act(() => { operation = result.current.lifecycle.saveConflictAs(); });
  await act(async () => { directory.resolve(null); await operation; });
  expect(payloads).toEqual([]);
  expect(result.current.lifecycle.isSavingConflictAs).toBe(false);
  expect(result.current.lifecycle.saveIssue?.kind).toBe("conflict");
  expect(result.current.questions.bank?.items[0].sourceNumber).toBe("保留");
});

it("requires pending uploads to finish before copying a conflicted bank", async () => {
  const { result } = await setup();
  let operation!: Promise<void>;
  act(() => { operation = result.current.compileExport.uploadAsset("question", new File(["png"], "x.png")); });
  await act(async () => { await result.current.lifecycle.saveConflictAs(); });
  expect(window.lqb!.selectWorkspaceDirectory).not.toHaveBeenCalled();
  expect(result.current.lifecycle.notice?.text).toContain("图片仍在上传");
  await act(async () => { upload.resolve(json({ error: "invalid image" }, 400)); await operation; });
  act(() => { operation = result.current.lifecycle.saveConflictAs(); });
  expect(window.lqb!.selectWorkspaceDirectory).toHaveBeenCalledTimes(1);
  await act(async () => { directory.resolve(null); await operation; });
});
