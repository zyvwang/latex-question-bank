import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Bank, BankSnapshot, SaveBankRequest } from "../shared/types.js";
import { createEmptyBank } from "./bank-schema.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import {
  hasSessionHistory,
  markSessionHistoryCreated
} from "./storage-session.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import {
  isNotFound,
  MAX_HISTORY_SNAPSHOTS,
  parseStoredBank,
  requireValidBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import {
  getWorkspaceDirs,
  readAppState,
  workspaceExists
} from "./workspace-storage.js";

export async function readBank(): Promise<Bank> {
  return (await readBankSnapshot()).bank;
}

export async function readBankSnapshot(): Promise<BankSnapshot> {
  const state = await readAppState();
  if (!state.currentWorkspacePath) {
    const bank = createEmptyBank();
    return { workspacePath: "", revision: revisionForContent(serializeJson(bank)), bank };
  }
  const dirs = getWorkspaceDirs(state.currentWorkspacePath);
  try {
    const raw = await readFile(dirs.bankPath, "utf8");
    return {
      workspacePath: dirs.workspaceDir,
      revision: revisionForContent(raw),
      bank: parseStoredBank(raw)
    };
  } catch (error) {
    if (isNotFound(error)) {
      throw new StorageError("当前工作区缺少 bank.json。", "WORKSPACE_MISSING", 404);
    }
    throw error;
  }
}

export async function saveBankSnapshot(request: SaveBankRequest): Promise<BankSnapshot> {
  const workspacePath = path.resolve(request.workspacePath);
  return withWorkspaceWriteLock(workspacePath, async () => {
    const state = await readAppState();
    if (!state.currentWorkspacePath || path.resolve(state.currentWorkspacePath) !== workspacePath) {
      throw new StorageError("题库保存目标已不是当前工作区，请重试。", "WORKSPACE_CHANGED", 409);
    }
    if (!(await workspaceExists(workspacePath))) {
      throw new StorageError("当前工作区缺少 bank.json。", "WORKSPACE_MISSING", 404);
    }

    const dirs = getWorkspaceDirs(workspacePath);
    const currentRaw = await readFile(dirs.bankPath, "utf8");
    const currentRevision = revisionForContent(currentRaw);
    if (currentRevision !== request.baseRevision) {
      throw new StorageError(
        "题库已被其他程序修改。当前编辑内容尚未覆盖磁盘文件。",
        "BANK_CONFLICT",
        409
      );
    }

    const bank = requireValidBank(request.bank);
    if (!hasSessionHistory(workspacePath)) {
      await createHistorySnapshot(dirs, currentRaw, currentRevision);
      markSessionHistoryCreated(workspacePath);
    }
    await writeJsonFileAtomic(dirs.bankPath, bank);
    const raw = serializeJson(bank);
    return { workspacePath, revision: revisionForContent(raw), bank };
  });
}

async function createHistorySnapshot(dirs: WorkspaceDirs, raw: string, revision: string) {
  await assertRealWorkspaceSubdir(dirs.historyDir);
  await mkdir(dirs.historyDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}-${revision.slice(0, 12)}.json`;
  await writeFile(path.join(dirs.historyDir, fileName), raw, {
    encoding: "utf8",
    flush: true
  });
  const files = (await readdir(dirs.historyDir))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse();
  await Promise.all(
    files
      .slice(MAX_HISTORY_SNAPSHOTS)
      .map((file) => rm(path.join(dirs.historyDir, file), { force: true }))
  );
}
