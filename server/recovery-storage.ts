import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { BankSnapshot, RecoveryCandidate } from "../shared/types.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import {
  isNotFound,
  MAX_HISTORY_SNAPSHOTS,
  parseStoredBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { getCurrentWorkspaceDirs } from "./workspace-storage.js";
import {
  assertRealWorkspaceSubdir,
  resolveRealWorkspaceFile
} from "./workspace-paths.js";

export async function listRecoveryCandidates(): Promise<RecoveryCandidate[]> {
  return listRecoveryCandidatesForDirs(await getCurrentWorkspaceDirs());
}

async function listRecoveryCandidatesForDirs(dirs: WorkspaceDirs): Promise<RecoveryCandidate[]> {
  const candidates: RecoveryCandidate[] = [];
  const backup = await recoveryCandidateFromFile(
    "bank.json.bak",
    () => resolveRegularRecoveryFile(`${dirs.bankPath}.bak`),
    "backup"
  );
  if (backup) candidates.push(backup);

  const historyDir = await assertRealWorkspaceSubdir(dirs.historyDir);
  try {
    const files = (await readdir(historyDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const file of files.slice(0, MAX_HISTORY_SNAPSHOTS)) {
      const candidate = await recoveryCandidateFromFile(
        file,
        () => resolveRealWorkspaceFile(historyDir, file),
        "history"
      );
      if (candidate) candidates.push(candidate);
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return candidates;
}

export async function recoverBank(candidateId: string): Promise<BankSnapshot> {
  const initialDirs = await getCurrentWorkspaceDirs();
  return withWorkspaceWriteLock(initialDirs.workspaceDir, async () => {
    const dirs = await getCurrentWorkspaceDirs();
    if (dirs.workspaceDir !== initialDirs.workspaceDir) {
      throw new StorageError("恢复目标已不是当前工作区，请重试。", "WORKSPACE_CHANGED", 409);
    }
    const candidates = await listRecoveryCandidatesForDirs(dirs);
    if (!candidates.some((candidate) => candidate.id === candidateId)) {
      throw new StorageError("无效或已过期的恢复候选。", "RECOVERY_CANDIDATE_INVALID");
    }
    let candidatePath: string;
    try {
      candidatePath =
        candidateId === "bank.json.bak"
          ? await resolveRegularRecoveryFile(`${dirs.bankPath}.bak`)
          : await resolveRealWorkspaceFile(dirs.historyDir, candidateId);
    } catch (error) {
      if (isNotFound(error)) {
        throw new StorageError(
          "无效或已过期的恢复候选。",
          "RECOVERY_CANDIDATE_INVALID"
        );
      }
      throw error;
    }
    const bank = parseStoredBank(await readFile(candidatePath, "utf8"));
    await writeJsonFileAtomic(dirs.bankPath, bank, {
      backup: candidateId !== "bank.json.bak"
    });
    const savedRaw = serializeJson(bank);
    return {
      workspacePath: dirs.workspaceDir,
      revision: revisionForContent(savedRaw),
      bank
    };
  });
}

async function recoveryCandidateFromFile(
  id: string,
  resolveFilePath: () => Promise<string>,
  source: RecoveryCandidate["source"]
): Promise<RecoveryCandidate | null> {
  try {
    const filePath = await resolveFilePath();
    parseStoredBank(await readFile(filePath, "utf8"));
    const metadata = await lstat(filePath);
    return {
      id,
      label: source === "backup" ? "最近一次保存前的备份" : `历史快照 ${metadata.mtime.toLocaleString()}`,
      createdAt: metadata.mtime.toISOString(),
      source
    };
  } catch (error) {
    if (isNotFound(error) || error instanceof StorageError) return null;
    throw error;
  }
}

async function resolveRegularRecoveryFile(filePath: string): Promise<string> {
  const info = await lstat(filePath);
  if (info.isSymbolicLink()) {
    throw new StorageError(
      `恢复文件不能是符号链接：${path.basename(filePath)}`,
      "WORKSPACE_ENTRY_SYMLINK",
      403
    );
  }
  if (!info.isFile()) {
    throw new StorageError(
      `恢复文件不是普通文件：${path.basename(filePath)}`,
      "WORKSPACE_ENTRY_INVALID"
    );
  }
  return filePath;
}
