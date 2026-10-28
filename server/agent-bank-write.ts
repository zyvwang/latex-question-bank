import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseV4Bank } from "../shared/bank-validation.js";
import type { Bank } from "../shared/types.js";
import { createHistorySnapshot } from "./bank-storage.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import {
  parseStoredBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { getWorkspaceDirs, readAppState } from "./workspace-storage.js";

export interface CurrentBankContext {
  workspacePath: string;
  dirs: WorkspaceDirs;
  current: Bank;
  raw: string;
  revision: string;
}

// Agent 批量改写共用的入口：只允许改当前打开的题库，在 workspace 写锁内读盘并校验 revision。
export async function withCurrentBank<T>(
  input: { workspacePath: string; baseRevision?: string },
  targetMismatchMessage: string,
  operation: (context: CurrentBankContext) => Promise<T>
): Promise<T> {
  const state = await readAppState();
  const workspacePath = state.currentWorkspacePath;
  if (!workspacePath) {
    throw new StorageError("还没有打开题库。", "WORKSPACE_NOT_SELECTED", 400);
  }
  if (path.resolve(workspacePath) !== path.resolve(input.workspacePath)) {
    throw new StorageError(targetMismatchMessage, "WORKSPACE_CHANGED", 409);
  }
  return withWorkspaceWriteLock(workspacePath, async () => {
    const dirs = getWorkspaceDirs(workspacePath);
    const raw = await readFile(dirs.bankPath, "utf8");
    const revision = revisionForContent(raw);
    if (input.baseRevision && input.baseRevision !== revision) {
      throw new StorageError(
        "题库在 Agent 读取后被其他程序修改，请重试。",
        "BANK_CONFLICT",
        409
      );
    }
    return operation({
      workspacePath,
      dirs,
      current: parseStoredBank(raw),
      raw,
      revision
    });
  });
}

/**
 * Validates and atomically writes the bank. A pre-write `.history/` snapshot
 * is taken when requested, or when the write upgrades an older stored schema.
 */
export async function commitBank(
  context: CurrentBankContext,
  bank: Bank,
  options: { snapshot?: boolean } = {}
): Promise<string> {
  const finalBank = parseV4Bank(bank);
  if (options.snapshot || storedVersion(context.raw) !== finalBank.version) {
    await createHistorySnapshot(context.dirs, context.raw, context.revision);
  }
  await writeJsonFileAtomic(context.dirs.bankPath, finalBank);
  return revisionForContent(serializeJson(finalBank));
}

function storedVersion(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null && "version" in parsed
    ? parsed.version
    : undefined;
}
