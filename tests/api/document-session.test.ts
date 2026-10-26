import { validPng } from "../fixtures/images.js";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../server/index.js";
import * as assetService from "../../server/asset-service.js";
import { appDataDir } from "../../server/app-state.js";
import { createSampleBank } from "../../server/bank-schema.js";
import { compileLatex } from "../../server/latex-runtime.js";
import { exportBank } from "../../server/export-service.js";
import type { BankSnapshot, CompileResult, ExportResponse } from "../../shared/types.js";

vi.mock("../../server/latex-runtime.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/latex-runtime.js")>(),
  compileLatex: vi.fn()
}));
vi.mock("../../server/export-service.js", () => ({ exportBank: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const root = path.resolve(".tmp/vitest-document-session");
const a = path.join(root, "A");
const b = path.join(root, "B");
beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(appDataDir, { recursive: true, force: true });
  vi.mocked(compileLatex).mockReset();
  vi.mocked(exportBank).mockReset();
});
async function setup() {
  const app = createApiApp();
  for (const workspacePath of [a, b]) {
    await mkdir(workspacePath, { recursive: true });
    await writeFile(path.join(workspacePath, "bank.json"), JSON.stringify(createSampleBank()));
    await request(app).post("/api/workspaces/open").send({ workspacePath }).expect(200);
  }
  const response = await request(app).post("/api/workspaces/switch").send({ workspacePath: a }).expect(200);
  const snapshot = response.body.snapshot as BankSnapshot;
  return { app, snapshot };
}

describe("document workspace boundaries", () => {
  it("rejects stale targets, revisions, and missing identity before creating artifacts", async () => {
    const { app, snapshot } = await setup();
    const input = { workspacePath: a, baseRevision: snapshot.revision, itemIds: [snapshot.bank.items[0].id], fileName: "out" };
    await request(app).post("/api/export").send({ ...input, baseRevision: "0".repeat(64) })
      .expect(409).expect(({ body }) => expect(body.code).toBe("BANK_CONFLICT"));
    await request(app).post("/api/export").send({ ...input, workspacePath: undefined }).expect(400);
    await request(app).post("/api/export").send({ ...input, baseRevision: undefined }).expect(400);
    await request(app).post("/api/workspaces/switch").send({ workspacePath: b }).expect(200);
    await request(app).post("/api/export").send(input)
      .expect(409).expect(({ body }) => expect(body.code).toBe("WORKSPACE_CHANGED"));
    await request(app).post("/api/compile-item")
      .send({ workspacePath: a, item: snapshot.bank.items[0], settings: snapshot.bank.settings })
      .expect(409).expect(({ body }) => expect(body.code).toBe("WORKSPACE_CHANGED"));
    await request(app).post("/api/compile-item")
      .send({ item: snapshot.bank.items[0], settings: snapshot.bank.settings }).expect(400);
    expect(compileLatex).not.toHaveBeenCalled();
    expect(exportBank).not.toHaveBeenCalled();
    expect(await readdir(path.join(a, ".tmp"))).toEqual([]);
    expect(await readdir(path.join(b, ".tmp"))).toEqual([]);
  });

  it("keeps compilation artifacts and result URLs bound to A after switching to B", async () => {
    const { app, snapshot } = await setup();
    const entered = deferred<string>();
    const completed = deferred<CompileResult>();
    vi.mocked(compileLatex).mockImplementation(async (texPath) => {
      entered.resolve(texPath);
      return completed.promise;
    });
    const responsePromise = request(app).post("/api/compile-item")
      .send({ workspacePath: a, item: snapshot.bank.items[0], settings: snapshot.bank.settings }).then((value) => value);
    const texPath = await entered.promise;
    await request(app).post("/api/workspaces/switch").send({ workspacePath: b }).expect(200);
    const pdfPath = texPath.replace(/\.tex$/, ".pdf");
    await writeFile(pdfPath, "synthetic PDF");
    completed.resolve({ ok: true, texPath, pdfPath, log: "ok" });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.body.texUrl).toMatch(/^\/tmp\/compile-[^/]+\/current-item\.tex$/);
    expect(response.body.pdfUrl).toBe(response.body.texUrl.replace(/\.tex$/, ".pdf"));
    expect(await readdir(path.join(b, ".tmp"))).toEqual([]);
    await request(app).get(response.body.pdfUrl).expect(404);
    await request(app).post("/api/workspaces/switch").send({ workspacePath: a }).expect(200);
    await request(app).get(response.body.pdfUrl).expect(200);
  });

  it("passes a fixed snapshot to an accepted export even when the workspace changes", async () => {
    const { app, snapshot } = await setup();
    const entered = deferred<void>();
    const completed = deferred<ExportResponse>();
    vi.mocked(exportBank).mockImplementation(async () => { entered.resolve(); return completed.promise; });
    const responsePromise = request(app).post("/api/export").send({
      workspacePath: a, baseRevision: snapshot.revision, itemIds: [snapshot.bank.items[0].id], fileName: "out"
    }).then((value) => value);
    await entered.promise;
    const bBefore = await readFile(path.join(b, "bank.json"), "utf8");
    await request(app).post("/api/workspaces/switch").send({ workspacePath: b }).expect(200);
    const result: CompileResult = { ok: true, texPath: "out.tex", log: "ok" };
    completed.resolve({ ok: true, exportName: "out", exportPath: path.join(a, "exports/out"), files: ["questions.pdf"], results: { questions: result, full: result } });
    expect((await responsePromise).status).toBe(200);
    expect(exportBank).toHaveBeenCalledWith(snapshot.bank, a, expect.objectContaining({ baseRevision: snapshot.revision }));
    expect(await readFile(path.join(b, "bank.json"), "utf8")).toBe(bBefore);
  });
});


it("rejects missing and stale upload targets before writing assets", async () => {
  const { app } = await setup();
  const png = validPng;
  await request(app).post("/api/workspaces/switch").send({ workspacePath: b }).expect(200);
  await request(app).post("/api/assets").attach("file", png, "image.png").expect(400);
  await request(app).post("/api/assets").field("workspacePath", a).attach("file", png, "image.png")
    .expect(409).expect(({ body }) => expect(body.code).toBe("WORKSPACE_CHANGED"));
  expect(await readdir(path.join(a, "assets"))).toEqual([]);
  expect(await readdir(path.join(b, "assets"))).toEqual([]);
  await request(app).post("/api/assets").field("workspacePath", b).attach("file", png, "image.png").expect(200);
  expect(await readdir(path.join(b, "assets"))).toHaveLength(1);
});


it("writes an accepted upload only to its captured workspace after a switch", async () => {
  const { app } = await setup();
  const entered = deferred<void>();
  const resume = deferred<void>();
  const save = assetService.saveQuestionAsset;
  vi.spyOn(assetService, "saveQuestionAsset").mockImplementation(async (file, assetDir) => {
    entered.resolve();
    await resume.promise;
    return save(file, assetDir);
  });
  const png = validPng;
  const pending = request(app).post("/api/assets").field("workspacePath", a)
    .attach("file", png, "image.png").then((value) => value);
  await entered.promise;
  await request(app).post("/api/workspaces/switch").send({ workspacePath: b }).expect(200);
  resume.resolve();
  expect((await pending).status).toBe(200);
  expect(await readdir(path.join(a, "assets"))).toHaveLength(1);
  expect(await readdir(path.join(b, "assets"))).toEqual([]);
});
