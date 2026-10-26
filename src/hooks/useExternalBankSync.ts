import { useEffect, useRef } from "react";
import type { AgentImportCounts } from "../../shared/agent-manifest.js";
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
  source?: "agent-import" | "agent-undo";
  counts?: AgentImportCounts;
  undoCounts?: AgentUndoCounts;
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
        current.setExternalBankNotice({
          revision: payload.revision,
          counts: payload.counts
        });
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
            text:
              payload.source === "agent-undo" && payload.undoCounts
                ? payload.undoCounts.deleted
                  ? `已撤销导入批次：删除 ${payload.undoCounts.deleted} 道，恢复 ${payload.undoCounts.restored} 道。`
                  : `已撤销导入批次：恢复 ${payload.undoCounts.restored} 道。`
                : payload.counts
                  ? payload.counts.created
                    ? `已导入 ${payload.counts.created} 道题。`
                    : payload.counts.updated
                      ? `已更新 ${payload.counts.updated} 道题。`
                      : "题库已在外部更新。"
                  : "题库已在外部更新。"
          });
        })
        .catch((error) => {
          latest.current.setExternalBankNotice({
            revision: payload.revision,
            counts: payload.counts
          });
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
