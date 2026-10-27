import { useEffect, useRef } from "react";
import type { AgentImportCounts } from "../../shared/agent-manifest.js";
import {
  AGENT_TAG_FIELD_LABELS,
  type AgentTagCounts,
  type AgentTagField
} from "../../shared/agent-tags.js";
import type { AgentUndoCounts } from "../../shared/agent-undo.js";
import type { BankSnapshot } from "../../shared/types.js";
import { fetchBank } from "../api/client.js";
import type {
  ExternalBankNotice,
  Notice,
  SaveState
} from "./controllerTypes.js";

interface ExternalBankSyncOptions {
  enabled: boolean;
  workspacePath: string;
  saveState: SaveState;
  hasSaveIssue: boolean;
  hasPendingUploads: boolean;
  isWorkspaceChanging: boolean;
  applySnapshot: (snapshot: BankSnapshot) => void;
  showNotice: (notice: Notice) => void;
  setExternalBankNotice: (notice: ExternalBankNotice | null) => void;
}

interface BankChangedEvent {
  workspacePath: string;
  revision: string;
  source?: "agent-import" | "agent-undo" | "agent-tags";
  counts?: AgentImportCounts;
  undoCounts?: AgentUndoCounts;
  field?: AgentTagField;
  tagCounts?: AgentTagCounts;
}

export function useExternalBankSync(options: ExternalBankSyncOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (
      !options.enabled ||
      !options.workspacePath ||
      typeof EventSource === "undefined"
    ) {
      return;
    }
    const source = new EventSource("/api/events");
    let applying = false;

    const handler = (event: MessageEvent<string>) => {
      let payload: BankChangedEvent;
      try {
        payload = JSON.parse(event.data) as BankChangedEvent;
      } catch {
        return;
      }
      const current = latest.current;
      if (payload.workspacePath !== current.workspacePath) return;
      if (hasLocalWork(current)) {
        current.setExternalBankNotice(externalBankNotice(payload));
        return;
      }
      if (applying) return;
      applying = true;
      void fetchBank()
        .then((snapshot) => {
          if (snapshot.workspacePath !== latest.current.workspacePath) return;
          latest.current.applySnapshot(snapshot);
          latest.current.setExternalBankNotice(null);
          latest.current.showNotice({
            type: "ok",
            text: externalUpdateText(payload)
          });
        })
        .catch((error) => {
          latest.current.setExternalBankNotice(externalBankNotice(payload));
          latest.current.showNotice({
            type: "error",
            text:
              error instanceof Error
                ? error.message
                : "读取外部题库更新失败。"
          });
        })
        .finally(() => {
          applying = false;
        });
    };

    source.addEventListener(
      "bank-changed",
      handler as EventListener
    );
    return () => {
      source.removeEventListener(
        "bank-changed",
        handler as EventListener
      );
      source.close();
    };
  }, [options.enabled, options.workspacePath]);
}

function externalBankNotice(payload: BankChangedEvent): ExternalBankNotice {
  return {
    revision: payload.revision,
    counts: payload.counts,
    ...(payload.tagCounts && payload.field
      ? { labelsChanged: { field: payload.field, count: payload.tagCounts.changed } }
      : {})
  };
}

function externalUpdateText(payload: BankChangedEvent): string {
  if (payload.source === "agent-undo" && payload.undoCounts) {
    return payload.undoCounts.deleted
      ? `已撤销导入批次：删除 ${payload.undoCounts.deleted} 道，恢复 ${payload.undoCounts.restored} 道。`
      : `已撤销导入批次：恢复 ${payload.undoCounts.restored} 道。`;
  }
  if (payload.source === "agent-tags" && payload.tagCounts && payload.field) {
    return `已更新 ${payload.tagCounts.changed} 道题的${AGENT_TAG_FIELD_LABELS[payload.field]}。`;
  }
  if (payload.counts?.created) return `已导入 ${payload.counts.created} 道题。`;
  if (payload.counts?.updated) return `已更新 ${payload.counts.updated} 道题。`;
  return "题库已在外部更新。";
}

function hasLocalWork(options: ExternalBankSyncOptions): boolean {
  if (
    options.isWorkspaceChanging ||
    options.hasSaveIssue ||
    options.hasPendingUploads
  ) {
    return true;
  }
  if (
    options.saveState === "saving" ||
    options.saveState === "error" ||
    options.saveState === "conflict"
  ) {
    return true;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active.isContentEditable
  ) {
    return true;
  }
  return active.closest(".cm-editor") !== null;
}
