import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type {
  AgentImportManifest,
  AgentImportSummary
} from "../shared/agent-manifest.js";
import { parseV4Bank } from "../shared/bank-validation.js";
import type { Bank, ImportBatchRecord } from "../shared/types.js";
import { ValidationError } from "../shared/validation-primitives.js";
import {
  buildAssetPlan,
  collectUsedAssetKeys,
  mergeBatchRecord,
  planBank,
  type AssetPlan,
  type PlanResult
} from "./agent-import-plan.js";
import {
  prepareQuestionAsset,
  writePreparedAsset,
  type PreparedQuestionAsset,
  type UploadedFile
} from "./asset-service.js";
import {
  activateAgentWorkspace,
  assertAgentWorkspaceAvailable,
  buildAgentBank,
  resolveAgentWorkspacePath
} from "./agent-workspace-service.js";
import { createHistorySnapshot } from "./bank-storage.js";
import { broadcastBankChanged } from "./events.js";
import { writeJsonFileAtomic } from "./json-file.js";
import {
  parseStoredBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import {
  createWorkspaceWithBank,
  getWorkspaceDirs,
  readAppState
} from "./workspace-storage.js";

export interface AgentImportInput {
  workspacePath: string;
  manifest: AgentImportManifest;
  files: UploadedFile[];
  dryRun: boolean;
  overwrite: boolean;
  baseRevision?: string;
  createBank?: boolean;
  switchWorkspace?: boolean;
}

interface PreparedAssetInputs {
  preparedByKey: Map<string, PreparedQuestionAsset>;
  usedKeys: Set<string>;
}

export async function applyAgentImport(
  input: AgentImportInput
): Promise<AgentImportSummary> {
  validateCreateBankMode(input);
  const prepared = await prepareAssetInputs(input.manifest, input.files);
  return input.createBank
    ? applyCreateBankImport(input, prepared)
    : applyCurrentBankImport(input, prepared);
}

function validateCreateBankMode(input: AgentImportInput): void {
  if (input.createBank) {
    if (!input.manifest.bank) {
      throw new ValidationError("--create-bank 需要清单提供 bank.name。");
    }
    return;
  }
  if (input.manifest.bank || (input.manifest.chapters?.length ?? 0) > 0) {
    throw new ValidationError(
      "清单中的 bank/chapters 只能与 --create-bank 一起使用。"
    );
  }
}

async function prepareAssetInputs(
  manifest: AgentImportManifest,
  files: UploadedFile[]
): Promise<PreparedAssetInputs> {
  const usedKeys = collectUsedAssetKeys(manifest);
  if (files.length !== (manifest.assets?.length ?? 0)) {
    throw new ValidationError("上传的附件数量与清单 assets 数量不一致。");
  }
  const preparedAssets = await Promise.all(
    files.map((file) => prepareQuestionAsset(file))
  );
  const preparedByKey = new Map<string, PreparedQuestionAsset>();
  manifest.assets?.forEach((asset, index) => {
    const prepared = preparedAssets[index];
    if (prepared) preparedByKey.set(asset.key, prepared);
  });
  return { preparedByKey, usedKeys };
}

async function applyCurrentBankImport(
  input: AgentImportInput,
  prepared: PreparedAssetInputs
): Promise<AgentImportSummary> {
  const state = await readAppState();
  const workspacePath = state.currentWorkspacePath;
  if (!workspacePath) {
    throw new StorageError("还没有打开题库。", "WORKSPACE_NOT_SELECTED", 400);
  }
  if (
    !input.workspacePath ||
    path.resolve(workspacePath) !== path.resolve(input.workspacePath)
  ) {
    throw new StorageError(
      "Agent 导入目标不是当前题库，请先切换工作区。",
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
    return importIntoBank({
      dirs,
      workspacePath,
      current: parseStoredBank(raw),
      raw,
      currentRevision,
      input,
      prepared
    });
  });
}

async function applyCreateBankImport(
  input: AgentImportInput,
  prepared: PreparedAssetInputs
): Promise<AgentImportSummary> {
  const bankSpec = input.manifest.bank!;
  const workspacePath = resolveAgentWorkspacePath(bankSpec.name, bankSpec.path);
  const initialBank = await buildAgentBank({
    chapters: input.manifest.chapters?.map((chapter) => chapter.name),
    copySettingsFromCurrent: bankSpec.copySettingsFromCurrent !== false
  });
  const initialRaw = serializeJson(initialBank);
  const initialRevision = revisionForContent(initialRaw);
  const now = new Date().toISOString();
  const batchId = input.manifest.batch?.id ?? `import-${randomUUID()}`;
  const assetPlan = buildAssetPlan(
    initialBank,
    prepared.usedKeys,
    prepared.preparedByKey
  );
  const draft = planBank({
    current: initialBank,
    manifest: input.manifest,
    batchId,
    now,
    overwrite: input.overwrite,
    assetsByKey: assetPlan.assetsByKey
  });
  const summary = buildSummary({
    draft,
    input,
    batchId,
    existingBatch: undefined,
    revision: initialRevision,
    assetCount: assetPlan.toWrite.length,
    createdWorkspace: {
      path: workspacePath,
      switched: input.dryRun ? false : input.switchWorkspace === true
    }
  });
  if (input.dryRun) {
    await assertAgentWorkspaceAvailable(workspacePath);
    parseV4Bank({ ...draft.bank, imports: [] });
    return summary;
  }

  parseV4Bank({ ...draft.bank, imports: [] });
  await assertAgentWorkspaceAvailable(workspacePath);
  const committed = await withWorkspaceWriteLock(workspacePath, async () => {
    await assertAgentWorkspaceAvailable(workspacePath);
    const dirs = await createWorkspaceWithBank(workspacePath, initialBank);
    return commitImport({
      dirs,
      current: initialBank,
      raw: initialRaw,
      currentRevision: initialRevision,
      manifest: input.manifest,
      batchId,
      now,
      draft,
      assetPlan,
      existingBatch: undefined
    });
  });

  if (input.switchWorkspace) {
    await activateAgentWorkspace(workspacePath);
  }
  broadcastImport(workspacePath, committed.revision, batchId, summary);
  return { ...summary, revision: committed.revision };
}

async function importIntoBank(options: {
  dirs: WorkspaceDirs;
  workspacePath: string;
  current: Bank;
  raw: string;
  currentRevision: string;
  input: AgentImportInput;
  prepared: PreparedAssetInputs;
}): Promise<AgentImportSummary> {
  const {
    dirs,
    workspacePath,
    current,
    raw,
    currentRevision,
    input,
    prepared
  } = options;
  const now = new Date().toISOString();
  const batchId = input.manifest.batch?.id ?? `import-${randomUUID()}`;
  const existingBatch = current.imports.find(
    (batch) => batch.id === batchId
  );
  if (existingBatch?.status === "undone") {
    throw new ValidationError(
      `批次已撤销，请使用新的批次 ID：${batchId}`
    );
  }
  const assetPlan = buildAssetPlan(
    current,
    prepared.usedKeys,
    prepared.preparedByKey
  );
  const draft = planBank({
    current,
    manifest: input.manifest,
    batchId,
    now,
    overwrite: input.overwrite,
    assetsByKey: assetPlan.assetsByKey
  });
  const summary = buildSummary({
    draft,
    input,
    batchId,
    existingBatch,
    revision: currentRevision,
    assetCount: assetPlan.toWrite.length
  });
  if (input.dryRun) {
    parseV4Bank({ ...draft.bank, imports: current.imports });
    return summary;
  }

  const committed = await commitImport({
    dirs,
    current,
    raw,
    currentRevision,
    manifest: input.manifest,
    batchId,
    now,
    draft,
    assetPlan,
    existingBatch
  });
  broadcastImport(workspacePath, committed.revision, batchId, summary);
  return { ...summary, revision: committed.revision };
}

function buildSummary(options: {
  draft: PlanResult;
  input: AgentImportInput;
  batchId: string;
  existingBatch: ImportBatchRecord | undefined;
  revision: string;
  assetCount: number;
  createdWorkspace?: { path: string; switched: boolean };
}): AgentImportSummary {
  const { draft, input, batchId, existingBatch, revision } = options;
  return {
    status: draft.conflicts.length ? ("partial" as const) : ("completed" as const),
    dryRun: input.dryRun,
    batchId: input.dryRun ? (existingBatch?.id ?? null) : batchId,
    revision,
    counts: {
      created: draft.createdIds.length,
      updated: draft.updatedIds.length,
      skipped: 0,
      conflicts: draft.conflicts.length,
      assets: options.assetCount
    },
    conflicts: draft.conflicts,
    warnings: draft.warnings,
    chapterAssignments: draft.chapterAssignments,
    ...(options.createdWorkspace
      ? { createdWorkspace: options.createdWorkspace }
      : {})
  };
}

async function commitImport(options: {
  dirs: WorkspaceDirs;
  current: Bank;
  raw: string;
  currentRevision: string;
  manifest: AgentImportManifest;
  batchId: string;
  now: string;
  draft: PlanResult;
  assetPlan: AssetPlan;
  existingBatch: ImportBatchRecord | undefined;
}): Promise<{
  record: ImportBatchRecord;
  finalBank: Bank;
  revision: string;
}> {
  const {
    dirs,
    current,
    raw,
    currentRevision,
    manifest,
    batchId,
    now,
    draft,
    assetPlan,
    existingBatch
  } = options;
  const writtenPaths: string[] = [];
  try {
    for (const prepared of assetPlan.toWrite) {
      await writePreparedAsset(prepared, dirs.assetDir);
      writtenPaths.push(path.join(dirs.assetDir, prepared.asset.fileName));
    }
    const historySnapshot = existingBatch
      ? existingBatch.historySnapshot
      : await createHistorySnapshot(dirs, raw, currentRevision);
    const additions: ImportBatchRecord = {
      id: batchId,
      createdAt: now,
      note: manifest.batch?.note ?? null,
      bookTitles: [...draft.bookTitles],
      newCount: draft.createdIds.length,
      updatedCount: draft.updatedIds.length,
      skippedCount: 0,
      conflictCount: draft.conflicts.length,
      itemIds: [...draft.createdIds],
      updatedItemIds: [...draft.updatedIds],
      historySnapshot,
      status: draft.conflicts.length ? "partial" : "completed",
      undoneAt: null
    };
    const record = existingBatch
      ? mergeBatchRecord(existingBatch, additions)
      : additions;
    const imports = existingBatch
      ? current.imports.map((batch) =>
          batch.id === record.id ? record : batch
        )
      : [record, ...current.imports].slice(0, 50);
    const finalBank = parseV4Bank({ ...draft.bank, imports });
    await writeJsonFileAtomic(dirs.bankPath, finalBank);
    const revision = revisionForContent(serializeJson(finalBank));
    return { record, finalBank, revision };
  } catch (error) {
    await Promise.all(
      writtenPaths.map((filePath) => rm(filePath, { force: true }))
    );
    throw error;
  }
}

function broadcastImport(
  workspacePath: string,
  revision: string,
  batchId: string,
  summary: AgentImportSummary
): void {
  try {
    broadcastBankChanged({
      workspacePath,
      revision,
      source: "agent-import",
      batchId,
      counts: summary.counts
    });
  } catch {
    // A renderer event is best-effort; the import itself is already durable.
  }
}
