import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import { getWorkspaceDirs } from "../../server/workspace-storage.js";
import { writeCurrentItemCheck } from "../../server/latex-files.js";

const state = vi.hoisted(() => ({ calls: 0, first: "", second: "" }));
vi.mock("../../server/workspace-storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/workspace-storage.js")>();
  return { ...actual, getCurrentWorkspaceDirs: vi.fn(async () =>
    actual.getWorkspaceDirs(++state.calls === 1 ? state.first : state.second)) };
});
const root = path.resolve(".tmp/vitest-compile-session");
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("copies assets from the captured workspace even when the current workspace changes", async () => {
  state.calls = 0;
  state.first = path.join(root, "A");
  state.second = path.join(root, "B");
  for (const [workspace, content] of [[state.first, "asset-A"], [state.second, "asset-B"]]) {
    const dirs = getWorkspaceDirs(workspace);
    await mkdir(dirs.assetDir, { recursive: true });
    await mkdir(dirs.tempDir, { recursive: true });
    await writeFile(path.join(dirs.assetDir, "shared.png"), content);
  }
  const bank = createSampleBank();
  const item = { ...bank.items[0], assets: [{
    id: "asset", fileName: "shared.png", originalName: "shared.png", relativePath: "assets/shared.png",
    mimeType: "image/png" as const, size: 7, uploadedAt: new Date().toISOString()
  }] };
  const texPath = await writeCurrentItemCheck(item, bank.settings, state.first);
  expect(texPath.startsWith(getWorkspaceDirs(state.first).tempDir + path.sep)).toBe(true);
  expect(await readFile(path.join(path.dirname(texPath), "assets/shared.png"), "utf8")).toBe("asset-A");
});
