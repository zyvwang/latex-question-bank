import { access, rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentImportManifest } from "../../shared/agent-manifest.js";
import type { Bank } from "../../shared/types.js";
import { getAgentToken } from "../../server/agent-auth.js";
import { appDataDir } from "../../server/app-state.js";
import { readBankSnapshotAt } from "../../server/bank-reader.js";
import { createApiApp } from "../../server/index.js";
import { validPng } from "../fixtures/images.js";

const workspacePath = path.resolve(".tmp/vitest-agent-import-workspace");
const createdBankPath = path.resolve(".tmp/vitest-agent-created-bank");

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  await rm(createdBankPath, { recursive: true, force: true });
});

describe("agent import API", () => {
  it("requires the agent token", async () => {
    const app = await setup();
    await request(app)
      .post("/api/agent/import")
      .field("workspacePath", workspacePath)
      .field("manifest", JSON.stringify(validManifest()))
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe("AGENT_UNAUTHORIZED"));
  });

  it("dry-runs without writing the bank or assets", async () => {
    const app = await setup();
    const before = await getBank(app);
    const response = await postImport(app, validManifest(), { dryRun: true });
    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.batchId).toBeNull();
    expect(response.body.counts.created).toBe(1);
    const after = await getBank(app);
    expect(after.bank.items).toHaveLength(before.bank.items.length);
    expect(after.revision).toBe(before.revision);
  });

  it("imports a pending question with source, chapter, tags, and answer metadata", async () => {
    const app = await setup();
    const response = await postImport(app, validManifest());
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("completed");
    expect(response.body.counts.created).toBe(1);
    expect(response.body.chapterAssignments[0]).toMatchObject({
      question: "例 3.58",
      chapterName: "微积分/极限"
    });
    const { bank } = await getBank(app);
    const item = bank.items.find((candidate) => candidate.source?.label === "例 3.58");
    expect(item).toMatchObject({
      reviewStatus: "pending",
      reviewPriority: "must",
      solutionSource: "answer-book",
      solutionRef: "A答案册 P88",
      tags: ["洛必达", "函数极限"]
    });
    expect(item?.source?.bookId).toEqual(expect.any(String));
    expect(bank.books.some((book) => book.title === "A 书")).toBe(true);
    expect(bank.imports).toHaveLength(1);
    expect(bank.imports[0].id).toBe(response.body.batchId);
    expect(bank.imports[0].newCount).toBe(1);
  });

  it("writes image assets and substitutes placeholders", async () => {
    const app = await setup();
    const manifest = validManifest();
    manifest.assets = [{ key: "stem", originalName: "stem.png" }];
    manifest.questions[0].modules.question.tex =
      "看图求极限。\n\\includegraphics{{{asset:stem}}}";
    manifest.questions[0].assets = ["stem"];
    const response = await postImport(app, manifest, {
      assets: [{ filename: "stem.png", contentType: "image/png", buffer: validPng }]
    });
    expect(response.status).toBe(200);
    expect(response.body.counts.assets).toBe(1);
    const { bank } = await getBank(app);
    const item = bank.items.find((candidate) => candidate.source?.label === "例 3.58");
    expect(item?.assets).toHaveLength(1);
    expect(item?.modules.question.tex).toContain(item?.assets[0].relativePath);
    expect(item?.modules.question.tex).not.toContain("{{asset:");
    await access(path.join(workspacePath, item!.assets[0].relativePath));
  });

  it("skips approved conflicts and overwrites only when requested", async () => {
    const app = await setup();
    await postImport(app, validManifest());
    let snapshot = await getBank(app);
    const imported = snapshot.bank.items.find(
      (candidate) => candidate.source?.label === "例 3.58"
    )!;
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: snapshot.revision,
        bank: {
          ...snapshot.bank,
          items: snapshot.bank.items.map((item) =>
            item.id === imported.id
              ? { ...item, reviewStatus: "approved" as const }
              : item
          )
        }
      })
      .expect(200);

    const changed = validManifest();
    changed.questions[0].modules.question.tex = "新版题面。";
    const skipped = await postImport(app, changed);
    expect(skipped.status).toBe(200);
    expect(skipped.body.status).toBe("partial");
    expect(skipped.body.counts.conflicts).toBe(1);
    snapshot = await getBank(app);
    expect(
      snapshot.bank.items.find((item) => item.id === imported.id)?.modules
        .question.tex
    ).toBe("求极限 $x$。");

    const overwritten = await postImport(app, changed, { overwrite: true });
    expect(overwritten.status).toBe(200);
    expect(overwritten.body.counts.updated).toBe(1);
    snapshot = await getBank(app);
    const updated = snapshot.bank.items.find((item) => item.id === imported.id);
    expect(updated?.modules.question.tex).toBe("新版题面。");
    expect(updated?.reviewStatus).toBe("pending");
    expect(updated?.reviewPriority).toBe("must");
  });

  it("rejects manifest validation errors and duplicate source keys", async () => {
    const app = await setup();
    const invalid = { ...validManifest(), schemaVersion: 2 };
    const invalidResponse = await postImportRaw(app, invalid);
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.code).toBe("AGENT_MANIFEST_INVALID");

    const duplicate = validManifest();
    duplicate.questions.push({ ...duplicate.questions[0] });
    const duplicateResponse = await postImportRaw(app, duplicate);
    expect(duplicateResponse.status).toBe(400);
    expect(duplicateResponse.body.code).toBe("AGENT_MANIFEST_INVALID");
  });

  it("rejects a workspace mismatch", async () => {
    const app = await setup();
    const response = await postImport(app, validManifest(), {
      workspace: path.resolve(".tmp/other-agent-workspace")
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("WORKSPACE_CHANGED");
  });

  it("links variants to existing questions and rejects unknown originals", async () => {
    const app = await setup();
    await postImport(app, validManifest());
    let snapshot = await getBank(app);
    const original = snapshot.bank.items.find(
      (item) => item.source?.label === "例 3.58"
    )!;

    const variantManifest = validManifest();
    variantManifest.questions = [
      {
        ...variantManifest.questions[0],
        source: { bookTitle: "A 书", label: "变式 1" },
        variantOf: original.id,
        solutionSource: "agent",
        reviewPriority: null
      }
    ];
    const variant = await postImport(app, variantManifest);
    expect(variant.status).toBe(200);
    snapshot = await getBank(app);
    expect(
      snapshot.bank.items.find((item) => item.source?.label === "变式 1")
    ).toMatchObject({
      variantOf: original.id,
      reviewStatus: "pending",
      solutionSource: "agent"
    });

    const missing = validManifest();
    missing.questions[0].variantOf = "missing-question";
    const rejected = await postImport(app, missing);
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("AGENT_MANIFEST_INVALID");
  });

  it("preserves UTF-8 attachment filenames", async () => {
    const app = await setup();
    const originalName = "李正元 例4.35 扫描页.png";
    const manifest = validManifest();
    manifest.assets = [{ key: "stem", originalName }];
    manifest.questions[0].assets = ["stem"];
    const response = await postImport(app, manifest, {
      assets: [
        {
          filename: originalName,
          contentType: "image/png",
          buffer: validPng
        }
      ]
    });
    expect(response.status).toBe(200);
    const { bank } = await getBank(app);
    const item = bank.items.find(
      (candidate) => candidate.source?.label === "例 3.58"
    );
    expect(item?.assets[0].originalName).toBe(originalName);
  });

  it("keeps screenshot attachments that are not referenced by TeX", async () => {
    const app = await setup();
    const manifest = validManifest();
    manifest.assets = [{ key: "stem", originalName: "stem.png" }];
    manifest.questions[0].assets = ["stem"];
    const response = await postImport(app, manifest, {
      assets: [
        {
          filename: "stem.png",
          contentType: "image/png",
          buffer: validPng
        }
      ]
    });
    expect(response.status).toBe(200);
    const { bank } = await getBank(app);
    const item = bank.items.find(
      (candidate) => candidate.source?.label === "例 3.58"
    );
    expect(item?.assets).toHaveLength(1);
    expect(item?.modules.question.tex).not.toContain("assets/stem");
    await access(path.join(workspacePath, item!.assets[0].relativePath));
  });

  it("creates a new bank with copied settings and chapters without switching", async () => {
    const app = await setup();
    const original = await getBank(app);
    const manifest = createBankManifest();
    const response = await postImport(app, manifest, { createBank: true });
    expect(response.status).toBe(200);
    expect(response.body.createdWorkspace).toEqual({
      path: createdBankPath,
      switched: false
    });
    expect(response.body.chapterAssignments[0]).toMatchObject({
      chapterName: "第一章"
    });

    const created = await readBankSnapshotAt(createdBankPath);
    expect(created.bank.settings).toEqual(original.bank.settings);
    expect(created.bank.chapters.map((chapter) => chapter.name)).toEqual([
      "第一章",
      "第二章"
    ]);
    expect(created.bank.items).toHaveLength(1);
    expect(created.bank.items[0]).toMatchObject({
      reviewStatus: "pending",
      reviewPriority: null,
      chapterId: created.bank.chapters[0].id
    });
    expect(created.bank.imports).toHaveLength(1);
    expect(created.bank.imports[0]).toMatchObject({
      id: "whole-book",
      newCount: 1,
      conflictCount: 0
    });
    expect(created.bank.imports[0].historySnapshot).toEqual(expect.any(String));

    const current = await getBank(app);
    expect(current.workspacePath).toBe(workspacePath);
    expect(current.bank.items).toHaveLength(original.bank.items.length);
    expect(current.bank.imports).toHaveLength(0);

    const duplicate = await postImport(app, manifest, { createBank: true });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.code).toBe("WORKSPACE_ALREADY_EXISTS");
  });

  it("dry-runs create-bank without writing the new workspace", async () => {
    const app = await setup();
    const response = await postImport(app, createBankManifest(), {
      createBank: true,
      dryRun: true
    });
    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.batchId).toBeNull();
    expect(response.body.createdWorkspace.path).toBe(createdBankPath);
    await expect(access(createdBankPath)).rejects.toThrow();
  });

  it("can create and switch to the new bank in one import", async () => {
    const app = await setup();
    const response = await postImport(app, createBankManifest(), {
      createBank: true,
      switchWorkspace: true
    });
    expect(response.status).toBe(200);
    expect(response.body.createdWorkspace).toEqual({
      path: createdBankPath,
      switched: true
    });
    const current = await getBank(app);
    expect(current.workspacePath).toBe(createdBankPath);
    expect(current.bank.items).toHaveLength(1);
    expect(current.bank.items[0].reviewStatus).toBe("pending");
  });

  it("creates an empty workspace through the dedicated create endpoint", async () => {
    const app = await setup();
    const response = await request(app)
      .post("/api/agent/workspaces/create")
      .set("Authorization", `Bearer ${getAgentToken()}`)
      .send({
        name: "C 书",
        path: createdBankPath,
        chapters: ["第一章"],
        switch: false
      })
      .expect(200);
    expect(response.body.switched).toBe(false);
    expect(response.body.workspacePath).toBe(createdBankPath);
    const created = await readBankSnapshotAt(createdBankPath);
    expect(created.bank.chapters.map((chapter) => chapter.name)).toEqual([
      "第一章"
    ]);
    expect(created.bank.items).toHaveLength(0);
    expect(created.bank.imports).toHaveLength(0);
    const current = await getBank(app);
    expect(current.workspacePath).toBe(workspacePath);
  });

  it("merges repeated batch ids and undoes the whole chunked batch", async () => {
    const app = await setup();
    const first = manifestWithLabels(["1.1"]);
    first.batch = { id: "whole-book", note: "整书导入" };
    const second = manifestWithLabels(["1.2"]);
    second.batch = { id: "whole-book", note: "整书导入" };
    const firstResponse = await postImport(app, first);
    expect(firstResponse.status).toBe(200);
    const preview = await postImport(app, second, { dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.batchId).toBe("whole-book");
    expect(preview.body.counts.created).toBe(1);
    const secondResponse = await postImport(app, second);
    expect(secondResponse.status).toBe(200);

    let snapshot = await getBank(app);
    expect(snapshot.bank.imports).toHaveLength(1);
    expect(snapshot.bank.imports[0]).toMatchObject({
      id: "whole-book",
      note: "整书导入",
      newCount: 2,
      updatedCount: 0,
      status: "completed"
    });
    expect(snapshot.bank.imports[0].itemIds).toHaveLength(2);
    const importedIds = snapshot.bank.items
      .filter((item) => item.importBatchId === "whole-book")
      .map((item) => item.id);
    expect(importedIds).toHaveLength(2);

    const undo = await postUndo(app, "whole-book");
    expect(undo.status).toBe(200);
    expect(undo.body.counts).toMatchObject({
      deleted: 2,
      restored: 0,
      kept: 0
    });
    snapshot = await getBank(app);
    expect(
      snapshot.bank.items.some((item) => item.importBatchId === "whole-book")
    ).toBe(false);
    expect(snapshot.bank.imports[0].status).toBe("undone");
    expect(snapshot.bank.imports[0].undoneAt).toEqual(expect.any(String));
  });

  it("keeps approved or edited batch items during undo", async () => {
    const app = await setup();
    const manifest = manifestWithLabels(["1.1", "1.2", "1.3"]);
    const imported = await postImport(app, manifest);
    const batchId = imported.body.batchId as string;
    let snapshot = await getBank(app);
    const items = snapshot.bank.items.filter(
      (item) => item.importBatchId === batchId
    );
    const [approved, edited, removed] = items;
    await putBank(app, (current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id === approved.id) {
          return { ...item, reviewStatus: "approved" as const };
        }
        if (item.id === edited.id) {
          return {
            ...item,
            modules: {
              ...item.modules,
              question: { tex: "人工修改后的题面。" }
            },
            updatedAt: new Date(Date.now() + 1000).toISOString()
          };
        }
        return item;
      })
    }));

    const undo = await postUndo(app, batchId);
    expect(undo.status).toBe(200);
    expect(undo.body.counts).toMatchObject({
      deleted: 1,
      restored: 0,
      kept: 2
    });
    snapshot = await getBank(app);
    expect(snapshot.bank.items.find((item) => item.id === approved.id))
      .toMatchObject({ reviewStatus: "approved" });
    expect(snapshot.bank.items.find((item) => item.id === edited.id)?.modules
      .question.tex).toBe("人工修改后的题面。");
    expect(snapshot.bank.items.some((item) => item.id === removed.id)).toBe(
      false
    );
  });

  it("restores overwritten approved items from the snapshot", async () => {
    const app = await setup();
    await postImport(app, validManifest());
    await putBank(app, (current) => ({
      ...current,
      items: current.items.map((item) =>
        item.source?.label === "例 3.58"
          ? { ...item, reviewStatus: "approved" as const }
          : item
      )
    }));
    const changed = validManifest();
    changed.questions[0].modules.question.tex = "覆盖后的题面。";
    const overwritten = await postImport(app, changed, { overwrite: true });
    expect(overwritten.status).toBe(200);
    const batchId = overwritten.body.batchId as string;
    let snapshot = await getBank(app);
    expect(
      snapshot.bank.items.find((item) => item.source?.label === "例 3.58")
        ?.modules.question.tex
    ).toBe("覆盖后的题面。");

    const undo = await postUndo(app, batchId);
    expect(undo.status).toBe(200);
    expect(undo.body.counts).toMatchObject({
      deleted: 0,
      restored: 1,
      kept: 0
    });
    snapshot = await getBank(app);
    expect(
      snapshot.bank.items.find((item) => item.source?.label === "例 3.58")
    ).toMatchObject({
      reviewStatus: "approved",
      modules: { question: { tex: "求极限 $x$。" } }
    });
  });

  it("reports missing snapshots and repeated undo attempts", async () => {
    const app = await setup();
    const imported = await postImport(app, validManifest());
    const batchId = imported.body.batchId as string;
    const undo = await postUndo(app, batchId);
    expect(undo.status).toBe(200);
    const repeated = await postUndo(app, batchId);
    expect(repeated.status).toBe(409);
    expect(repeated.body.code).toBe("UNDO_BATCH_ALREADY_UNDONE");

    const second = await postImport(app, manifestWithLabels(["2.1"]));
    await rm(path.join(workspacePath, ".history"), {
      recursive: true,
      force: true
    });
    const missing = await postUndo(app, second.body.batchId as string);
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe("UNDO_SNAPSHOT_MISSING");
  });

  it("removes batch assets that are no longer referenced", async () => {
    const app = await setup();
    const manifest = validManifest();
    manifest.assets = [{ key: "stem", originalName: "stem.png" }];
    manifest.questions[0].modules.question.tex =
      "看图求极限。\n\\includegraphics{{{asset:stem}}}";
    manifest.questions[0].assets = ["stem"];
    const imported = await postImport(app, manifest, {
      assets: [
        {
          filename: "stem.png",
          contentType: "image/png",
          buffer: validPng
        }
      ]
    });
    const snapshot = await getBank(app);
    const asset = snapshot.bank.items.flatMap((item) => item.assets)[0];
    expect(asset).toBeTruthy();
    await access(path.join(workspacePath, asset.relativePath));

    const undo = await postUndo(app, imported.body.batchId as string);
    expect(undo.status).toBe(200);
    expect(undo.body.counts.assetsRemoved).toBe(1);
    await expect(
      access(path.join(workspacePath, asset.relativePath))
    ).rejects.toThrow();
  });
});

async function setup(): Promise<ReturnType<typeof createApiApp>> {
  const app = createApiApp();
  await request(app)
    .post("/api/workspaces/create-sample")
    .send({ workspacePath })
    .expect(200);
  getAgentToken();
  return app;
}

async function getBank(app: ReturnType<typeof createApiApp>): Promise<{
  workspacePath: string;
  revision: string;
  bank: Bank;
}> {
  const response = await request(app).get("/api/bank").expect(200);
  return response.body as { workspacePath: string; revision: string; bank: Bank };
}

async function postImport(
  app: ReturnType<typeof createApiApp>,
  manifest: AgentImportManifest,
  options: {
    dryRun?: boolean;
    overwrite?: boolean;
    workspace?: string;
    createBank?: boolean;
    switchWorkspace?: boolean;
    assets?: Array<{
      filename: string;
      contentType: string;
      buffer: Buffer;
    }>;
  } = {}
) {
  const snapshot = await getBank(app);
  let pending = request(app)
    .post("/api/agent/import")
    .set("Authorization", `Bearer ${getAgentToken()}`)
    .field("manifest", JSON.stringify(manifest))
    .field("createBank", String(Boolean(options.createBank)))
    .field("switchWorkspace", String(Boolean(options.switchWorkspace)));
  if (!options.createBank) {
    pending = pending
      .field("workspacePath", options.workspace ?? workspacePath)
      .field("baseRevision", snapshot.revision);
  }
  if (options.dryRun) pending = pending.field("dryRun", "true");
  if (options.overwrite) pending = pending.field("overwrite", "true");
  for (const asset of options.assets ?? []) {
    pending = pending.attach("assets", asset.buffer, {
      filename: asset.filename,
      contentType: asset.contentType
    });
  }
  return pending;
}

async function postUndo(
  app: ReturnType<typeof createApiApp>,
  batchId: string,
  options: { workspace?: string } = {}
) {
  const snapshot = await getBank(app);
  return request(app)
    .post("/api/agent/undo")
    .set("Authorization", `Bearer ${getAgentToken()}`)
    .send({
      batchId,
      workspacePath: options.workspace ?? workspacePath,
      baseRevision: snapshot.revision
    });
}

async function postImportRaw(
  app: ReturnType<typeof createApiApp>,
  manifest: unknown
) {
  const snapshot = await getBank(app);
  return request(app)
    .post("/api/agent/import")
    .set("Authorization", `Bearer ${getAgentToken()}`)
    .field("workspacePath", workspacePath)
    .field("manifest", JSON.stringify(manifest))
    .field("baseRevision", snapshot.revision);
}

function validManifest(): AgentImportManifest {
  return {
    schemaVersion: 1,
    batch: { note: "A 书错题", agent: "qoder" },
    books: [{ title: "A 书" }],
    questions: [
      {
        source: { bookTitle: "A 书", label: "例 3.58" },
        chapterName: "微积分/极限",
        tags: ["洛必达", "函数极限"],
        reviewPriority: "must",
        modules: {
          question: { tex: "求极限 $x$。" },
          solution: { tex: "答案为 $1$。" }
        },
        solutionSource: "answer-book",
        solutionRef: "A答案册 P88",
        assets: []
      }
    ]
  };
}

function manifestWithLabels(labels: string[]): AgentImportManifest {
  return {
    schemaVersion: 1,
    books: [{ title: "A 书" }],
    questions: labels.map((label) => ({
      source: { bookTitle: "A 书", label },
      chapterName: "微积分/极限",
      tags: ["极限"],
      modules: {
        question: { tex: `题目 ${label}。` },
        solution: { tex: "参考答案。" }
      },
      solutionSource: "answer-book",
      assets: []
    }))
  };
}

function createBankManifest(): AgentImportManifest {
  return {
    schemaVersion: 1,
    batch: { id: "whole-book", note: "B 书整书导入" },
    bank: {
      name: "B 书",
      path: createdBankPath,
      copySettingsFromCurrent: true
    },
    chapters: [{ name: "第一章" }, { name: "第二章" }],
    books: [{ title: "B 书" }],
    questions: [
      {
        source: { bookTitle: "B 书", label: "例 1.1" },
        chapterName: "第一章",
        modules: {
          question: { tex: "B 书第一题。" },
          solution: { tex: "" }
        },
        solutionSource: "none",
        assets: []
      }
    ]
  };
}

async function putBank(
  app: ReturnType<typeof createApiApp>,
  updater: (bank: Bank) => Bank
): Promise<void> {
  const snapshot = await getBank(app);
  await request(app)
    .put("/api/bank")
    .send({
      workspacePath,
      baseRevision: snapshot.revision,
      bank: updater(snapshot.bank)
    })
    .expect(200);
}
