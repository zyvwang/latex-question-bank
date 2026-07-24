import { deepStrictEqual, equal, ok } from "node:assert";
import { mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildQuestionOnlyLatex,
  buildFullLatex,
  copyAssetsForItems,
  createLatexProcessEnv,
  listExportFiles,
  orderItemsForExport,
  sanitizeFileName,
  selectedItems
} from "../../server/latex.js";
import {
  appDataDir,
  appStatePath,
  updateAppState,
  writeAppState
} from "../../server/app-state.js";
import {
  createEmptyBank,
  createSampleBank
} from "../../server/bank-schema.js";
import {
  readBank,
  readBankSnapshot,
  saveBankSnapshot
} from "../../server/bank-storage.js";
import { writeJsonFileAtomic } from "../../server/json-file.js";
import {
  nextDefaultExportName,
  resolveCurrentExportDirectory
} from "../../server/export-directory-service.js";
import {
  cleanupOldTempDirs,
  listRecoveryCandidates,
  recoverBank
} from "../../server/recovery-storage.js";
import {
  createEmptyWorkspace,
  createSampleWorkspace,
  moveWorkspace,
  readAppState,
  removeWorkspace,
  switchWorkspace
} from "../../server/workspace-storage.js";
import type { QuestionItem } from "../../shared/types.js";
import { moveItemToPositionInList, reorderItemByDrop } from "../../src/itemOrder.js";
import { nextWheelScrollState, wheelDeltaToPixels } from "../../src/wheelScroll.js";
import { validateReorderTarget } from "../../src/questionReorder.js";
import { compileContentVersion } from "../../src/utils/compileVersion.js";

const fixedNow = "2026-01-01T00:00:00.000Z";
const workspacePath = path.resolve(".tmp/vitest-unit-workspace");
const workspacePathB = path.resolve(".tmp/vitest-unit-workspace-b");
const workspacePathC = path.resolve(".tmp/vitest-unit-workspace-c");

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  await rm(workspacePathB, { recursive: true, force: true });
  await rm(workspacePathC, { recursive: true, force: true });
});

describe("domain helpers", () => {
  it("reorders items and normalizes wheel scroll", () => {
    const items = createItems(["one", "two", "three", "four"]);

    deepStrictEqual(itemIds(moveItemToPositionInList(items, "four", 2, fixedNow)), ["one", "four", "two", "three"]);
    deepStrictEqual(
      moveItemToPositionInList(items, "four", 2, fixedNow).map((item) => item.order),
      [1, 2, 3, 4]
    );
    deepStrictEqual(itemIds(reorderItemByDrop(items, "one", "three", "after", fixedNow)), ["two", "three", "one", "four"]);

    const nearBottomWheel = nextWheelScrollState({
      scrollTop: 95,
      scrollLeft: 0,
      scrollHeight: 200,
      scrollWidth: 100,
      clientHeight: 100,
      clientWidth: 100,
      deltaX: 0,
      deltaY: 80
    });
    equal(nearBottomWheel.scrollTop, 100);
    equal(nearBottomWheel.changed, true);
    deepStrictEqual(wheelDeltaToPixels(1, 1, 2, 320, 240), { deltaX: 320, deltaY: 240 });
    equal(validateReorderTarget("2", 4), null);
    equal(validateReorderTarget("0", 4), "题序需在 1 到 4 之间。");
    equal(validateReorderTarget("1.5", 4), "请输入有效的整数题序。");
  });

  it("keeps export order deterministic and strips full-document wrappers", () => {
    const items = createItems(["one", "two", "three", "four"]);
    const firstRandom = itemIds(orderItemsForExport(items, "random", "seed-1"));
    const secondRandom = itemIds(orderItemsForExport(items, "random", "seed-1"));
    const otherRandom = itemIds(orderItemsForExport(items, "random", "seed-2"));
    deepStrictEqual(firstRandom, secondRandom);
    deepStrictEqual([...firstRandom].sort(), itemIds(items).sort());
    deepStrictEqual([...otherRandom].sort(), itemIds(items).sort());

    const bank = createSampleBank();
    const selected = selectedItems({ ...bank, items }, ["four", "two"], { orderMode: "normal" });
    deepStrictEqual(itemIds(selected), ["two", "four"]);

    const latex = buildQuestionOnlyLatex(
      [
        {
          ...items[0],
          sourceNumber: "source_1",
          modules: {
            ...items[0].modules,
            question: { tex: "\\documentclass{article}\\begin{document}Body $x^2$\\end{document}" }
          }
        }
      ],
      bank.settings
    );
    ok(latex.includes("Body $x^2$"));
    ok(!latex.includes("\\documentclass{article}"));
    ok(latex.includes("\\documentclass[UTF8,12pt]{ctexart}"));
    ok(buildFullLatex([], bank.settings).includes("暂无选中题目"));
    ok(
      buildFullLatex(
        [{ ...items[0], sourceNumber: "a_b#c~d^e" }],
        bank.settings
      ).includes("a\\_b\\#c\\textasciitilde{}d\\textasciicircum{}e")
    );
    equal(sanitizeFileName(" ../bad:name  "), "bad-name");
    ok(sanitizeFileName("...").startsWith("export-"));

    const latexEnv = createLatexProcessEnv("/Library/TeX/texbin/latexmk");
    const pathKey = Object.keys(latexEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
    ok(latexEnv[pathKey]?.split(path.delimiter).includes("/Library/TeX/texbin"));
  });

  it("copies only existing assets and lists export files", async () => {
    const sourceWorkspace = path.resolve(".tmp/vitest-assets-workspace");
    const targetDir = path.resolve(".tmp/vitest-assets-target");
    await rm(sourceWorkspace, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(path.join(sourceWorkspace, "assets"), { recursive: true });
    await writeFile(path.join(sourceWorkspace, "assets", "exists.png"), "image", "utf8");
    const item = {
      ...createItems(["asset"])[0],
      assets: [
        {
          id: "asset-existing",
          fileName: "exists.png",
          originalName: "exists.png",
          relativePath: "assets/exists.png",
          mimeType: "image/png",
          size: 5,
          uploadedAt: fixedNow
        },
        {
          id: "asset-missing",
          fileName: "missing.png",
          originalName: "missing.png",
          relativePath: "assets/missing.png",
          mimeType: "image/png",
          size: 5,
          uploadedAt: fixedNow
        }
      ]
    };
    await copyAssetsForItems([item], targetDir, sourceWorkspace);
    equal(await readFile(path.join(targetDir, "assets", "exists.png"), "utf8"), "image");
    await writeFile(path.join(targetDir, "questions.tex"), "tex", "utf8");
    await writeFile(path.join(targetDir, "questions.pdf"), "pdf", "utf8");
    await writeFile(path.join(targetDir, "ignored.log"), "log", "utf8");
    deepStrictEqual(await listExportFiles(targetDir), ["questions.pdf", "questions.tex"]);
    deepStrictEqual(await listExportFiles(path.join(targetDir, "missing")), []);
  });

  it("versions only inputs that affect current-item compilation", () => {
    const bank = createSampleBank();
    const item = bank.items[0];
    const initial = compileContentVersion(item, bank.settings);

    equal(
      compileContentVersion({ ...item, chapter: "changed", tags: ["changed"], star: 5 }, bank.settings),
      initial
    );
    expect(compileContentVersion({ ...item, sourceNumber: "changed" }, bank.settings)).not.toBe(initial);
    expect(
      compileContentVersion({
        ...item,
        modules: {
          ...item.modules,
          question: { tex: `${item.modules.question.tex} changed` }
        }
      }, bank.settings)
    ).not.toBe(initial);
    expect(
      compileContentVersion({
        ...item,
        assets: [{
          id: "asset",
          fileName: "asset.png",
          originalName: "asset.png",
          relativePath: "assets/asset.png",
          mimeType: "image/png",
          size: 1,
          uploadedAt: fixedNow
        }]
      }, bank.settings)
    ).not.toBe(initial);
    expect(
      compileContentVersion(item, {
        ...bank.settings,
        preamble: `${bank.settings.preamble}\n\\usepackage{booktabs}`
      })
    ).not.toBe(initial);
  });

  it("increments default export names from successful directories only", async () => {
    const exportDir = path.join(workspacePath, "exports");
    await mkdir(exportDir, { recursive: true });
    const date = new Date(2026, 5, 13, 23, 30);
    equal(await nextDefaultExportName(exportDir, date), "questions-2026-06-13-1");

    await Promise.all([
      mkdir(path.join(exportDir, "questions-2026-06-13-1")),
      mkdir(path.join(exportDir, "questions-2026-06-13-3")),
      mkdir(path.join(exportDir, "questions-2026-06-13-108")),
      mkdir(path.join(exportDir, "questions-2026-06-12-999")),
      writeFile(path.join(exportDir, "questions-2026-06-13-999"), "not a directory", "utf8")
    ]);
    equal(await nextDefaultExportName(exportDir, date), "questions-2026-06-13-109");
  });
});

describe("storage", () => {
  it("manages workspace state and bank data", async () => {
    const freshAppState = await readAppState();
    equal(freshAppState.currentWorkspacePath, undefined);
    deepStrictEqual(freshAppState.recentWorkspacePaths, []);
    await createSampleWorkspace(workspacePath);

    const initialBank = await readBank();
    equal(initialBank.items.length, 2);
    const initialSnapshot = await readBankSnapshot();
    await saveBankSnapshot({
      workspacePath,
      baseRevision: initialSnapshot.revision,
      bank: createEmptyBank()
    });
    const emptyBank = await readBank();
    equal(emptyBank.items.length, 0);

    await createEmptyWorkspace(workspacePathB);
    await createEmptyWorkspace(workspacePathC);
    await moveWorkspace(workspacePathC, 1);
    const movedCurrentState = await readAppState();
    equal(movedCurrentState.currentWorkspacePath, workspacePathC);
    deepStrictEqual(movedCurrentState.recentWorkspacePaths, [workspacePathB, workspacePathC, workspacePath]);

    await removeWorkspace(workspacePathC);
    const removedCurrentState = await readAppState();
    equal(removedCurrentState.currentWorkspacePath, workspacePathB);
  });

  it("writes JSON atomically and preserves the previous backup", async () => {
    const filePath = path.resolve(".tmp/vitest-atomic/atomic.json");
    await rm(path.dirname(filePath), { recursive: true, force: true });
    await mkdir(path.dirname(filePath), { recursive: true });

    await writeJsonFileAtomic(filePath, { version: 1, value: "first" });
    await writeJsonFileAtomic(filePath, { version: 1, value: "second" });

    const current = JSON.parse(await readFile(filePath, "utf8")) as { value: string };
    const backup = JSON.parse(await readFile(`${filePath}.bak`, "utf8")) as { value: string };
    equal(current.value, "second");
    equal(backup.value, "first");
  });

  it("rejects stale saves and restores a valid backup after corruption", async () => {
    await createSampleWorkspace(workspacePath);
    const snapshot = await readBankSnapshot();
    const changed = {
      ...snapshot.bank,
      items: snapshot.bank.items.map((item, index) =>
        index === 0 ? { ...item, chapter: "已修改章节" } : item
      )
    };
    const saved = await saveBankSnapshot({
      workspacePath,
      baseRevision: snapshot.revision,
      bank: changed
    });
    ok(saved.revision !== snapshot.revision);
    equal(saved.bank.items[0].chapter, "已修改章节");

    await expectStorageError(
      () =>
        saveBankSnapshot({
          workspacePath,
          baseRevision: snapshot.revision,
          bank: snapshot.bank
        }),
      "BANK_CONFLICT"
    );

    const candidates = await listRecoveryCandidates();
    ok(candidates.some((candidate) => candidate.source === "backup"));
    ok(candidates.some((candidate) => candidate.source === "history"));

    await writeFile(path.join(workspacePath, "bank.json"), "{ broken", "utf8");
    await expectStorageError(() => readBank(), "BANK_JSON_INVALID");
    const recovered = await recoverBank("bank.json.bak");
    equal(recovered.bank.items[0].chapter, snapshot.bank.items[0].chapter);
    const preservedBackup = JSON.parse(
      await readFile(path.join(workspacePath, "bank.json.bak"), "utf8")
    ) as { items: QuestionItem[] };
    equal(preservedBackup.items[0].chapter, snapshot.bank.items[0].chapter);
    await expectStorageError(() => recoverBank("missing.json"), "RECOVERY_CANDIDATE_INVALID");
  });

  it("does not create a missing workspace when switching", async () => {
    await expectStorageError(() => switchWorkspace(workspacePathB), "WORKSPACE_MISSING");
    await expect(rm(workspacePathB, { recursive: true, force: false })).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("serializes concurrent app-state updates without losing fields", async () => {
    const first = updateAppState(async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ...state, texPathOverride: "/tmp/latexmk" };
    });
    const second = updateAppState((state) => ({
      ...state,
      recentWorkspacePaths: [workspacePathB, ...state.recentWorkspacePaths]
    }));

    await Promise.all([first, second]);
    const state = await readAppState();
    equal(state.texPathOverride, "/tmp/latexmk");
    deepStrictEqual(state.recentWorkspacePaths, [workspacePathB]);
  });

  it("falls back to the previous app-state backup when the primary JSON is damaged", async () => {
    await writeAppState({
      version: 1,
      currentWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath]
    });
    await writeAppState({
      version: 1,
      currentWorkspacePath: workspacePathB,
      recentWorkspacePaths: [workspacePathB]
    });
    await writeFile(appStatePath, "{ broken", "utf8");

    const state = await readAppState();
    equal(state.currentWorkspacePath, workspacePath);
    deepStrictEqual(state.recentWorkspacePaths, [workspacePath]);
  });

  it("cleans only expired temporary compile directories", async () => {
    await createEmptyWorkspace(workspacePath);
    const oldDir = path.join(workspacePath, ".tmp", "old");
    const recentDir = path.join(workspacePath, ".tmp", "recent");
    await Promise.all([
      mkdir(oldDir, { recursive: true }),
      mkdir(recentDir, { recursive: true })
    ]);
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(oldDir, oldTime, oldTime);

    await cleanupOldTempDirs(workspacePath);
    await expect(stat(oldDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(recentDir)).resolves.toBeDefined();
  });

  it("resolves only real direct-child export directories", async () => {
    await createEmptyWorkspace(workspacePath);
    const exportDir = path.join(workspacePath, "exports");
    const validDir = path.join(exportDir, "questions-2026-06-13-1");
    const externalDir = path.join(workspacePathB, "external");
    await Promise.all([
      mkdir(validDir, { recursive: true }),
      mkdir(externalDir, { recursive: true })
    ]);
    await symlink(
      externalDir,
      path.join(exportDir, "linked"),
      process.platform === "win32" ? "junction" : "dir"
    );

    equal(await resolveCurrentExportDirectory("questions-2026-06-13-1"), validDir);
    await expectStorageError(() => resolveCurrentExportDirectory("../external"), "EXPORT_NAME_INVALID");
    await expectStorageError(() => resolveCurrentExportDirectory("missing"), "EXPORT_DIRECTORY_MISSING");
    await expectStorageError(() => resolveCurrentExportDirectory("linked"), "EXPORT_DIRECTORY_INVALID");

    await rm(exportDir, { recursive: true, force: true });
    await symlink(
      externalDir,
      exportDir,
      process.platform === "win32" ? "junction" : "dir"
    );
    await expectStorageError(
      () => resolveCurrentExportDirectory(path.basename(validDir)),
      "EXPORT_ROOT_INVALID"
    );
  });
});

function itemIds(items: QuestionItem[]) {
  return items.map((item) => item.id);
}

function createItems(ids: string[]): QuestionItem[] {
  return ids.map((id, index) => ({
    id,
    order: index + 1,
    sourceNumber: id,
    chapter: "chapter",
    tags: [],
    star: 3,
    modules: {
      question: { tex: `question ${id}` },
      solution: { tex: `solution ${id}` },
      note: { tex: `note ${id}` }
    },
    assets: [],
    createdAt: fixedNow,
    updatedAt: fixedNow
  }));
}

async function expectStorageError(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    equal(
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
      code
    );
    return;
  }
  throw new Error(`Expected storage error: ${code}`);
}
