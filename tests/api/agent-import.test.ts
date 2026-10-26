import { access, rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentImportManifest } from "../../shared/agent-manifest.js";
import type { Bank } from "../../shared/types.js";
import { getAgentToken } from "../../server/agent-auth.js";
import { appDataDir } from "../../server/app-state.js";
import { createApiApp } from "../../server/index.js";
import { validPng } from "../fixtures/images.js";

const workspacePath = path.resolve(".tmp/vitest-agent-import-workspace");

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
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
  revision: string;
  bank: Bank;
}> {
  const response = await request(app).get("/api/bank").expect(200);
  return response.body as { revision: string; bank: Bank };
}

async function postImport(
  app: ReturnType<typeof createApiApp>,
  manifest: AgentImportManifest,
  options: {
    dryRun?: boolean;
    overwrite?: boolean;
    workspace?: string;
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
    .field("workspacePath", options.workspace ?? workspacePath)
    .field("manifest", JSON.stringify(manifest))
    .field("baseRevision", snapshot.revision);
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
