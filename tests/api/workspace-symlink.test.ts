import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../server/index.js";
import { appDataDir } from "../../server/app-state.js";
import { createSampleBank } from "../../server/bank-schema.js";
import { cleanupTempDirectory } from "../../server/temp-directory-cleanup.js";
import { assertRealWorkspaceSubdir } from "../../server/workspace-paths.js";
import { getWorkspaceDirs } from "../../server/workspace-storage.js";

const workspacePath = path.resolve(".tmp/vitest-symlink-workspace");
const externalDir = path.resolve(".tmp/vitest-symlink-external");
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function createEmptyWorkspaceViaApi(app: ReturnType<typeof createApiApp>) {
  await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(200);
}

async function linkSubdirToExternal(subdir: string) {
  await mkdir(externalDir, { recursive: true });
  const target = path.join(workspacePath, subdir);
  await rm(target, { recursive: true, force: true });
  await symlink(externalDir, target);
}

// Windows symlink 创建需要提权/开发者模式,守卫本身跨平台;仅测试构造在 Windows 受限,故跳过。
describe.skipIf(process.platform === "win32")("workspace subdirectory symlink guard", () => {
  beforeEach(async () => {
    await rm(appDataDir, { recursive: true, force: true });
    await rm(workspacePath, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  });

  it("accepts real directories, allows missing ones, and rejects symlinks", async () => {
    await mkdir(path.join(workspacePath, "assets"), { recursive: true });
    await expect(
      assertRealWorkspaceSubdir(path.join(workspacePath, "assets"))
    ).resolves.toContain(`${path.sep}assets`);
    await expect(
      assertRealWorkspaceSubdir(path.join(workspacePath, ".tmp"))
    ).resolves.toContain(".tmp");

    await mkdir(externalDir, { recursive: true });
    await symlink(externalDir, path.join(workspacePath, "exports"));
    await expect(
      assertRealWorkspaceSubdir(path.join(workspacePath, "exports"))
    ).rejects.toMatchObject({ code: "WORKSPACE_SUBDIR_SYMLINK" });
  });

  it("does not delete files outside the workspace when .tmp is a symlink", async () => {
    await mkdir(externalDir, { recursive: true });
    const externalFile = path.join(externalDir, "precious.txt");
    await writeFile(externalFile, "precious", "utf8");
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(externalFile, stale, stale);

    await mkdir(workspacePath, { recursive: true });
    await symlink(externalDir, path.join(workspacePath, ".tmp"));

    await cleanupTempDirectory(getWorkspaceDirs(workspacePath).tempDir);
    expect(await readFile(externalFile, "utf8")).toBe("precious");
  });

  it("rejects saving (history snapshot) when .history is a symlink and writes nothing outside", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    const initial = await request(app).get("/api/bank").expect(200);
    await linkSubdirToExternal(".history");

    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: createSampleBank()
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_SUBDIR_SYMLINK"));

    expect(await readdir(externalDir)).toHaveLength(0);
  });

  it("rejects exporting when exports is a symlink", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    const initial = await request(app).get("/api/bank").expect(200);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: createSampleBank()
      })
      .expect(200);

    await linkSubdirToExternal("exports");

    await request(app)
      .post("/api/export")
      .send({
        itemIds: [createSampleBank().items[0].id],
        fileName: "out",
        orderMode: "normal"
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_SUBDIR_SYMLINK"));

    expect(await readdir(externalDir)).toHaveLength(0);
  });

  it("rejects asset upload when assets is a symlink and writes nothing outside", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    await linkSubdirToExternal("assets");

    await request(app)
      .post("/api/assets")
      .attach("file", pngSignature, { filename: "real.png", contentType: "image/png" })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_SUBDIR_SYMLINK"));

    expect(await readdir(externalDir)).toHaveLength(0);
  });

  it("does not falsely reject a workspace with normal real subdirectories", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    const initial = await request(app).get("/api/bank").expect(200);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: initial.body.revision,
        bank: createSampleBank()
      })
      .expect(200);
    await request(app)
      .post("/api/assets")
      .attach("file", pngSignature, { filename: "ok.png", contentType: "image/png" })
      .expect(200);
  });
});
