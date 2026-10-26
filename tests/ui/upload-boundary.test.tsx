import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import type { AppInfo, SaveBankRequest } from "../../shared/types.js";
import { useQuestionBankModel } from "../../src/hooks/useQuestionBankModel.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" }
});
const bank = createSampleBank();
const appInfo: AppInfo = {
  appState: { version: 1, currentWorkspacePath: "/synthetic/A", recentWorkspacePaths: ["/synthetic/A"] },
  currentWorkspaceName: "A", currentWorkspacePath: "/synthetic/A", recentWorkspaces: [],
  texStatus: { available: false, source: "missing", message: "missing" },
  setupRequired: false, isDesktop: false
};
let uploads: Array<ReturnType<typeof deferred<Response>>>;
let switches: string[];
let saves: SaveBankRequest[];
let transition: ReturnType<typeof deferred<Response>>;
beforeEach(() => {
  uploads = []; switches = []; saves = []; transition = deferred();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  window.lqb = {
    platform: "darwin", selectWorkspaceDirectory: vi.fn(async () => "/synthetic/B"),
    openPath: vi.fn(), openExternal: vi.fn(), revealExportFolder: vi.fn(), onBeforeClose: vi.fn(() => () => undefined)
  };
  vi.stubGlobal("fetch", vi.fn(async (input, options) => {
    if (input === "/api/app") return json(appInfo);
    if (input === "/api/bank") {
      if (options?.method === "PUT") {
        const save = JSON.parse(String(options.body)) as SaveBankRequest;
        saves.push(save);
        return json({ bank: save.bank, workspacePath: save.workspacePath, revision: "saved" });
      }
      return json({ bank, workspacePath: appInfo.currentWorkspacePath, revision: "initial" });
    }
    if (input === "/api/exports/default-name") return json({ exportName: "out" });
    if (input === "/api/assets") {
      const upload = deferred<Response>(); uploads.push(upload); return upload.promise;
    }
    if (String(input).startsWith("/api/workspaces/")) {
      switches.push(String(input)); return transition.promise;
    }
    throw new Error(`Unexpected request ${input}`);
  }));
});
async function setup() {
  const hook = renderHook(useQuestionBankModel);
  await waitFor(() => expect(hook.result.current.questions.bank).not.toBeNull());
  return hook;
}
function uploaded(id: string) {
  return json({ asset: {
    id, fileName: `${id}.png`, relativePath: `assets/${id}.png`, originalName: `${id}.png`,
    mimeType: "image/png", size: 8, uploadedAt: new Date().toISOString()
  }, insertText: `\\includegraphics{assets/${id}.png}` });
}
it("blocks close until every upload is committed, then saves both image references", async () => {
  const { result } = await setup();
  let first!: Promise<void>; let second!: Promise<void>;
  act(() => {
    first = result.current.compileExport.uploadAsset("question", new File(["png"], "a.png"));
    second = result.current.compileExport.uploadAsset("question", new File(["png"], "b.png"));
  });
  await expect(result.current.lifecycle.flushPendingChanges()).rejects.toThrow("图片仍在上传");
  await act(async () => { uploads[0].resolve(uploaded("a")); await first; });
  await expect(result.current.lifecycle.flushPendingChanges()).rejects.toThrow("图片仍在上传");
  await act(async () => { uploads[1].resolve(uploaded("b")); await second; });
  await act(async () => { await result.current.lifecycle.flushPendingChanges(); });
  expect(saves.at(-1)?.bank.items[0].assets.map((asset) => asset.id)).toEqual(["a", "b"]);
  expect(saves.at(-1)?.bank.items[0].modules.question.tex).toContain("assets/b.png");
});
it.each(["createSampleWorkspace", "createNewWorkspace", "openWorkspace", "switchToWorkspace", "relocateWorkspace", "removeWorkspaceFromList"] as const)(
  "blocks %s during upload and releases the guard after failure", async (action) => {
    const { result } = await setup();
    let uploading!: Promise<void>;
    act(() => { uploading = result.current.compileExport.uploadAsset("question", new File(["png"], "a.png")); });
    await act(async () => { await result.current.workspace[action]("/synthetic/B"); });
    expect(switches).toEqual([]);
    expect(result.current.lifecycle.notice?.text).toContain("图片仍在上传");
    await act(async () => { uploads[0].resolve(json({ error: "上传失败" }, 500)); await uploading; });
    expect(result.current.lifecycle.notice?.text).toBe("上传失败");
    await act(async () => { await result.current.lifecycle.flushPendingChanges(); });
  }
);
it("serializes transitions and rejects new uploads and close while switching", async () => {
  const { result } = await setup();
  let switching!: Promise<void>;
  act(() => { switching = result.current.workspace.switchToWorkspace("/synthetic/B"); });
  await waitFor(() => expect(switches).toHaveLength(1));
  await act(async () => {
    await result.current.workspace.switchToWorkspace("/synthetic/C");
    await result.current.compileExport.uploadAsset("question", new File(["png"], "a.png"));
  });
  expect(switches).toHaveLength(1); expect(uploads).toHaveLength(0);
  await expect(result.current.lifecycle.flushPendingChanges()).rejects.toThrow("正在切换工作区");
  await act(async () => { transition.resolve(json({ error: "切换失败" }, 500)); await switching; });
  expect(result.current.workspace.isChangingWorkspace).toBe(false);
  await act(async () => { await result.current.lifecycle.flushPendingChanges(); });
});
it("saves the completed upload in A before applying a successful switch to B", async () => {
  const { result } = await setup();
  let uploading!: Promise<void>;
  act(() => { uploading = result.current.compileExport.uploadAsset("question", new File(["png"], "a.png")); });
  await act(async () => { uploads[0].resolve(uploaded("a")); await uploading; });
  let switching!: Promise<void>;
  act(() => { switching = result.current.workspace.switchToWorkspace("/synthetic/B"); });
  await waitFor(() => expect(switches).toHaveLength(1));
  expect(saves.at(-1)?.workspacePath).toBe("/synthetic/A");
  expect(saves.at(-1)?.bank.items[0].assets[0].id).toBe("a");
  await act(async () => {
    transition.resolve(json({
      appInfo: { ...appInfo, currentWorkspacePath: "/synthetic/B" },
      snapshot: { bank, workspacePath: "/synthetic/B", revision: "B" }
    }));
    await switching;
  });
  expect(result.current.workspace.appInfo?.currentWorkspacePath).toBe("/synthetic/B");
  expect(result.current.questions.bank?.items[0].assets).toHaveLength(0);
  expect(result.current.workspace.isChangingWorkspace).toBe(false);
});
it("releases a cancelled directory picker and allows uploads again", async () => {
  const { result } = await setup();
  vi.mocked(window.lqb!.selectWorkspaceDirectory).mockResolvedValue(null);
  await act(async () => { await result.current.workspace.openWorkspace(); });
  expect(switches).toHaveLength(0);
  expect(result.current.workspace.isChangingWorkspace).toBe(false);
  let uploading!: Promise<void>;
  act(() => { uploading = result.current.compileExport.uploadAsset("question", new File(["png"], "a.png")); });
  expect(uploads).toHaveLength(1);
  await act(async () => { uploads[0].resolve(uploaded("a")); await uploading; });
});
