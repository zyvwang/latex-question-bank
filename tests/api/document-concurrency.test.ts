import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../server/index.js";
import { appDataDir } from "../../server/app-state.js";
import { compileLatex } from "../../server/latex-runtime.js";
import { assertLatexExecutionSession } from "../../server/latex-execution.js";
import * as transactions from "../../server/export-transaction.js";
import type { BankSnapshot, CompileResult } from "../../shared/types.js";

vi.mock("../../server/latex-runtime.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/latex-runtime.js")>(),
  compileLatex: vi.fn()
}));

const root = path.resolve(".tmp/vitest-document-concurrency");
const workspacePath = path.join(root, "bank");
const tempDir = path.join(workspacePath, ".tmp");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function successfulCompile(texPath: string): Promise<CompileResult> {
  const pdfPath = texPath.replace(/\.tex$/, ".pdf");
  await writeFile(pdfPath, "synthetic PDF");
  return { ok: true, texPath, pdfPath, log: "ok" };
}

beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(appDataDir, { recursive: true, force: true });
  vi.mocked(compileLatex).mockReset().mockImplementation(async (texPath, _cwd, _timeout, session) => {
    expect(session).toBeDefined();
    assertLatexExecutionSession(session!);
    return successfulCompile(texPath);
  });
});

async function setup() {
  const app = createApiApp();
  const response = await request(app).post("/api/workspaces/create-sample").send({ workspacePath });
  expect(response.status).toBe(200);
  const snapshot = response.body.snapshot as BankSnapshot;
  const compileInput = { workspacePath, item: snapshot.bank.items[0], settings: snapshot.bank.settings };
  const exportInput = { workspacePath, baseRevision: snapshot.revision, itemIds: [snapshot.bank.items[0].id], fileName: "out" };
  return { app, compileInput, exportInput };
}

describe("document execution sessions", () => {
  it.each(["compile-item", "export"] as const)("rejects competing requests without touching artifacts during %s", async (route) => {
    const { app, compileInput, exportInput } = await setup();
    const entered = deferred<string>();
    const resume = deferred<void>();
    vi.mocked(compileLatex).mockImplementationOnce(async (texPath, _cwd, _timeout, session) => {
      assertLatexExecutionSession(session!);
      entered.resolve(texPath);
      await resume.promise;
      return successfulCompile(texPath);
    });
    const pending = request(app).post(`/api/${route}`).send(route === "export" ? exportInput : compileInput).then((value) => value);
    const texPath = await entered.promise;
    const source = await readFile(texPath, "utf8");
    const before = await readdir(tempDir);
    try {
      for (let index = 0; index < 4; index++) {
        for (const [endpoint, input] of [["compile-item", compileInput], ["export", exportInput]] as const) {
          await request(app).post(`/api/${endpoint}`).send(input)
            .expect(503).expect(({ body }) => expect(body.code).toBe("LATEX_BUSY"));
          expect(await readdir(tempDir)).toEqual(before);
          expect(await readFile(texPath, "utf8")).toBe(source);
        }
      }
    } finally {
      resume.resolve();
      await pending;
    }
    expect((await pending).status).toBe(200);
    await request(app).post("/api/compile-item").send(compileInput).expect(200);
  });

  it("holds the session through the second PDF and export commit", async () => {
    const { app, compileInput, exportInput } = await setup();
    const secondEntered = deferred<void>();
    const resumeSecond = deferred<void>();
    const commitEntered = deferred<void>();
    const resumeCommit = deferred<void>();
    vi.mocked(compileLatex).mockImplementation(async (texPath, _cwd, _timeout, session) => {
      assertLatexExecutionSession(session!);
      if (path.basename(texPath) === "full.tex") {
        secondEntered.resolve();
        await resumeSecond.promise;
      }
      return successfulCompile(texPath);
    });
    const commit = transactions.commitExportDirectory;
    vi.spyOn(transactions, "commitExportDirectory").mockImplementation(async (...args) => {
      commitEntered.resolve();
      await resumeCommit.promise;
      return commit(...args);
    });
    const pending = request(app).post("/api/export").send(exportInput).then((value) => value);
    try {
      await secondEntered.promise;
      await request(app).post("/api/compile-item").send(compileInput).expect(503);
      resumeSecond.resolve();
      await commitEntered.promise;
      await request(app).post("/api/export").send(exportInput).expect(503);
    } finally {
      resumeSecond.resolve();
      resumeCommit.resolve();
      await pending;
    }
    expect((await pending).status).toBe(200);
  });

  it("releases the session after preparation fails", async () => {
    const { app, compileInput, exportInput } = await setup();
    const assets = path.join(workspacePath, "assets");
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await rm(assets, { recursive: true });
    await symlink(outside, assets, process.platform === "win32" ? "junction" : "dir");
    for (const [route, input] of [["compile-item", compileInput], ["export", exportInput]] as const) {
      await request(app).post(`/api/${route}`).send(input).expect(403);
    }
    expect(compileLatex).not.toHaveBeenCalled();
    await rm(assets);
    await mkdir(assets);
    await request(app).post("/api/compile-item").send(compileInput).expect(200);
  });

  it("preserves the previous export and releases the session when the second PDF fails", async () => {
    const { app, compileInput, exportInput } = await setup();
    const previous = path.join(workspacePath, "exports/out");
    await mkdir(previous);
    await writeFile(path.join(previous, "full.pdf"), "previous complete export");
    vi.mocked(compileLatex).mockImplementation(async (texPath) => path.basename(texPath) === "full.tex"
      ? { ok: false, texPath, log: "synthetic failure" }
      : successfulCompile(texPath));
    await request(app).post("/api/export").send(exportInput).expect(422);
    expect(await readFile(path.join(previous, "full.pdf"), "utf8")).toBe("previous complete export");
    await request(app).post("/api/compile-item").send(compileInput).expect(200);
  });
});
