import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir
} from "node:fs/promises";
import path from "node:path";
import type {
  BankSnapshot,
  SaveBankAsRequest
} from "../shared/types.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError } from "./storage-types.js";
import {
  requireValidBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";
import {
  getWorkspaceDirs,
  readAppState,
  switchWorkspace
} from "./workspace-storage.js";

export async function saveBankAsWorkspace(
  request: SaveBankAsRequest
): Promise<BankSnapshot> {
  const sourceWorkspacePath = path.resolve(request.sourceWorkspacePath);
  const targetWorkspacePath = path.resolve(request.targetWorkspacePath);
  if (sourceWorkspacePath === targetWorkspacePath) {
    throw new StorageError(
      "另存目标不能是当前工作区。",
      "WORKSPACE_SAVE_AS_SAME_PATH"
    );
  }

  return withWorkspaceWriteLock(targetWorkspacePath, async () => {
    const state = await readAppState();
    if (
      !state.currentWorkspacePath ||
      path.resolve(state.currentWorkspacePath) !== sourceWorkspacePath
    ) {
      throw new StorageError(
        "另存来源已不是当前工作区，请重新处理保存问题。",
        "WORKSPACE_CHANGED",
        409
      );
    }

    const bank = requireValidBank(request.bank);
    const targetExisted = await assertEmptyTargetDirectory(
      targetWorkspacePath
    );
    const targetParent = path.dirname(targetWorkspacePath);
    const targetName = path.basename(targetWorkspacePath);
    await mkdir(targetParent, { recursive: true });
    const stagingPath = path.join(
      targetParent,
      `.${targetName}.lqb-save-as-${crypto.randomUUID()}.tmp`
    );
    let committed = false;

    try {
      await buildStagedWorkspace(
        sourceWorkspacePath,
        stagingPath,
        bank
      );
      if (targetExisted) {
        // rmdir 只有在目录此刻仍为空时才成功，避免检查后竞态覆盖新文件。
        await rmdir(targetWorkspacePath);
      }
      await rename(stagingPath, targetWorkspacePath);
      committed = true;
      await switchWorkspace(targetWorkspacePath);
      const content = serializeJson(bank);
      return {
        workspacePath: targetWorkspacePath,
        revision: revisionForContent(content),
        bank
      };
    } catch (error) {
      if (!committed) {
        await rm(stagingPath, { recursive: true, force: true });
        if (targetExisted) {
          await mkdir(targetWorkspacePath, { recursive: true });
        }
      }
      throw error;
    }
  });
}

async function assertEmptyTargetDirectory(
  targetWorkspacePath: string
): Promise<boolean> {
  try {
    const info = await lstat(targetWorkspacePath);
    if (info.isSymbolicLink()) {
      throw new StorageError(
        "另存目标不能是符号链接。",
        "WORKSPACE_SAVE_AS_TARGET_SYMLINK",
        403
      );
    }
    if (!info.isDirectory()) {
      throw new StorageError(
        "另存目标必须是空文件夹。",
        "WORKSPACE_SAVE_AS_TARGET_INVALID"
      );
    }
    if ((await readdir(targetWorkspacePath)).length > 0) {
      throw new StorageError(
        "另存目标必须是空文件夹。",
        "WORKSPACE_SAVE_AS_TARGET_NOT_EMPTY"
      );
    }
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function buildStagedWorkspace(
  sourceWorkspacePath: string,
  stagingPath: string,
  bank: SaveBankAsRequest["bank"]
) {
  const sourceDirs = getWorkspaceDirs(sourceWorkspacePath);
  await assertRealWorkspaceSubdir(sourceDirs.assetDir);
  const stagingDirs = getWorkspaceDirs(stagingPath);
  await Promise.all([
    mkdir(stagingDirs.assetDir, { recursive: true }),
    mkdir(stagingDirs.exportDir, { recursive: true }),
    mkdir(stagingDirs.tempDir, { recursive: true })
  ]);

  const fileNames = new Set(
    bank.items.flatMap((item) =>
      item.assets.map((asset) => asset.fileName)
    )
  );
  for (const fileName of fileNames) {
    const sourcePath = path.join(sourceDirs.assetDir, fileName);
    let info;
    try {
      info = await lstat(sourcePath);
    } catch (error) {
      if (isNotFound(error)) {
        throw new StorageError(
          `另存失败：引用图片 ${fileName} 不存在。`,
          "WORKSPACE_SAVE_AS_ASSET_MISSING"
        );
      }
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new StorageError(
        `另存失败：引用图片 ${fileName} 不是普通文件。`,
        "WORKSPACE_SAVE_AS_ASSET_INVALID",
        403
      );
    }
    await copyFile(
      sourcePath,
      path.join(stagingDirs.assetDir, fileName)
    );
  }

  await writeJsonFileAtomic(stagingDirs.bankPath, bank, {
    backup: false
  });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
