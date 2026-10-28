import path from "node:path";
import type {
  AgentTagCounts,
  AgentTagField,
  AgentTagJournal,
  AgentTagManifest,
  AgentTagSummary,
  AgentTagUndoSummary
} from "../shared/agent-tags.js";
import { commitBank, withCurrentBank } from "./agent-bank-write.js";
import {
  buildTagJournal,
  planTagChanges,
  planTagRestore
} from "./agent-tag-plan.js";
import { broadcastBankChanged } from "./events.js";
import { StorageError } from "./storage-types.js";

const TAG_TARGET_MISMATCH = "考点/题型整理的目标不是当前题库，请先切换工作区。";

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
  return withCurrentBank(input, TAG_TARGET_MISMATCH, async (context) => {
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
  return withCurrentBank(input, TAG_TARGET_MISMATCH, async (context) => {
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
