import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  commitExportDirectory,
  recoverExportTransactions,
  type ExportTransactionFileOps
} from "../../server/export-transaction.js";
import { StorageError } from "../../server/storage-types.js";
import {
  cleanupTempDirectory,
  EXPORT_TRANSACTION_DIR_NAME,
  EXPORT_TEMP_PREFIX,
  pruneWorkspaceTempArtifacts,
  PREVIOUS_EXPORT_PREFIX
} from "../../server/temp-directory-cleanup.js";

const workspacePath = path.resolve(".tmp/vitest-export-transaction");
const tempDir = path.join(workspacePath, ".tmp");
const exportDir = path.join(workspacePath, "exports");
const targetDir = path.join(exportDir, "questions");

beforeEach(async () => {
  await rm(workspacePath, { recursive: true, force: true });
  await Promise.all([
    mkdir(tempDir, { recursive: true }),
    mkdir(exportDir, { recursive: true })
  ]);
});

describe("recoverable export transactions", () => {
  it("commits a replacement and removes the previous export and journal", async () => {
    const stagingDir = await createStaging("new export");
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "value.txt"), "old export", "utf8");

    await commitExportDirectory(stagingDir, targetDir, tempDir);

    expect(await readFile(path.join(targetDir, "value.txt"), "utf8"))
      .toBe("new export");
    const tempEntries = await readdir(tempDir);
    expect(tempEntries.some((name) => name.startsWith(PREVIOUS_EXPORT_PREFIX)))
      .toBe(false);
    expect(
      await readdir(path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME))
    ).toEqual([]);
  });

  it("restores the previous export when installing staging fails", async () => {
    const stagingDir = await createStaging("new export");
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "value.txt"), "old export", "utf8");
    const fileOps = failRenames((from, to) =>
      from === stagingDir && to === targetDir
    );

    await expect(
      commitExportDirectory(stagingDir, targetDir, tempDir, fileOps)
    ).rejects.toMatchObject({ code: "EIO" });

    expect(await readFile(path.join(targetDir, "value.txt"), "utf8"))
      .toBe("old export");
    expect(await stat(stagingDir)).toBeDefined();
    expect(
      await readdir(path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME))
    ).toEqual([]);
  });

  it("keeps recovery evidence when both commit and immediate rollback fail", async () => {
    const stagingDir = await createStaging("new export");
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "value.txt"), "old export", "utf8");
    const fileOps = failRenames((from, to) =>
      (from === stagingDir && to === targetDir) ||
      (path.basename(from).startsWith(PREVIOUS_EXPORT_PREFIX) &&
        to === targetDir)
    );

    await expect(
      commitExportDirectory(stagingDir, targetDir, tempDir, fileOps)
    ).rejects.toMatchObject({
      code: "EXPORT_RECOVERY_REQUIRED",
      status: 500
    } satisfies Partial<StorageError>);
    await expect(stat(targetDir)).rejects.toMatchObject({ code: "ENOENT" });
    const previousName = (await readdir(tempDir)).find((name) =>
      name.startsWith(PREVIOUS_EXPORT_PREFIX)
    );
    expect(previousName).toBeDefined();
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await Promise.all([
      utimes(stagingDir, oldTime, oldTime),
      utimes(path.join(tempDir, previousName!), oldTime, oldTime)
    ]);
    await cleanupTempDirectory(tempDir, 0);
    await expect(stat(stagingDir)).resolves.toBeDefined();
    await expect(stat(path.join(tempDir, previousName!))).resolves.toBeDefined();

    const summary = await recoverExportTransactions(exportDir, tempDir);
    expect(summary).toEqual({ recovered: 1, finalized: 0, unresolved: 0 });
    expect(await readFile(path.join(targetDir, "value.txt"), "utf8"))
      .toBe("old export");
  });

  it("leaves a committed journal when previous-export cleanup fails", async () => {
    const stagingDir = await createStaging("new export");
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "value.txt"), "old export", "utf8");
    const fileOps: ExportTransactionFileOps = {
      rename,
      rm: async (targetPath, options) => {
        if (path.basename(String(targetPath)).startsWith(PREVIOUS_EXPORT_PREFIX)) {
          throw Object.assign(new Error("injected cleanup failure"), {
            code: "EBUSY"
          });
        }
        await rm(targetPath, options);
      }
    };

    await commitExportDirectory(stagingDir, targetDir, tempDir, fileOps);

    expect(await readFile(path.join(targetDir, "value.txt"), "utf8"))
      .toBe("new export");
    expect(
      await readdir(path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME))
    ).toHaveLength(1);
    await expect(recoverExportTransactions(exportDir, tempDir)).resolves
      .toEqual({ recovered: 0, finalized: 1, unresolved: 0 });
  });

  it("finishes a first export from a complete staging directory after restart", async () => {
    const stagingDir = await createStaging("new export");
    const fileOps = failRenames((from, to) =>
      from === stagingDir && to === targetDir
    );

    await expect(
      commitExportDirectory(stagingDir, targetDir, tempDir, fileOps)
    ).rejects.toMatchObject({ code: "EXPORT_RECOVERY_REQUIRED" });

    const summary = await recoverExportTransactions(exportDir, tempDir);
    expect(summary).toEqual({ recovered: 1, finalized: 0, unresolved: 0 });
    expect(await readFile(path.join(targetDir, "value.txt"), "utf8"))
      .toBe("new export");
  });

  it("preserves journals, previous exports, and referenced staging during cleanup", async () => {
    const stagingDir = await createStaging("new export");
    const fileOps = failRenames((from, to) =>
      from === stagingDir && to === targetDir
    );
    await expect(
      commitExportDirectory(stagingDir, targetDir, tempDir, fileOps)
    ).rejects.toMatchObject({ code: "EXPORT_RECOVERY_REQUIRED" });
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(stagingDir, oldTime, oldTime);

    await cleanupTempDirectory(tempDir, 0);

    await expect(stat(stagingDir)).resolves.toBeDefined();
    await expect(
      stat(path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME))
    ).resolves.toBeDefined();
  });

  it("does not prune the export transaction directory as ordinary staging", async () => {
    const transactionDir = path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME);
    const olderStaging = path.join(tempDir, `${EXPORT_TEMP_PREFIX}older`);
    const newerStaging = path.join(tempDir, `${EXPORT_TEMP_PREFIX}newer`);
    await Promise.all([
      mkdir(transactionDir, { recursive: true }),
      mkdir(olderStaging, { recursive: true }),
      mkdir(newerStaging, { recursive: true })
    ]);
    const oldTime = new Date(Date.now() - 60_000);
    await utimes(olderStaging, oldTime, oldTime);

    await pruneWorkspaceTempArtifacts(tempDir, [
      { prefix: EXPORT_TEMP_PREFIX, keepNewest: 1 }
    ]);

    await expect(stat(transactionDir)).resolves.toBeDefined();
    await expect(stat(newerStaging)).resolves.toBeDefined();
    await expect(stat(olderStaging)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks recovery and a second commit while a commit is active", async () => {
    const stagingDir = await createStaging("first export");
    let markRenameStarted: (() => void) | undefined;
    const renameStarted = new Promise<void>((resolve) => {
      markRenameStarted = resolve;
    });
    let releaseRename: (() => void) | undefined;
    const renameReleased = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    const fileOps: ExportTransactionFileOps = {
      rename: async (oldPath, newPath) => {
        if (String(oldPath) === stagingDir) {
          markRenameStarted?.();
          await renameReleased;
        }
        await rename(oldPath, newPath);
      },
      rm
    };

    const firstCommit = commitExportDirectory(
      stagingDir,
      targetDir,
      tempDir,
      fileOps
    );
    await renameStarted;
    const secondStaging = await createStaging("second export");

    await expect(
      commitExportDirectory(secondStaging, targetDir, tempDir)
    ).rejects.toMatchObject({ code: "EXPORT_BUSY", status: 503 });
    await expect(recoverExportTransactions(exportDir, tempDir)).resolves
      .toEqual({ recovered: 0, finalized: 0, unresolved: 1 });

    releaseRename?.();
    await firstCommit;
    expect(await readFile(path.join(targetDir, "value.txt"), "utf8"))
      .toBe("first export");
  });

  it("leaves an invalid transaction record unresolved without following paths", async () => {
    const transactionDir = path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME);
    await mkdir(transactionDir, { recursive: true });
    await writeFile(
      path.join(transactionDir, "invalid.json"),
      JSON.stringify({ version: 1, id: "../outside" }),
      "utf8"
    );

    await expect(recoverExportTransactions(exportDir, tempDir)).resolves
      .toEqual({ recovered: 0, finalized: 0, unresolved: 1 });
  });

  it("treats a non-file transaction entry as unresolved and preserves staging", async () => {
    const transactionDir = path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME);
    const stagingDir = await createStaging("diagnostic staging");
    await mkdir(path.join(transactionDir, "not-a-file.json"), {
      recursive: true
    });
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(stagingDir, oldTime, oldTime);

    await expect(recoverExportTransactions(exportDir, tempDir)).resolves
      .toEqual({ recovered: 0, finalized: 0, unresolved: 1 });
    await cleanupTempDirectory(tempDir, 0);
    await expect(stat(stagingDir)).resolves.toBeDefined();
  });
});

async function createStaging(contents: string): Promise<string> {
  const stagingDir = path.join(tempDir, `export-${crypto.randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });
  await writeFile(path.join(stagingDir, "value.txt"), contents, "utf8");
  return stagingDir;
}

function failRenames(
  shouldFail: (from: string, to: string) => boolean
): ExportTransactionFileOps {
  return {
    rename: async (oldPath, newPath) => {
      const from = String(oldPath);
      const to = String(newPath);
      if (shouldFail(from, to)) {
        throw Object.assign(new Error("injected rename failure"), {
          code: "EIO"
        });
      }
      await rename(oldPath, newPath);
    },
    rm
  };
}
