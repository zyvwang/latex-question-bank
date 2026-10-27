import { lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  isAgentBatchId,
  type AgentUndoCounts,
  type AgentUndoSummary
} from "../shared/agent-undo.js";
import { parseV4Bank } from "../shared/bank-validation.js";
import type {
  Bank,
  ImportBatchRecord,
  QuestionItem
} from "../shared/types.js";
import { ValidationError } from "../shared/validation-primitives.js";
import { broadcastBankChanged } from "./events.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError } from "./storage-types.js";
import {
  isNotFound,
  parseStoredBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { resolveRealWorkspaceFile } from "./workspace-paths.js";
import { getWorkspaceDirs, readAppState } from "./workspace-storage.js";

export interface AgentUndoInput {
  workspacePath?: string;
  batchId: string;
  baseRevision?: string;
}

export async function undoAgentImport(
  input: AgentUndoInput
): Promise<AgentUndoSummary> {
  if (!isAgentBatchId(input.batchId)) {
    throw new StorageError("批次 ID 无效。", "UNDO_BATCH_ID_INVALID", 400);
  }
  const state = await readAppState();
  const workspacePath = state.currentWorkspacePath;
  if (!workspacePath) {
    throw new StorageError("还没有打开题库。", "WORKSPACE_NOT_SELECTED", 400);
  }
  if (
    input.workspacePath &&
    path.resolve(input.workspacePath) !== path.resolve(workspacePath)
  ) {
    throw new StorageError(
      "撤销目标不是当前题库，请先切换工作区。",
      "WORKSPACE_CHANGED",
      409
    );
  }

  return withWorkspaceWriteLock(workspacePath, async () => {
    const dirs = getWorkspaceDirs(workspacePath);
    const raw = await readFile(dirs.bankPath, "utf8");
    const currentRevision = revisionForContent(raw);
    if (input.baseRevision && input.baseRevision !== currentRevision) {
      throw new StorageError(
        "题库在 Agent 读取后被其他程序修改，请重试。",
        "BANK_CONFLICT",
        409
      );
    }
    const bank = parseStoredBank(raw);
    const batch = bank.imports.find(
      (candidate) => candidate.id === input.batchId
    );
    if (!batch) {
      throw new StorageError(
        "找不到该导入批次。",
        "UNDO_BATCH_NOT_FOUND",
        404
      );
    }
    if (batch.status === "undone") {
      throw new StorageError(
        "该批次已经撤销。",
        "UNDO_BATCH_ALREADY_UNDONE",
        409
      );
    }
    if (!batch.historySnapshot) {
      throw new StorageError(
        "该批次缺少可用的 .history/ 快照。",
        "UNDO_SNAPSHOT_MISSING",
        409
      );
    }
    const snapshot = await readUndoSnapshot(
      dirs.historyDir,
      batch.historySnapshot
    );
    const now = new Date().toISOString();
    const outcome = buildUndoBank(bank, snapshot, batch, now);
    const finalBank = validateUndoBank(outcome.bank);
    await writeJsonFileAtomic(dirs.bankPath, finalBank);
    const revision = revisionForContent(serializeJson(finalBank));
    const assetsRemoved = await removeUnreferencedAssets(
      dirs.assetDir,
      outcome.affectedAssetNames,
      finalBank
    );
    const counts: AgentUndoCounts = {
      deleted: outcome.deleted,
      restored: outcome.restored,
      kept: outcome.kept,
      assetsRemoved
    };
    try {
      broadcastBankChanged({
        workspacePath,
        revision,
        source: "agent-undo",
        batchId: batch.id,
        counts: {
          created: 0,
          updated: 0,
          skipped: 0,
          conflicts: 0,
          assets: assetsRemoved
        },
        undoCounts: counts
      });
    } catch {
      // A renderer event is best-effort; the undo itself is already durable.
    }
    return {
      batchId: batch.id,
      status: "undone" as const,
      revision,
      counts
    };
  });
}

interface UndoOutcome {
  bank: Bank;
  deleted: number;
  restored: number;
  kept: number;
  affectedAssetNames: Set<string>;
}

function buildUndoBank(
  bank: Bank,
  snapshot: Bank,
  batch: ImportBatchRecord,
  now: string
): UndoOutcome {
  const snapshotById = new Map(snapshot.items.map((item) => [item.id, item]));
  const recordedIds = new Set([...batch.itemIds, ...batch.updatedItemIds]);
  const createdIds = new Set(batch.itemIds);
  const items: QuestionItem[] = [];
  const affectedAssetNames = new Set<string>();
  let deleted = 0;
  let restored = 0;
  let kept = 0;

  for (const item of bank.items) {
    const belongsToBatch =
      item.importBatchId === batch.id && recordedIds.has(item.id);
    if (!belongsToBatch) {
      items.push(item);
      continue;
    }
    const untouched =
      item.reviewStatus === "pending" && item.updatedAt === item.importedAt;
    if (!untouched) {
      kept += 1;
      items.push(item);
      continue;
    }
    const snapshotItem = snapshotById.get(item.id);
    if (createdIds.has(item.id) || !snapshotItem) {
      deleted += 1;
      collectAssetNames(item, affectedAssetNames);
      continue;
    }
    restored += 1;
    collectAssetNames(item, affectedAssetNames);
    items.push(cloneItem(snapshotItem));
  }

  return {
    bank: {
      ...bank,
      items,
      imports: bank.imports.map((candidate) =>
        candidate.id === batch.id
          ? { ...candidate, status: "undone", undoneAt: now }
          : candidate
      )
    },
    deleted,
    restored,
    kept,
    affectedAssetNames
  };
}

function validateUndoBank(bank: Bank): Bank {
  try {
    return parseV4Bank(bank);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new StorageError(
        `撤销会导致题库数据冲突：${error.message}`,
        "UNDO_CONFLICT",
        409
      );
    }
    throw error;
  }
}

async function readUndoSnapshot(
  historyDir: string,
  fileName: string
): Promise<Bank> {
  let filePath: string;
  try {
    filePath = await resolveRealWorkspaceFile(historyDir, fileName);
  } catch (error) {
    if (isNotFound(error)) throw snapshotMissing();
    throw error;
  }
  try {
    return parseStoredBank(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isNotFound(error)) throw snapshotMissing();
    if (error instanceof ValidationError) {
      throw new StorageError(
        "该批次的 .history/ 快照已损坏。",
        "UNDO_SNAPSHOT_INVALID",
        409
      );
    }
    throw error;
  }
}

function snapshotMissing(): StorageError {
  return new StorageError(
    "该批次的 .history/ 快照已被清理，无法撤销。",
    "UNDO_SNAPSHOT_MISSING",
    409
  );
}

async function removeUnreferencedAssets(
  assetDir: string,
  candidates: Set<string>,
  finalBank: Bank
): Promise<number> {
  if (candidates.size === 0) return 0;
  const referenced = new Set(
    finalBank.items.flatMap((item) =>
      item.assets.map((asset) => asset.fileName)
    )
  );
  let removed = 0;
  for (const fileName of candidates) {
    if (referenced.has(fileName)) continue;
    try {
      const filePath = await resolveRealWorkspaceFile(assetDir, fileName, {
        allowMissing: true
      });
      await lstat(filePath);
      await rm(filePath, { force: true });
      removed += 1;
    } catch (error) {
      if (isNotFound(error)) continue;
      console.warn(`清理批次附件失败：${fileName}`, error);
    }
  }
  return removed;
}

function collectAssetNames(
  item: QuestionItem,
  target: Set<string>
): void {
  for (const asset of item.assets) target.add(asset.fileName);
}

function cloneItem(item: QuestionItem): QuestionItem {
  return {
    ...item,
    source: item.source ? { ...item.source } : null,
    topics: [...item.topics],
    questionTypes: [...item.questionTypes],
    assets: item.assets.map((asset) => ({ ...asset })),
    modules: {
      question: { ...item.modules.question },
      solution: { ...item.modules.solution },
      note: { ...item.modules.note }
    }
  };
}
