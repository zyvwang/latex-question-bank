import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { createApiApp } from "../../server/index.js";
import { apiErrorHandler } from "../../server/http/middleware.js";
import { appDataDir } from "../../server/app-state.js";

const workspacePath = path.resolve(".tmp/vitest-json-errors");
beforeEach(async () => {
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataDir, { recursive: true, force: true });
});

it("returns a safe 400 for invalid JSON before mutating the bank", async () => {
  const app = createApiApp();
  await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(200);
  const before = await readFile(path.join(workspacePath, "bank.json"), "utf8");
  for (const body of ['{"bank":', '{ broken private-content }', '{"bank":{}', '{"bank":undefined}']) {
    for (const [method, url] of [["put", "/api/bank"], ["post", "/api/compile-item"], ["post", "/api/workspaces/save-as"]] as const) {
      await request(app)[method](url).set("Content-Type", "application/json").send(body).expect(400)
        .expect(({ body }) => expect(body).toEqual({ error: "请求 JSON 格式无效。", code: "REQUEST_JSON_INVALID" }));
    }
  }
  expect(await readFile(path.join(workspacePath, "bank.json"), "utf8")).toBe(before);
  await request(app).post("/api/compile-item").send({}).expect(400)
    .expect(({ body }) => expect(body.code).toBe("COMPILE_REQUEST_INVALID"));
});

it("preserves origin and body-size gates before JSON syntax errors", async () => {
  const app = createApiApp({ jsonBodyLimitBytes: 16 });
  await request(app).post("/api/compile-item").set("Content-Type", "application/json")
    .set("Origin", "https://example.invalid").send("{ broken").expect(403);
  await request(app).post("/api/compile-item").set("Content-Type", "application/json")
    .send("{" + "x".repeat(32)).expect(413)
    .expect(({ body }) => expect(body.code).toBe("REQUEST_PAYLOAD_TOO_LARGE"));
});

it("does not classify an internal SyntaxError as invalid request JSON", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.get("/internal", () => { throw new SyntaxError("private internal details"); });
  app.use(apiErrorHandler);
  await request(app).get("/internal").expect(500)
    .expect(({ body }) => expect(body).toEqual({ error: "服务器内部错误。", code: "INTERNAL_ERROR" }));
});
