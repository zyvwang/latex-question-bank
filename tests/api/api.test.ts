import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../server/index.js";
import { appDataDir } from "../../server/app-state.js";
import { createSampleBank } from "../../server/bank-schema.js";
import { revisionForContent } from "../../server/storage-utils.js";

const workspacePath = path.resolve(".tmp/vitest-api-workspace");
const saveAsWorkspacePath = path.resolve(
  ".tmp/vitest-api-save-as-workspace"
);

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  await rm(saveAsWorkspacePath, { recursive: true, force: true });
});

describe("API validation", () => {
  it("rebuilds missing subdirectories when opening a bank.json-only workspace", async () => {
    // git 和 zip 都不保留空目录,拿到手的工作区经常只有 bank.json。
    await mkdir(workspacePath, { recursive: true });
    await writeFile(
      path.join(workspacePath, "bank.json"),
      `${JSON.stringify(createSampleBank(), null, 2)}\n`,
      "utf8"
    );

    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/open")
      .send({ workspacePath })
      .expect(200);

    await request(app)
      .get("/api/exports/default-name")
      .expect(200)
      .expect(({ body }) => expect(body.exportName).toMatch(/^questions-/));
    expect(await readdir(workspacePath)).toEqual(
      expect.arrayContaining([".tmp", "assets", "bank.json", "exports"])
    );
  });

  it("validates a workspace before changing the current app state", async () => {
    const app = createApiApp();
    const created = await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    expect(created.body.appInfo.currentWorkspacePath).toBe(workspacePath);
    expect(created.body.snapshot.workspacePath).toBe(workspacePath);

    await mkdir(saveAsWorkspacePath, { recursive: true });
    await writeFile(
      path.join(saveAsWorkspacePath, "bank.json"),
      "{ damaged",
      "utf8"
    );

    for (const route of ["open", "switch"]) {
      const invalidResponse = await request(app)
        .post(`/api/workspaces/${route}`)
        .send({ workspacePath: saveAsWorkspacePath });
      expect(
        invalidResponse.status,
        `${route}: ${JSON.stringify(invalidResponse.body)}`
      ).toBe(400);
      expect(invalidResponse.body.code).toBe("BANK_JSON_INVALID");
    }

    const info = await request(app).get("/api/app").expect(200);
    expect(info.body.currentWorkspacePath).toBe(workspacePath);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: created.body.snapshot.revision,
        bank: created.body.snapshot.bank
      })
      .expect(200);
  });

  it("relocates a recent workspace in one validated transition", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    await mkdir(saveAsWorkspacePath, { recursive: true });
    await writeFile(
      path.join(saveAsWorkspacePath, "bank.json"),
      `${JSON.stringify(createSampleBank(), null, 2)}\n`,
      "utf8"
    );

    const response = await request(app)
      .post("/api/workspaces/relocate")
      .send({ workspacePath, replacementPath: saveAsWorkspacePath })
      .expect(200);

    expect(response.body.appInfo.currentWorkspacePath).toBe(
      saveAsWorkspacePath
    );
    expect(response.body.snapshot.workspacePath).toBe(saveAsWorkspacePath);
    expect(response.body.appInfo.appState.recentWorkspacePaths).not.toContain(
      workspacePath
    );
  });

  it("does not remove the old recent path when relocation validation fails", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    await mkdir(saveAsWorkspacePath, { recursive: true });
    await writeFile(
      path.join(saveAsWorkspacePath, "bank.json"),
      "{ damaged",
      "utf8"
    );

    await request(app)
      .post("/api/workspaces/relocate")
      .send({ workspacePath, replacementPath: saveAsWorkspacePath })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("BANK_JSON_INVALID"));

    const info = await request(app).get("/api/app").expect(200);
    expect(info.body.currentWorkspacePath).toBe(workspacePath);
    expect(info.body.appState.recentWorkspacePaths).toContain(workspacePath);
  });

  it("answers unknown API routes with JSON instead of the SPA shell", async () => {
    // 落到 SPA 兜底会返回 200 text/html,客户端 response.json() 抛 SyntaxError,
    // 而只检查 response.ok 的调用方会把 HTML 当成成功。
    const response = await request(createApiApp())
      .get("/api/does-not-exist")
      .expect(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body.code).toBe("API_NOT_FOUND");

    await request(createApiApp())
      .post("/api/does-not-exist")
      .send({})
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe("API_NOT_FOUND"));
  });

  it("returns the raw bank revision even when the disk JSON is invalid", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    const invalidRaw = "{ externally broken";
    await writeFile(
      path.join(workspacePath, "bank.json"),
      invalidRaw,
      "utf8"
    );

    await request(app)
      .get("/api/bank/head")
      .expect(200)
      .expect(({ body }) => {
        expect(body.workspacePath).toBe(workspacePath);
        expect(body.revision).toBe(revisionForContent(invalidRaw));
      });
    await request(app).get("/api/bank").expect(400);
  });

  it("saves the current in-memory bank as an independent workspace", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    const sample = createSampleBank();
    const referencedFile = "referenced.png";
    const unreferencedFile = "old.png";
    await writeFile(
      path.join(workspacePath, "assets", referencedFile),
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
    await writeFile(
      path.join(workspacePath, "assets", unreferencedFile),
      Buffer.from("old")
    );
    const bankWithAsset = {
      ...sample,
      items: sample.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              assets: [
                {
                  id: "asset-one",
                  fileName: referencedFile,
                  originalName: "source.png",
                  relativePath: `assets/${referencedFile}`,
                  mimeType: "image/png",
                  size: 4,
                  uploadedAt: "2026-01-01T00:00:00.000Z"
                }
              ]
            }
          : item
      )
    };
    await mkdir(saveAsWorkspacePath, { recursive: true });

    const response = await request(app)
      .post("/api/workspaces/save-as")
      .send({
        sourceWorkspacePath: workspacePath,
        targetWorkspacePath: saveAsWorkspacePath,
        bank: bankWithAsset
      })
      .expect(200);

    expect(response.body.appInfo.currentWorkspacePath).toBe(
      saveAsWorkspacePath
    );
    expect(response.body.snapshot.bank).toEqual(bankWithAsset);
    expect(
      await readFile(
        path.join(saveAsWorkspacePath, "assets", referencedFile)
      )
    ).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(
      await readdir(path.join(saveAsWorkspacePath, "assets"))
    ).not.toContain(unreferencedFile);
    expect(await readdir(saveAsWorkspacePath)).toEqual(
      expect.arrayContaining([".tmp", "assets", "bank.json", "exports"])
    );
    expect(await readdir(saveAsWorkspacePath)).not.toContain(".history");
  });

  it("leaves the current workspace unchanged when save-as cannot commit", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    await mkdir(saveAsWorkspacePath, { recursive: true });
    await writeFile(
      path.join(saveAsWorkspacePath, "keep.txt"),
      "keep",
      "utf8"
    );

    await request(app)
      .post("/api/workspaces/save-as")
      .send({
        sourceWorkspacePath: workspacePath,
        targetWorkspacePath: saveAsWorkspacePath,
        bank: createSampleBank()
      })
      .expect(400)
      .expect(({ body }) =>
        expect(body.code).toBe("WORKSPACE_SAVE_AS_TARGET_NOT_EMPTY")
      );

    const info = await request(app).get("/api/app").expect(200);
    expect(info.body.currentWorkspacePath).toBe(workspacePath);
    expect(
      await readFile(path.join(saveAsWorkspacePath, "keep.txt"), "utf8")
    ).toBe("keep");

    await request(app)
      .post("/api/workspaces/save-as")
      .send({
        sourceWorkspacePath: workspacePath,
        targetWorkspacePath: workspacePath,
        bank: createSampleBank()
      })
      .expect(400)
      .expect(({ body }) =>
        expect(body.code).toBe("WORKSPACE_SAVE_AS_SAME_PATH")
      );
  });

  it("applies the bank payload limit to save-as requests", async () => {
    const bootstrapApp = createApiApp();
    await request(bootstrapApp)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    const saveAsRequest = {
      sourceWorkspacePath: workspacePath,
      targetWorkspacePath: saveAsWorkspacePath,
      bank: createSampleBank()
    };
    const requestBytes = Buffer.byteLength(JSON.stringify(saveAsRequest));

    await request(createApiApp({
      bankBodyLimitBytes: requestBytes - 1
    }))
      .post("/api/workspaces/save-as")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(saveAsRequest))
      .expect(413)
      .expect(({ body }) => {
        expect(body.code).toBe("BANK_PAYLOAD_TOO_LARGE");
        expect(body.error).toContain("64 MiB");
      });
  });

  it("fails save-as atomically when a referenced asset is missing", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    const sample = createSampleBank();
    const bankWithMissingAsset = {
      ...sample,
      items: sample.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              assets: [
                {
                  id: "asset-missing",
                  fileName: "missing.png",
                  originalName: "missing.png",
                  relativePath: "assets/missing.png",
                  mimeType: "image/png",
                  size: 1,
                  uploadedAt: "2026-01-01T00:00:00.000Z"
                }
              ]
            }
          : item
      )
    };
    await mkdir(saveAsWorkspacePath, { recursive: true });

    await request(app)
      .post("/api/workspaces/save-as")
      .send({
        sourceWorkspacePath: workspacePath,
        targetWorkspacePath: saveAsWorkspacePath,
        bank: bankWithMissingAsset
      })
      .expect(400)
      .expect(({ body }) =>
        expect(body.code).toBe("WORKSPACE_SAVE_AS_ASSET_MISSING")
      );

    expect(await readdir(saveAsWorkspacePath)).toEqual([]);
    const info = await request(app).get("/api/app").expect(200);
    expect(info.body.currentWorkspacePath).toBe(workspacePath);
  });

  it("reports workspace lifecycle failures with stable codes", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_ALREADY_EXISTS"));
    await request(app)
      .post("/api/workspaces/open")
      .send({ workspacePath: path.join(workspacePath, "missing-folder") })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_MISSING"));
  });

  it("allows the MathJax worker required for repeated preview typesetting", async () => {
    const response = await request(createApiApp()).get("/api/app").expect(200);
    expect(response.headers["content-security-policy"]).toContain("worker-src 'self' blob:");
  });

  it("rejects foreign mutating origins", async () => {
    const app = createApiApp();
    const response = await request(app)
      .post("/api/tex-path")
      .set("Origin", "https://example.invalid")
      .send({ texPath: "" })
      .expect(403);
    expect(response.body.error).toContain("非本机来源");
    expect(response.body.code).toBe("ORIGIN_FORBIDDEN");
    await request(app)
      .post("/api/tex-path")
      .set("Origin", "http://localhost:9999")
      .send({ texPath: "" })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("ORIGIN_FORBIDDEN"));
  });

  it("allows only the explicitly configured Vite development origin", async () => {
    const previousDevUrl = process.env.LQB_DEV_SERVER_URL;
    process.env.LQB_DEV_SERVER_URL = "http://127.0.0.1:5173";
    try {
      await request(createApiApp())
        .post("/api/tex-path")
        .set("Origin", "http://127.0.0.1:5173")
        .send({ texPath: "" })
        .expect(200);
    } finally {
      if (previousDevUrl === undefined) delete process.env.LQB_DEV_SERVER_URL;
      else process.env.LQB_DEV_SERVER_URL = previousDevUrl;
    }
  });

  it("checks mutating origins before parsing an oversized JSON body", async () => {
    await request(createApiApp({ jsonBodyLimitBytes: 32 }))
      .post("/api/tex-path")
      .set("Origin", "https://example.invalid")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ texPath: "x".repeat(256) }))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("ORIGIN_FORBIDDEN"));
  });

  it("accepts the bank limit boundary and rejects larger saves without changing disk", async () => {
    const bootstrapApp = createApiApp();
    await request(bootstrapApp)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    const initial = await request(bootstrapApp).get("/api/bank").expect(200);
    const boundaryRequest = {
      workspacePath,
      baseRevision: initial.body.revision as string,
      bank: createSampleBank()
    };
    const boundaryBytes = Buffer.byteLength(JSON.stringify(boundaryRequest));
    const boundaryResponse = await request(
      createApiApp({ bankBodyLimitBytes: boundaryBytes })
    )
      .put("/api/bank")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(boundaryRequest))
      .expect(200);

    const bankPath = path.join(workspacePath, "bank.json");
    const beforeRejectedSave = await readFile(bankPath, "utf8");
    const oversizedRequest = {
      workspacePath,
      baseRevision: boundaryResponse.body.revision as string,
      bank: {
        ...createSampleBank(),
        settings: {
          ...createSampleBank().settings,
          preamble: "x".repeat(512)
        }
      }
    };
    const oversizedBytes = Buffer.byteLength(JSON.stringify(oversizedRequest));
    const limitedApp = createApiApp({
      bankBodyLimitBytes: oversizedBytes - 1
    });
    await request(limitedApp)
      .put("/api/bank")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(oversizedRequest))
      .expect(413)
      .expect(({ body }) => {
        expect(body.code).toBe("BANK_PAYLOAD_TOO_LARGE");
        expect(body.error).toContain("64 MiB");
      });

    const afterRejectedSave = await readFile(bankPath, "utf8");
    expect(afterRejectedSave).toBe(beforeRejectedSave);
    const unchanged = await request(limitedApp).get("/api/bank").expect(200);
    expect(unchanged.body.revision).toBe(boundaryResponse.body.revision);
  });

  it("validates workspace and bank request bodies", async () => {
    const app = createApiApp();
    await request(app).post("/api/workspaces/create-empty").send({}).expect(400);
    await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(200);
    await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(400);
    await request(app)
      .put("/api/bank")
      .send({ nope: true })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("BANK_REQUEST_INVALID"));
    const initial = await request(app).get("/api/bank").expect(200);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: { ...createSampleBank(), version: 3 }
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("BANK_REQUEST_INVALID"));
    const sample = createSampleBank();
    const historyEntry = {
      id: "history-one",
      localDate: "2026-01-01",
      name: "History one",
      createdAt: sample.items[0].createdAt,
      updatedAt: sample.items[0].updatedAt,
      masteryOptions: sample.masteryOptions,
      errorReasonOptions: sample.errorReasonOptions,
      itemStates: {}
    };
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: {
          ...sample,
          masteryHistory: Array.from({ length: 6 }, (_, index) => ({
            ...historyEntry,
            id: `history-${index}`,
            localDate: `2026-01-0${index + 1}`,
            name: `History ${index}`
          }))
        }
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("BANK_REQUEST_INVALID"));
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: {
          ...sample,
          masteryHistory: [
            historyEntry,
            {
              ...historyEntry,
              id: "history-two",
              localDate: "2026-01-02",
              name: " history ONE "
            }
          ]
        }
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("BANK_REQUEST_INVALID"));
    const sampleResponse = await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: createSampleBank()
      })
      .expect(200);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: createSampleBank()
      })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe("BANK_CONFLICT"));
    const bankResponse = await request(app).get("/api/bank").expect(200);
    expect(bankResponse.body.bank.items).toHaveLength(2);
    expect(bankResponse.body.revision).toBe(sampleResponse.body.revision);
    const recoveryResponse = await request(app).get("/api/recovery").expect(200);
    expect(recoveryResponse.body.candidates.length).toBeGreaterThan(0);
  });

  it("validates move, compile, export, and upload inputs", async () => {
    const app = createApiApp();
    await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(200);
    const initial = await request(app).get("/api/bank").expect(200);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: {
          ...createSampleBank(),
          items: [{ ...createSampleBank().items[0], modules: { question: { tex: "missing peers" } } }]
        }
      })
      .expect(400);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: {
          ...createSampleBank(),
          items: [{ ...createSampleBank().items[0], chapterId: "missing-chapter" }]
        }
      })
      .expect(400);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: {
          ...createSampleBank(),
          items: [createSampleBank().items[0], { ...createSampleBank().items[1], id: "sample-limit" }]
        }
      })
      .expect(400);
    await request(app).post("/api/workspaces/move").send({ workspacePath, direction: "sideways" }).expect(400);
    await request(app).post("/api/compile-item").send({ item: { id: "bad" }, settings: {} }).expect(400);
    await request(app).post("/api/export").send({ itemIds: [], fileName: "empty" }).expect(400);
    await request(app)
      .post("/api/assets")
      .attach("file", Buffer.from("not an image"), { filename: "note.txt", contentType: "text/plain" })
      .expect(400);
    await request(app)
      .post("/api/assets")
      .attach("file", Buffer.from("not an image"), { filename: "fake.png", contentType: "image/png" })
      .expect(400);
    await request(app)
      .post("/api/assets")
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "real.png",
        contentType: "image/png"
      })
      .expect(200);
    await request(app)
      .post("/api/assets")
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "disguised.jpg",
        contentType: "image/png"
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("IMAGE_EXTENSION_MISMATCH"));
    await request(app)
      .post("/api/assets")
      .attach("file", Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
        filename: "mismatch.jpg",
        contentType: "image/png"
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("IMAGE_MIME_MISMATCH"));
  });

  it("reads v1 without rewriting it and preserves v1 before the first v2 save", async () => {
    const app = createApiApp();
    await request(app)
      .post("/api/workspaces/create-empty")
      .send({ workspacePath })
      .expect(200);
    const legacy = createLegacyBank();
    const raw = `${JSON.stringify(legacy, null, 2)}\n`;
    const bankPath = path.join(workspacePath, "bank.json");
    await writeFile(bankPath, raw, "utf8");

    const loaded = await request(app).get("/api/bank").expect(200);
    expect(loaded.body.revision).toBe(revisionForContent(raw));
    expect(loaded.body.bank).toMatchObject({
      version: 2,
      masteryHistory: []
    });
    expect(loaded.body.bank.items[0]).toMatchObject({
      id: "legacy-b",
      chapterOrder: 1,
      masteryOptionId: null,
      errorReasonOptionIds: []
    });
    expect(JSON.parse(await readFile(bankPath, "utf8")).version).toBe(1);

    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: loaded.body.revision,
        bank: {
          ...loaded.body.bank,
          items: loaded.body.bank.items.map((item: { id: string }) =>
            item.id === "legacy-b" ? { ...item, tags: ["saved"] } : item
          )
        }
      })
      .expect(200);

    expect(JSON.parse(await readFile(`${bankPath}.bak`, "utf8")).version).toBe(1);
    const historyFiles = await readdir(path.join(workspacePath, ".history"));
    expect(historyFiles).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(path.join(workspacePath, ".history", historyFiles[0]), "utf8")
      ).version
    ).toBe(1);
    expect(JSON.parse(await readFile(bankPath, "utf8")).version).toBe(2);
  });

  it("keeps the previous export when a replacement compile fails", async () => {
    const app = createApiApp();
    await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(200);
    const initial = await request(app).get("/api/bank").expect(200);
    const bank = createSampleBank();
    bank.items[0].modules.question.tex = "\\definitelyUndefinedCommand";
    const saved = await request(app)
      .put("/api/bank")
      .send({ workspacePath, baseRevision: initial.body.revision, bank })
      .expect(200);
    expect(saved.body.bank.items).toHaveLength(2);

    const existingDir = path.join(workspacePath, "exports", "same-name");
    await mkdir(existingDir, { recursive: true });
    await writeFile(path.join(existingDir, "previous.pdf"), "previous", "utf8");

    const exportResponse = await request(app)
      .post("/api/export")
      .send({
        itemIds: [bank.items[0].id],
        fileName: "same-name",
        orderMode: "normal"
      })
      .expect(422);

    expect(exportResponse.body.results.questions.texUrl).toMatch(
      /^\/tmp\/export-[^/]+\/questions\.tex$/
    );
    expect(exportResponse.body.results.full.texUrl).toMatch(/^\/tmp\/export-[^/]+\/full\.tex$/);
    expect(await readFile(path.join(existingDir, "previous.pdf"), "utf8")).toBe("previous");
  });

  it("serves the next export name and rejects unsafe reveal requests", async () => {
    const app = createApiApp();
    await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(200);
    await Promise.all([
      mkdir(path.join(workspacePath, "exports", "questions-2026-06-13-1")),
      mkdir(path.join(workspacePath, "exports", "questions-2026-06-13-3"))
    ]);

    const response = await request(app).get("/api/exports/default-name").expect(200);
    expect(response.body.exportName).toMatch(/^questions-\d{4}-\d{2}-\d{2}-\d+$/);
    await request(app)
      .post("/api/exports/reveal")
      .send({ exportName: "../outside" })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("EXPORT_NAME_INVALID"));
    await request(app)
      .post("/api/exports/reveal")
      .send({ exportName: "missing" })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("EXPORT_DIRECTORY_MISSING"));
  });
});

function createLegacyBank() {
  const now = "2026-01-01T00:00:00.000Z";
  const item = (
    id: string,
    order: number,
    chapter: string,
    sourceNumber: string
  ) => ({
    id,
    order,
    sourceNumber,
    chapter,
    tags: [],
    star: 5,
    modules: {
      question: { tex: id },
      solution: { tex: "" },
      note: { tex: "" }
    },
    assets: [],
    createdAt: now,
    updatedAt: now
  });
  return {
    version: 1,
    settings: createSampleBank().settings,
    items: [
      item("legacy-a", 2, "第二章", "1"),
      item("legacy-b", 1, "第一章", "1"),
      item("legacy-c", 3, "第一章", "1"),
      item("legacy-u", 4, " ", "1")
    ]
  };
}
