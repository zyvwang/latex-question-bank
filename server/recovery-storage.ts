import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BankSnapshot, RecoveryCandidate } from "../shared/types.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import {
  isNotFound,
  parseStoredBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { getCurrentWorkspaceDirs } from "./workspace-storage.js";

export async function listRecoveryCandidates(): Promise<RecoveryCandidate[]> {
  return listRecoveryCandidatesForDirs(await getCurrentWorkspaceDirs());
}

async function listRecoveryCandidatesForDirs(dirs: WorkspaceDirs): Promise<RecoveryCandidate[]> {
  const candidates: RecoveryCandidate[] = [];
  const backup = await recoveryCandidateFromFile(
    "bank.json.bak",
    `${dirs.bankPath}.bak`,
    "backup"
  );
  if (backup) candidates.push(backup);

  try {
    const files = (await readdir(dirs.historyDir))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse();
    for (const file of files.slice(0, 10)) {
      const candidate = await recoveryCandidateFromFile(
        file,
        path.join(dirs.historyDir, file),
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
    const candidatePath =
      candidateId === "bank.json.bak"
        ? `${dirs.bankPath}.bak`
        : path.join(dirs.historyDir, candidateId);
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
  filePath: string,
  source: RecoveryCandidate["source"]
): Promise<RecoveryCandidate | null> {
  try {
    parseStoredBank(await readFile(filePath, "utf8"));
    const metadata = await stat(filePath);
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
