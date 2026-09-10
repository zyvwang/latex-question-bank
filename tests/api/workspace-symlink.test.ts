import { validPng } from "../fixtures/images.js";
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
const saveAsPath = path.resolve(".tmp/vitest-symlink-save-as");
const pngSignature = validPng;

function withAsset(fileName: string) {
  const sample = createSampleBank();
  const item = {
    ...sample.items[0],
    assets: [
      {
        id: "linked-asset",
        fileName,
        originalName: fileName,
        relativePath: `assets/${fileName}`,
        mimeType: "image/png" as const,
        size: pngSignature.length,
        uploadedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
  return {
    bank: {
      ...sample,
      items: [item, ...sample.items.slice(1)]
    },
    item
  };
}

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
    await rm(saveAsPath, { recursive: true, force: true });
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
        workspacePath,
        baseRevision: (await request(app).get("/api/bank")).body.revision,
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
      .field("workspacePath", workspacePath)
      .attach("file", pngSignature, { filename: "real.png", contentType: "image/png" })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_SUBDIR_SYMLINK"));

    expect(await readdir(externalDir)).toHaveLength(0);
  });

  it("rejects opening a workspace whose subdirectory is a symlink", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    await linkSubdirToExternal("exports");

    // 打开阶段就 fail-closed,而不是等到导出/上传时逐个操作各自报错。
    await request(app)
      .post("/api/workspaces/open")
      .send({ workspacePath })
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
      .field("workspacePath", workspacePath)
      .attach("file", pngSignature, { filename: "ok.png", contentType: "image/png" })
      .expect(200);
  });

  it("serves regular files for GET and HEAD without falling through missing files to the SPA", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    const uploaded = await request(app)
      .post("/api/assets")
      .field("workspacePath", workspacePath)
      .attach("file", pngSignature, { filename: "ok.png", contentType: "image/png" })
      .expect(200);

    await request(app)
      .get(`/assets/${uploaded.body.asset.fileName}`)
      .expect(200)
      .expect("Content-Type", /image\/png/);
    await request(app)
      .head(`/assets/${uploaded.body.asset.fileName}`)
      .expect(200)
      .expect("Content-Type", /image\/png/);
    await request(app)
      .get(`/assets/${uploaded.body.asset.fileName}`)
      .set("Range", "bytes=0-3")
      .expect(206)
      .expect("Content-Range", `bytes 0-3/${pngSignature.length}`);
    await request(app).get("/assets/missing.png").expect(404);
  });

  it("rejects a symlinked asset for preview, compile, and export", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    const initial = await request(app).get("/api/bank").expect(200);
    const fileName = "linked.png";
    const { bank, item } = withAsset(fileName);
    await request(app)
      .put("/api/bank")
      .send({ workspacePath, baseRevision: initial.body.revision, bank })
      .expect(200);

    await mkdir(externalDir, { recursive: true });
    const externalFile = path.join(externalDir, "private.png");
    await writeFile(externalFile, pngSignature);
    await symlink(externalFile, path.join(workspacePath, "assets", fileName));

    await request(app)
      .get(`/assets/${fileName}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_ENTRY_SYMLINK"));
    await request(app)
      .post("/api/compile-item")
      .send({ item, settings: bank.settings, workspacePath })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_ENTRY_SYMLINK"));
    await request(app)
      .post("/api/export")
      .send({ itemIds: [item.id], fileName: "linked-export", orderMode: "normal", workspacePath, baseRevision: (await request(app).get("/api/bank")).body.revision })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_ENTRY_SYMLINK"));

    expect(await readFile(externalFile)).toEqual(pngSignature);
  });

  it("rejects recovery reads when .history is replaced by a symlink", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    await mkdir(externalDir, { recursive: true });
    await writeFile(
      path.join(externalDir, "outside.json"),
      `${JSON.stringify(createSampleBank())}\n`,
      "utf8"
    );
    await symlink(externalDir, path.join(workspacePath, ".history"));

    await request(app)
      .get("/api/recovery")
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("WORKSPACE_SUBDIR_SYMLINK"));
  });

  it("omits symlinked recovery candidates and refuses them during restore", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    await mkdir(path.join(workspacePath, ".history"), { recursive: true });
    await mkdir(externalDir, { recursive: true });
    const candidateId = "linked-history.json";
    const externalFile = path.join(externalDir, "outside.json");
    await writeFile(externalFile, `${JSON.stringify(createSampleBank())}\n`, "utf8");
    await symlink(externalFile, path.join(workspacePath, ".history", candidateId));
    await symlink(externalFile, path.join(workspacePath, "bank.json.bak"));

    const candidates = await request(app).get("/api/recovery").expect(200);
    expect(candidates.body.candidates).not.toContainEqual(
      expect.objectContaining({ id: candidateId })
    );
    expect(candidates.body.candidates).not.toContainEqual(
      expect.objectContaining({ id: "bank.json.bak" })
    );
    await request(app)
      .post("/api/recovery")
      .send({ candidateId, workspacePath })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("RECOVERY_CANDIDATE_INVALID"));
    await request(app)
      .post("/api/recovery")
      .send({ candidateId: "bank.json.bak", workspacePath })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("RECOVERY_CANDIDATE_INVALID"));
    expect(await readFile(externalFile, "utf8")).toContain('"version":2');
  });

  it("revalidates a history candidate when it becomes a symlink before restore", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    const historyDir = path.join(workspacePath, ".history");
    const candidateId = "replace-after-list.json";
    const candidatePath = path.join(historyDir, candidateId);
    await mkdir(historyDir, { recursive: true });
    await writeFile(candidatePath, `${JSON.stringify(createSampleBank())}\n`, "utf8");

    const listed = await request(app).get("/api/recovery").expect(200);
    expect(listed.body.candidates).toContainEqual(
      expect.objectContaining({ id: candidateId })
    );

    await mkdir(externalDir, { recursive: true });
    const externalFile = path.join(externalDir, "outside.json");
    await writeFile(externalFile, `${JSON.stringify(createSampleBank())}\n`, "utf8");
    await rm(candidatePath);
    await symlink(externalFile, candidatePath);

    await request(app)
      .post("/api/recovery")
      .send({ candidateId, workspacePath })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("RECOVERY_CANDIDATE_INVALID"));
    expect(await readFile(externalFile, "utf8")).toContain('"version":2');
  });

  it("rejects save-as when a referenced asset file is a symlink", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    await mkdir(externalDir, { recursive: true });
    const externalFile = path.join(externalDir, "private.png");
    await writeFile(externalFile, pngSignature);
    const assetFileName = "linked.png";
    await symlink(
      externalFile,
      path.join(workspacePath, "assets", assetFileName)
    );
    await mkdir(saveAsPath, { recursive: true });
    const { bank: bankWithLinkedAsset } = withAsset(assetFileName);

    await request(app)
      .post("/api/workspaces/save-as")
      .send({
        sourceWorkspacePath: workspacePath,
        targetWorkspacePath: saveAsPath,
        bank: bankWithLinkedAsset
      })
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe("WORKSPACE_SAVE_AS_ASSET_INVALID")
      );

    expect(await readdir(saveAsPath)).toEqual([]);
    expect(await readFile(externalFile)).toEqual(pngSignature);
  });

  it("rejects a save-as target that is a symlink", async () => {
    const app = createApiApp();
    await createEmptyWorkspaceViaApi(app);
    await mkdir(externalDir, { recursive: true });
    await symlink(externalDir, saveAsPath);

    await request(app)
      .post("/api/workspaces/save-as")
      .send({
        sourceWorkspacePath: workspacePath,
        targetWorkspacePath: saveAsPath,
        bank: createSampleBank()
      })
      .expect(403)
      .expect(({ body }) =>
        expect(body.code).toBe("WORKSPACE_SAVE_AS_TARGET_SYMLINK")
      );

    expect(await readdir(externalDir)).toEqual([]);
  });
});

it("rejects recovery addressed to a different workspace before touching its backup", async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  const app = createApiApp();
  await createEmptyWorkspaceViaApi(app);
  const before = await readFile(path.join(workspacePath, "bank.json"), "utf8");
  await request(app).post("/api/recovery")
    .send({ candidateId: "bank.json.bak", workspacePath: externalDir })
    .expect(409)
    .expect(({ body }) => expect(body.code).toBe("WORKSPACE_CHANGED"));
  expect(await readFile(path.join(workspacePath, "bank.json"), "utf8")).toBe(before);
});
