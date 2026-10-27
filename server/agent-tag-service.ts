import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentTagCounts,
  AgentTagField,
  AgentTagJournal,
  AgentTagManifest,
  AgentTagSummary,
  AgentTagUndoSummary
} from "../shared/agent-tags.js";
import { parseV4Bank } from "../shared/bank-validation.js";
import type { Bank } from "../shared/types.js";
import { createHistorySnapshot } from "./bank-storage.js";
import {
  buildTagJournal,
  planTagChanges,
  planTagRestore
} from "./agent-tag-plan.js";
import { broadcastBankChanged } from "./events.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import {
  parseStoredBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { getWorkspaceDirs, readAppState } from "./workspace-storage.js";

export interface AgentTagInput {
  workspacePath: string;
  manifest: AgentTagManifest;
  dryRun: boolean;
  baseRevision?: string;
}

export interface AgentTagUndoInput {
  workspacePath: string;
  journal: AgentTagJournal;
  dryRun: boolean;
  baseRevision?: string;
}

// 考点/题型整理只改清单指定的字段和 updatedAt，不改审阅状态，也不拍 .history/ 快照
// （快照只有 10 份，要留给用户的恢复点和导入批次）。撤销靠调用方保存的撤销记录。
// 唯一例外：磁盘上还是旧版本题库时，写回会顺带完成迁移，所以先留一份迁移前快照。
export async function applyAgentTags(
  input: AgentTagInput
): Promise<AgentTagSummary> {
  return withCurrentBank(input, async (context) => {
    const now = new Date().toISOString();
    const plan = planTagChanges({
      current: context.current,
      manifest: input.manifest,
      now
    });
    const summary: AgentTagSummary = {
      field: input.manifest.field,
      dryRun: input.dryRun,
      revision: context.revision,
      counts: plan.counts,
      changes: plan.changes,
      warnings: plan.warnings
    };
    if (input.dryRun || plan.changes.length === 0) return summary;

    const revision = await commitBank(context, plan.bank);
    broadcastTagChange(context.workspacePath, revision, input.manifest.field, plan.counts);
    return {
      ...summary,
      revision,
      journal: buildTagJournal({
        field: input.manifest.field,
        workspacePath: context.workspacePath,
        note: input.manifest.note,
        now,
        changes: plan.changes
      })
    };
  });
}

export async function undoAgentTags(
  input: AgentTagUndoInput
): Promise<AgentTagUndoSummary> {
  return withCurrentBank(input, async (context) => {
    if (
      path.resolve(input.journal.workspacePath) !==
      path.resolve(context.workspacePath)
    ) {
      throw new StorageError(
        "这份撤销记录属于另一个题库。",
        "WORKSPACE_CHANGED",
        409
      );
    }
    const plan = planTagRestore({
      current: context.current,
      journal: input.journal,
      now: new Date().toISOString()
    });
    const summary: AgentTagUndoSummary = {
      field: input.journal.field,
      dryRun: input.dryRun,
      revision: context.revision,
      counts: {
        restored: plan.restored.length,
        unchanged: plan.unchanged,
        conflicts: plan.conflicts.length
      },
      restored: plan.restored,
      conflicts: plan.conflicts
    };
    if (input.dryRun || plan.restored.length === 0) return summary;

    const revision = await commitBank(context, plan.bank);
    broadcastTagChange(context.workspacePath, revision, input.journal.field, {
      changed: plan.restored.length,
      unchanged: plan.unchanged,
      added: 0,
      removed: 0
    });
    return { ...summary, revision };
  });
}

interface CurrentBankContext {
  workspacePath: string;
  dirs: WorkspaceDirs;
  current: Bank;
  raw: string;
  revision: string;
}

async function withCurrentBank<T>(
  input: { workspacePath: string; baseRevision?: string },
  operation: (context: CurrentBankContext) => Promise<T>
): Promise<T> {
  const state = await readAppState();
  const workspacePath = state.currentWorkspacePath;
  if (!workspacePath) {
    throw new StorageError("还没有打开题库。", "WORKSPACE_NOT_SELECTED", 400);
  }
  if (path.resolve(workspacePath) !== path.resolve(input.workspacePath)) {
    throw new StorageError(
      "考点/题型整理的目标不是当前题库，请先切换工作区。",
      "WORKSPACE_CHANGED",
      409
    );
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

async function commitBank(
  context: CurrentBankContext,
  bank: Bank
): Promise<string> {
  const finalBank = parseV4Bank(bank);
  if (storedVersion(context.raw) !== finalBank.version) {
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

function broadcastTagChange(
  workspacePath: string,
  revision: string,
  field: AgentTagField,
  tagCounts: AgentTagCounts
): void {
  try {
    broadcastBankChanged({
      workspacePath,
      revision,
      source: "agent-tags",
      field,
      tagCounts
    });
  } catch {
    // A renderer event is best-effort; the write itself is already durable.
  }
}
