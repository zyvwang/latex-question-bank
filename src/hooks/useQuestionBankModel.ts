import { useLatestCallback } from "./useLatestCallback.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAppInfo,
  fetchBank,
  fetchRecoveryCandidates,
  recoverBank
} from "../api/client.js";
import type {
  AppInfo,
  Bank,
  BankSnapshot,
  ModuleKind,
  QuestionItem,
  WorkspaceTransitionResponse
} from "../../shared/types.js";
import {
  findSourceNumberConflict,
  itemsInChapter,
  normalizeChapterItemOrders,
  sourceNumberConflictGroups
} from "../../shared/chapter-order.js";
import type { QuestionBankContextValues } from "../context/questionBankContextTypes.js";
import { useAutosave } from "./useAutosave.js";
import { useAppView, type AppView } from "./useAppView.js";
import { useBankSettingsActions } from "./useBankSettingsActions.js";
import { useCompileExportActions } from "./useCompileExportActions.js";
import { useQuestionDerivedData } from "./useQuestionDerivedData.js";
import { useQuestionBankContextValues } from "./useQuestionBankContextValues.js";
import { useQuestionReorder } from "./useQuestionReorder.js";
import { useReviewHistory } from "./useReviewHistory.js";
import { useSelectionFilters } from "./useSelectionFilters.js";
import { useWorkspaceActions } from "./useWorkspaceActions.js";
import { useSaveConflictActions } from "./useSaveConflictActions.js";
import { usePendingChanges } from "./usePendingChanges.js";

export function useQuestionBankModel(): QuestionBankContextValues {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const workspaceChangingRef = useRef(false);
  const isWorkspaceChanging = useCallback(() => workspaceChangingRef.current, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const pending = usePendingChanges();
  const { notice, setNotice, beginDraftCommit, takeDraftCommitRejection } = pending;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recoveryCandidates, setRecoveryCandidates] = useState<
    QuestionBankContextValues["lifecycle"]["recoveryCandidates"]
  >([]);
  const [activeModule, setActiveModule] = useState<ModuleKind>("question");
  const appView = useAppView();
  const {
    resetAppView,
    setActiveView,
    setHeatmapFocusedId
  } = appView;
  const selection = useSelectionFilters(bank);
  const filters = useMemo(
    () => ({
      chapterFilters: selection.chapterFilters,
      tagFilters: selection.tagFilters,
      masteryFilters: selection.masteryFilters,
      errorReasonFilters: selection.errorReasonFilters,
      search: selection.search
    }),
    [
      selection.chapterFilters,
      selection.errorReasonFilters,
      selection.masteryFilters,
      selection.search,
      selection.tagFilters
    ]
  );
  const derived = useQuestionDerivedData(
    bank,
    activeId,
    filters,
    selection.selectedIds,
    selection.listMode
  );
  const autosave = useAutosave(bank, setNotice);
  const {
    overwriteConflict,
    persistBank,
    refreshConflict,
    resetAutosave,
    retrySave,
    saveIssue,
    saveState
  } = autosave;
  const updateBank = useCallback((updater: (current: Bank) => Bank) => {
    setBank((current) => (current ? updater(current) : current));
  }, []);
  const reviewHistory = useReviewHistory({
    bank,
    workspaceName: appInfo?.currentWorkspaceName ?? "题库",
    workspaceKey: appInfo?.currentWorkspacePath ?? "",
    updateBank,
    setNotice
  });
  const { applyReviewMutation, resetHistoryUi } = reviewHistory;
  const updateItem = useCallback(
    (id: string, patch: Partial<QuestionItem>) => {
      const updater = (current: Bank): Bank => ({
        ...current,
        items: current.items.map((item) =>
          item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
        )
      });
      if (
        Object.hasOwn(patch, "masteryOptionId") ||
        Object.hasOwn(patch, "errorReasonOptionIds")
      ) {
        applyReviewMutation(updater);
      } else {
        updateBank(updater);
      }
    },
    [applyReviewMutation, updateBank]
  );
  const commitSourceNumber = useCallback((id: string, sourceNumber: string) => {
    if (!bank) return false;
    const item = bank.items.find((candidate) => candidate.id === id);
    if (!item) return false;
    const conflict = findSourceNumberConflict(
      bank.items,
      id,
      item.chapterId,
      sourceNumber
    );
    if (conflict) {
      setActiveId(conflict.id);
      setNotice({
        type: "error",
        text: `原编号“${sourceNumber.trim()}”在当前章节中已被使用，已定位到冲突题目。`
      });
      return false;
    }
    updateItem(id, { sourceNumber: sourceNumber.trim() });
    return true;
  }, [bank, setNotice, updateItem]);

  const moveItemToChapter = useCallback((id: string, chapterId: string | null) => {
    if (!bank) return false;
    const item = bank.items.find((candidate) => candidate.id === id);
    if (!item || item.chapterId === chapterId) return Boolean(item);
    const conflict = findSourceNumberConflict(
      bank.items,
      id,
      chapterId,
      item.sourceNumber
    );
    if (conflict) {
      setActiveId(conflict.id);
      setNotice({
        type: "error",
        text: "移动后会造成原编号冲突，已定位到目标章节中的冲突题目。"
      });
      return false;
    }
    const nextOrder = itemsInChapter(bank.items, chapterId).length + 1;
    const now = new Date().toISOString();
    updateBank((current) => ({
      ...current,
      items: normalizeChapterItemOrders(
        current.items.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                chapterId,
                chapterOrder: nextOrder,
                updatedAt: now
              }
            : candidate
        ),
        now
      )
    }));
    setNotice({ type: "ok", text: "题目已移动到目标章节末尾。" });
    return true;
  }, [bank, setNotice, updateBank]);

  const compileExport = useCompileExportActions({
    activeItem: derived.activeItem,
    bank,
    workspacePath: appInfo?.currentWorkspacePath ?? "",
    selectedIds: selection.selectedIds,
    captureSaveSession: autosave.captureSaveSession,
    isSaveSessionCurrent: autosave.isSaveSessionCurrent,
    flushSession: autosave.flushSession,
    setNotice,
    updateBank,
    isWorkspaceChanging
  });
  const { clearFilters, selectAllItems } = selection;
  const { resetCompileState } = compileExport;

  const applyBankSnapshot = useCallback(
    (
      nextAppInfo: AppInfo,
      snapshot: BankSnapshot,
      nextActiveView: AppView = "editor"
    ) => {
      resetAutosave(snapshot);
      setAppInfo(nextAppInfo);
      setBank(snapshot.bank);
      setActiveId(snapshot.bank.items[0]?.id ?? null);
      selectAllItems(snapshot.bank.items);
      clearFilters();
      resetCompileState();
      setLoadError(null);
      setRecoveryCandidates([]);
      setActiveModule("question");
      resetAppView(nextActiveView);
      resetHistoryUi();
      setNotice(null);
      const conflicts = sourceNumberConflictGroups(snapshot.bank.items);
      if (conflicts.length > 0) {
        setNotice({
          type: "info",
          text: `检测到 ${conflicts.length} 组旧原编号冲突；可继续编辑其他内容，新操作不会新增冲突。`
        });
      }
    },
    [
      clearFilters,
      resetAppView,
      resetAutosave,
      resetCompileState,
      resetHistoryUi,
      selectAllItems,
      setNotice
    ]
  );
  const applySetupState = useCallback(
    (nextAppInfo: AppInfo) => {
      resetAutosave(null);
      setAppInfo(nextAppInfo);
      setBank(null);
      setActiveId(null);
      selectAllItems([]);
      clearFilters();
      resetCompileState();
      setLoadError(null);
      setRecoveryCandidates([]);
      setActiveModule("question");
      resetAppView("editor");
      resetHistoryUi();
      setNotice(null);
    },
    [
      clearFilters,
      resetAppView,
      resetAutosave,
      resetCompileState,
      resetHistoryUi,
      selectAllItems,
      setNotice
    ]
  );
  const applyWorkspaceTransition = useCallback(
    (response: WorkspaceTransitionResponse) => {
      if (response.appInfo.setupRequired) {
        applySetupState(response.appInfo);
        return;
      }
      if (!response.snapshot) {
        if (
          response.appInfo.currentWorkspacePath ===
          appInfo?.currentWorkspacePath
        ) {
          setAppInfo(response.appInfo);
          return;
        }
        throw new Error("工作区响应缺少题库快照，请重试。");
      }
      const nextActiveView =
        appView.activeView === "settings" ? "settings" : "editor";
      applyBankSnapshot(response.appInfo, response.snapshot, nextActiveView);
    },
    [
      appInfo?.currentWorkspacePath,
      appView.activeView,
      applyBankSnapshot,
      applySetupState
    ]
  );

  const workspace = useWorkspaceActions({
    appInfo,
    persistCurrentBank: async () => {
      const session = autosave.captureSaveSession();
      if (session.workspacePath) await autosave.flushSession(session);
    },
    hasPendingUploads: compileExport.hasPendingUploads,
    changingRef: workspaceChangingRef,
    applyWorkspaceTransition,
    setAppInfo,
    setNotice
  });
  const { flushPendingSettings, runWorkspaceChange } = workspace;
  const bankSettings = useBankSettingsActions({
    bank,
    updateBank,
    updateReviewBank: applyReviewMutation,
    setNotice
  });
  const reorder = useQuestionReorder({
    bank,
    activeItem: derived.activeItem,
    numberById: derived.numberById,
    orderedItems: derived.orderedItems,
    setActiveId,
    setNotice,
    setSelectedIds: selection.setSelectedIds,
    updateBank,
    clearFilters,
    workspacePath: appInfo?.currentWorkspacePath ?? ""
  });

  const initialLoadBusyRef = useRef(false);
  const loadAppAndBank = useCallback(() => runWorkspaceChange(async () => {
    if (initialLoadBusyRef.current) return;
    initialLoadBusyRef.current = true;
    setLoadError(null);
    setNotice(null);
    setRecoveryCandidates([]);
    let nextAppInfo: AppInfo | null = null;
    try {
      nextAppInfo = await fetchAppInfo();
      if (nextAppInfo.setupRequired) {
        applySetupState(nextAppInfo);
        return;
      }
      setAppInfo(nextAppInfo);
      applyBankSnapshot(nextAppInfo, await fetchBank());
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取题库失败。";
      setLoadError(message);
      setNotice({ type: "error", text: message });
      if (nextAppInfo && !nextAppInfo.setupRequired) {
        setRecoveryCandidates(await fetchRecoveryCandidates().catch(() => []));
      }
    } finally {
      initialLoadBusyRef.current = false;
    }
  }), [applyBankSnapshot, applySetupState, setNotice, runWorkspaceChange]);

  useEffect(() => { void loadAppAndBank(); }, [loadAppAndBank]);

  const recoverFromCandidate = useCallback(
    (candidateId: string) => runWorkspaceChange(async () => {
      if (!appInfo?.currentWorkspacePath) return;
      const session = autosave.captureSaveSession();
      const workspacePath = appInfo.currentWorkspacePath;
      setNotice({ type: "info", text: "正在恢复题库，请稍候。" });
      const snapshot = await recoverBank(candidateId, workspacePath);
      if (!autosave.isSaveSessionCurrent(session) || snapshot.workspacePath !== workspacePath) {
        throw new Error("恢复响应已过期，请重新读取当前工作区。");
      }
      applyBankSnapshot(appInfo, snapshot);
      setNotice({ type: "ok", text: "题库已从备份恢复。" });
    }),
    [appInfo, autosave, applyBankSnapshot, runWorkspaceChange, setNotice]
  );
  const flushCurrentChanges = useLatestCallback(async () => {
    await Promise.all([
      bank && appInfo?.currentWorkspacePath
        ? persistBank(bank)
        : Promise.resolve(),
      flushPendingSettings()
    ]);
  });
  const conflicts = useSaveConflictActions({
    appInfo, bank, activeView: appView.activeView, saveIssue, applyBankSnapshot,
    refreshConflict, overwriteConflict, hasPendingUploads: compileExport.hasPendingUploads,
    setNotice, beginDraftCommit, takeDraftCommitRejection
  });
  const flushPendingChanges = useLatestCallback(() => pending.flushPendingChanges({
    waitForSaveAs: conflicts.waitForSaveAs,
    hasPendingUploads: compileExport.hasPendingUploads,
    isWorkspaceChanging,
    flushCurrentChanges
  }));
  const openQuestionFromHeatmap = useCallback((id: string) => {
    setHeatmapFocusedId(id);
    setActiveId(id);
    setActiveModule("question");
    setActiveView("editor");
  }, [setActiveView, setHeatmapFocusedId]);

  return useQuestionBankContextValues({
    appInfo,
    bank,
    activeId,
    notice,
    loadError,
    recoveryCandidates,
    saveState,
    saveIssue,
    isConflictDialogOpen: conflicts.isConflictDialogOpen,
    isSavingConflictAs: conflicts.isSavingConflictAs,
    isSaveAsUncertain: conflicts.isSaveAsUncertain,
    activeModule,
    derived,
    selection,
    compileExport,
    workspace,
    reorder,
    setActiveId,
    setNotice,
    beginDraftCommit,
    takeDraftCommitRejection,
    setActiveModule,
    appView,
    openQuestionFromHeatmap,
    updateBank,
    updateItem,
    commitSourceNumber,
    moveItemToChapter,
    bankSettings,
    reviewHistory,
    retrySave,
    refreshSaveConflict: refreshConflict,
    useDiskVersion: conflicts.useDiskVersion,
    overwriteDiskVersion: conflicts.overwriteDiskVersion,
    saveConflictAs: conflicts.saveConflictAs,
    openConflictDialog: conflicts.openConflictDialog,
    closeConflictDialog: conflicts.closeConflictDialog,
    loadAppAndBank,
    recoverFromCandidate,
    flushPendingChanges
  });
}
