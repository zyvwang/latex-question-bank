import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../server/index.js";
import { appDataDir } from "../../server/app-state.js";
import { createSampleBank } from "../../server/bank-schema.js";

const workspacePath = path.resolve(".tmp/vitest-api-workspace");

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
});

describe("API validation", () => {
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
        bank: { ...createSampleBank(), items: [{ ...createSampleBank().items[0], star: 8 }] }
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
