import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { BUILTIN_SKINS } from "../../shared/builtin-skins.js";
import { getAgentToken } from "../../server/agent-auth.js";
import { appDataDir } from "../../server/app-state.js";
import { closeEventClients } from "../../server/events.js";
import { createApiApp } from "../../server/index.js";
import { listenLocal, request } from "../fixtures/api-server.js";

let url: string;
const dir = path.join(appDataDir, "skins");
const outside = path.resolve(".tmp/vitest-skins-outside");
const auth = () => `Bearer ${getAgentToken()}`;
const custom = () => ({ ...structuredClone(BUILTIN_SKINS[0]!), id: "custom" });
beforeAll(async () => { url = await listenLocal(createApiApp()); });
beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await rm(outside, { recursive: true, force: true });
  await mkdir(outside, { recursive: true });
});
afterEach(() => { closeEventClients(); });
it("authenticates writes and enforces Host/Origin before parsing", async () => {
  expect((await request(url).post("/api/agent/skins").send(custom())).status).toBe(401);
  expect((await request(url).delete("/api/agent/skins/custom")).status).toBe(401);
  expect((await request(url).post("/api/agent/skins").set("Authorization", "Bearer invalid").send(custom())).status).toBe(401);
  expect((await request(url).get("/api/skins").set("Host", "evil.test")).status).toBe(403);
  expect((await request(url).post("/api/agent/skins").set("Host", "evil.test").set("Authorization", auth()).send(custom())).status).toBe(403);
  expect((await request(url).post("/api/agent/skins").set("Origin", "https://evil.test").set("Authorization", auth()).send(custom())).status).toBe(403);
  expect((await request(url).delete("/api/agent/skins/custom").set("Origin", "https://evil.test").set("Authorization", auth())).status).toBe(403);
});
it("installs, requires explicit overwrite, lists and removes without a workspace", async () => {
  expect((await request(url).post("/api/agent/skins").set("Authorization", auth()).send(custom())).status).toBe(200);
  const original = await readFile(path.join(dir, "custom.json"), "utf8");
  expect((await request(url).post("/api/agent/skins").set("Authorization", auth()).send({ ...custom(), name: "new" })).body.code).toBe("SKIN_EXISTS");
  expect(await readFile(path.join(dir, "custom.json"), "utf8")).toBe(original);
  expect((await request(url).post("/api/agent/skins?overwrite=true").set("Authorization", auth()).send({ ...custom(), name: "new" })).status).toBe(200);
  const list = await request(url).get("/api/skins");
  expect(list.body.skins).toHaveLength(5);
  expect(list.body.errors).toEqual([]);
  expect(list.body.skins[4].name).toBe("new");
  expect((await request(url).delete("/api/agent/skins/custom").set("Authorization", auth())).status).toBe(200);
  expect((await request(url).delete("/api/agent/skins/custom").set("Authorization", auth())).body.code).toBe("SKIN_NOT_FOUND");
});
it("serializes competing installs and rejects builtin changes, invalid JSON and excess bytes", async () => {
  const attempts = await Promise.all([1, 2].map(() => request(url).post("/api/agent/skins").set("Authorization", auth()).send(custom())));
  expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await request(url).post("/api/agent/skins").set("Authorization", auth()).send(BUILTIN_SKINS[0])).body.code).toBe("SKIN_BUILTIN");
  expect((await request(url).delete("/api/agent/skins/sheet").set("Authorization", auth())).body.code).toBe("SKIN_BUILTIN");
  expect((await request(url).post("/api/agent/skins").set("Authorization", auth()).send({ ...custom(), id: "../escape" })).body.code).toBe("SKIN_ID");
  expect((await request(url).post("/api/agent/skins").set("Authorization", auth()).set("Content-Type", "application/json").send("{")).body.code).toBe("SKIN_JSON");
  expect((await request(url).post("/api/agent/skins").set("Authorization", auth()).set("Content-Type", "application/json").send(" ".repeat(17000) + "{}")).body.code).toBe("SKIN_TOO_LARGE");
});
it("lists invalid files as errors and refuses symlinks, non-files and mismatched filenames", async () => {
  const target = path.join(outside, "outside.json");
  await writeFile(target, JSON.stringify(custom()));
  await symlink(target, path.join(dir, "custom.json"));
  await writeFile(path.join(dir, "broken.json"), "{");
  await writeFile(path.join(dir, "oversized.json"), " ".repeat(17000));
  await writeFile(path.join(dir, "mismatch.json"), JSON.stringify(custom()));
  await mkdir(path.join(dir, "directory.json"));
  const list = await request(url).get("/api/skins");
  expect(list.status).toBe(200);
  expect(list.body.skins).toHaveLength(4);
  expect(list.body.errors.map((e: { code: string }) => e.code).sort()).toEqual(["SKIN_JSON", "SKIN_PATH", "SKIN_PATH", "SKIN_ID", "SKIN_TOO_LARGE"].sort());
  expect((await request(url).post("/api/agent/skins?overwrite=true").set("Authorization", auth()).send(custom())).body.code).toBe("SKIN_PATH");
  expect((await request(url).delete("/api/agent/skins/custom").set("Authorization", auth())).body.code).toBe("SKIN_PATH");
  expect(JSON.parse(await readFile(target, "utf8"))).toEqual(custom());
});
it("rejects a symlinked skins directory without touching its target", async () => {
  await rm(dir, { recursive: true });
  await symlink(outside, dir);
  const list = await request(url).get("/api/skins");
  expect(list.status).toBe(200);
  expect(list.body.errors[0].code).toBe("SKIN_PATH");
  expect((await request(url).post("/api/agent/skins").set("Authorization", auth()).send(custom())).body.code).toBe("SKIN_PATH");
  expect((await request(url).delete("/api/agent/skins/custom").set("Authorization", auth())).body.code).toBe("SKIN_PATH");
});
it("broadcasts skins-changed only after successful writes", async () => {
  const controller = new AbortController();
  const events = await fetch(`${url}/api/events`, { signal: controller.signal });
  const reader = events.body!.getReader();
  try {
    await reader.read();
    await request(url).post("/api/agent/skins").set("Authorization", auth()).send(custom());
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: skins-changed\ndata: {"id":"custom"}');
    await request(url).post("/api/agent/skins").set("Authorization", auth()).send(custom());
    await request(url).delete("/api/agent/skins/custom").set("Authorization", auth());
    const event = new TextDecoder().decode((await reader.read()).value);
    expect(event.match(/event: skins-changed/g)).toHaveLength(1);
  } finally { controller.abort(); await reader.cancel().catch(() => undefined); }
});
