import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ApiRequestError, confirmSaveBankAs, fetchBank, fetchBankHead, saveBankAs } from "../api/client.js";
import type { AppInfo, Bank, BankSnapshot } from "../../shared/types.js";
import type { AppView } from "./useAppView.js";
import type { Notice, SaveIssue } from "./controllerTypes.js";
import { pickWorkspaceDirectory } from "./useWorkspaceActions.js";

interface SaveConflictOptions {
  appInfo: AppInfo | null;
  bank: Bank | null;
  activeView: AppView;
  saveIssue: SaveIssue | null;
  applyBankSnapshot: (info: AppInfo, snapshot: BankSnapshot, view: AppView) => void;
  refreshConflict: () => Promise<void>;
  overwriteConflict: (bank: Bank, revision: string) => Promise<void>;
  hasPendingUploads: () => boolean;
  setNotice: (notice: Notice | null) => void;
  beginDraftCommit: () => void;
  takeDraftCommitRejection: () => string | null;
}

export function useSaveConflictActions({
  appInfo, bank, activeView, saveIssue, applyBankSnapshot, refreshConflict,
  overwriteConflict, hasPendingUploads, setNotice, beginDraftCommit, takeDraftCommitRejection
}: SaveConflictOptions) {
  const bankRef = useRef(bank);
  bankRef.current = bank;
  const [isSavingConflictAs, setIsSavingConflictAs] = useState(false);
  const [isSaveAsUncertain, setIsSaveAsUncertain] = useState(false);
  const uncertainSaveAsRef = useRef(false);
  const [isConflictDialogOpen, setIsConflictDialogOpen] = useState(false);
  const conflictSavePromiseRef = useRef<Promise<void> | null>(null);
  const conflictSaveBusyRef = useRef(false);
  useEffect(() => {
    if (saveIssue?.kind === "conflict") setIsConflictDialogOpen(true);
  }, [saveIssue?.kind]);
  const useDiskVersion = useCallback(async () => {
    if (conflictSaveBusyRef.current || uncertainSaveAsRef.current) return;
    if (
      saveIssue?.kind !== "conflict" ||
      !appInfo?.currentWorkspacePath
    ) {
      return;
    }
    if (
      !window.confirm(
        "采用磁盘版本会放弃当前仍在内存中的全部修改。确定继续吗？"
      )
    ) {
      return;
    }
    try {
      const snapshot = await fetchBank();
      if (snapshot.workspacePath !== appInfo.currentWorkspacePath) {
        throw new Error("磁盘题库已切换到其他工作区。");
      }
      applyBankSnapshot(appInfo, snapshot, activeView);
      setIsConflictDialogOpen(false);
      setNotice({ type: "ok", text: "已采用最新磁盘版本。" });
    } catch (error) {
      await refreshConflict();
      setNotice({
        type: "error",
        text:
          error instanceof Error ? error.message : "读取磁盘版本失败。"
      });
    }
  }, [
    appInfo,
    activeView,
    applyBankSnapshot,
    refreshConflict,
    saveIssue?.kind,
    setNotice
  ]);
  const overwriteDiskVersion = useCallback(async () => {
    if (conflictSaveBusyRef.current || uncertainSaveAsRef.current) return;
    if (
      saveIssue?.kind !== "conflict" ||
      !bank ||
      !appInfo?.currentWorkspacePath
    ) {
      return;
    }
    if (
      !window.confirm(
        "这会用当前本地版本覆盖磁盘上的外部修改。确定继续吗？"
      )
    ) {
      return;
    }
    try {
      const head = await fetchBankHead();
      if (head.workspacePath !== appInfo.currentWorkspacePath) {
        throw new Error("磁盘题库已切换到其他工作区。");
      }
      await overwriteConflict(bank, head.revision);
      setIsConflictDialogOpen(false);
      setNotice({ type: "ok", text: "已用本地版本覆盖磁盘内容。" });
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error ? error.message : "覆盖磁盘版本失败。"
      });
    }
  }, [
    appInfo?.currentWorkspacePath,
    bank,
    overwriteConflict,
    saveIssue?.kind,
    setNotice
  ]);
  const saveConflictAs = useCallback(async () => {
    if (conflictSaveBusyRef.current || saveIssue?.kind !== "conflict" || !bankRef.current || !appInfo?.currentWorkspacePath) return;
    if (hasPendingUploads()) {
      setNotice({ type: "error", text: "图片仍在上传，请等待上传完成后另存。" });
      return;
    }
    beginDraftCommit();
    const active = document.activeElement;
    if (active instanceof HTMLElement) flushSync(() => active.blur());
    if (takeDraftCommitRejection()) return;
    conflictSaveBusyRef.current = true;
    setIsSavingConflictAs(true);
    const operation = (async () => {
      try {
        const targetWorkspacePath = uncertainSaveAsRef.current ? "" : await pickWorkspaceDirectory(
          "选择空文件夹另存当前题库", "输入一个空文件夹路径，用于另存当前题库"
        );
        if (!uncertainSaveAsRef.current && !targetWorkspacePath?.trim()) return;
        setIsSaveAsUncertain(false);
        const response = uncertainSaveAsRef.current ? await confirmSaveBankAs() : await saveBankAs({
          sourceWorkspacePath: appInfo.currentWorkspacePath,
          targetWorkspacePath: targetWorkspacePath!,
          bank: bankRef.current!
        });
        uncertainSaveAsRef.current = false;
        // 关闭等待者必须看到已切换的 bank 和 autosave 会话。
        flushSync(() => {
          applyBankSnapshot(response.appInfo, response.snapshot, activeView);
          setIsConflictDialogOpen(false);
        });
        setNotice({ type: "ok", text: `已另存为新题库：${response.appInfo.currentWorkspaceName}` });
      } catch (error) {
        uncertainSaveAsRef.current = error instanceof ApiRequestError && error.code === "WRITE_RESULT_UNKNOWN";
        setIsSaveAsUncertain(uncertainSaveAsRef.current);
        setNotice({ type: "error", text: error instanceof Error ? error.message : "另存当前题库失败。" });
      } finally {
        conflictSaveBusyRef.current = false;
        conflictSavePromiseRef.current = null;
        setIsSavingConflictAs(uncertainSaveAsRef.current);
      }
    })();
    conflictSavePromiseRef.current = operation;
    await operation;
  }, [appInfo, activeView, applyBankSnapshot, beginDraftCommit, hasPendingUploads, saveIssue?.kind, setNotice, takeDraftCommitRejection]);
  const waitForSaveAs = useCallback(async () => {
    await conflictSavePromiseRef.current;
    if (uncertainSaveAsRef.current) throw new Error("另存结果尚未确认，请先核对结果。");
  }, []);
  return {
    isSavingConflictAs, isSaveAsUncertain, isConflictDialogOpen, useDiskVersion, overwriteDiskVersion, saveConflictAs,
    waitForSaveAs,
    openConflictDialog: () => setIsConflictDialogOpen(true),
    closeConflictDialog: () => { if (!conflictSaveBusyRef.current && !uncertainSaveAsRef.current) setIsConflictDialogOpen(false); }
  };
}
