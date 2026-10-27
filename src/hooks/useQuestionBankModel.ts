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
  BookRecord,
  ModuleKind,
  QuestionItem,
  WorkspaceTransitionResponse
} from "../../shared/types.js";
import {
  findSourceConflict,
  nextChapterOrder,
  normalizeChapterItemOrders
} from "../../shared/chapter-order.js";
import type {
  AppViewContextValue,
  BankSettingsContextValue,
  CompileExportContextValue,
  LifecycleContextValue,
  QuestionBankContextValues,
  QuestionContextValue,
  SelectionContextValue,
  WorkspaceContextValue,
  WorkspaceUiContextValue
} from "../context/questionBankContextTypes.js";
import { useAutosave } from "./useAutosave.js";
import { useAppView, type AppView } from "./useAppView.js";
import { useBankSettingsActions } from "./useBankSettingsActions.js";
import { useCompileExportActions } from "./useCompileExportActions.js";
import { useQuestionDerivedData } from "./useQuestionDerivedData.js";
import { useQuestionReorder } from "./useQuestionReorder.js";
import { useSelectionFilters } from "./useSelectionFilters.js";
import { useStableSlice } from "./useStableSlice.js";
import { useWorkspaceActions } from "./useWorkspaceActions.js";
import { useSaveConflictActions } from "./useSaveConflictActions.js";
import { usePendingChanges } from "./usePendingChanges.js";
import { useExternalBankSync } from "./useExternalBankSync.js";
import type { ExternalBankNotice } from "./controllerTypes.js";

// 空题库时保持同一引用，避免 bankSettings 每次渲染都变成新对象。
const NO_BOOKS: BookRecord[] = [];

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
  const [externalBankNotice, setExternalBankNotice] =
    useState<ExternalBankNotice | null>(null);
  const appView = useAppView();
  const { resetAppView } = appView;
  const reviewMode = appView.activeView === "review";
  const selection = useSelectionFilters(bank);
  const filters = useMemo(
    () => ({
      chapterFilters: selection.chapterFilters,
      topicFilters: selection.topicFilters,
      typeFilters: selection.typeFilters,
      bookFilters: selection.bookFilters,
      reviewPriorityFilters: selection.reviewPriorityFilters,
      reviewStatusFilters: reviewMode
        ? ["pending"]
        : selection.reviewStatusFilters,
      search: selection.search
    }),
    [
      reviewMode,
      selection.bookFilters,
      selection.chapterFilters,
      selection.reviewPriorityFilters,
      selection.reviewStatusFilters,
      selection.search,
      selection.topicFilters,
      selection.typeFilters
    ]
  );
  const derived = useQuestionDerivedData(
    bank,
    activeId,
    filters,
    selection.selectedIds,
    reviewMode ? "current" : selection.listMode
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
  const updateItem = useCallback(
    (id: string, patch: Partial<QuestionItem>) => {
      updateBank((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === id
            ? { ...item, ...patch, updatedAt: new Date().toISOString() }
            : item
        )
      }));
    },
    [updateBank]
  );
  const commitSource = useCallback(
    (id: string, source: QuestionItem["source"]) => {
      if (!bank) return false;
      const conflict = findSourceConflict(bank.items, id, source);
      if (conflict) {
        setActiveId(conflict.id);
        setNotice({
          type: "error",
          text: `来源题号“${source?.label ?? ""}”已被其他题目使用，已定位到冲突题目。`
        });
        return false;
      }
      updateItem(id, { source });
      return true;
    },
    [bank, setNotice, updateItem]
  );

  const moveItemToChapter = useCallback((id: string, chapterId: string | null) => {
    if (!bank) return false;
    const item = bank.items.find((candidate) => candidate.id === id);
    if (!item || item.chapterId === chapterId) return Boolean(item);
    const nextOrder = nextChapterOrder(bank.items, chapterId);
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
      setExternalBankNotice(null);
      setNotice(null);
    },
    [
      clearFilters,
      resetAppView,
      resetAutosave,
      resetCompileState,
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
      setExternalBankNotice(null);
      setNotice(null);
    },
    [
      clearFilters,
      resetAppView,
      resetAutosave,
      resetCompileState,
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

  const setSelectedIds = selection.setSelectedIds;
  const applyExternalSnapshot = useCallback(
    (snapshot: BankSnapshot) => {
      resetAutosave(snapshot);
      setBank(snapshot.bank);
      setActiveId((current) =>
        current && snapshot.bank.items.some((item) => item.id === current)
          ? current
          : snapshot.bank.items[0]?.id ?? null
      );
      setSelectedIds((current) => {
        const next = new Set(
          [...current].filter((id) =>
            snapshot.bank.items.some((item) => item.id === id)
          )
        );
        return next;
      });
    },
    [resetAutosave, setSelectedIds]
  );
  const reloadExternalBank = async () => {
    if (!appInfo?.currentWorkspacePath) return;
    if (
      !window.confirm(
        "重新加载会丢弃当前未保存的编辑，确定继续吗？"
      )
    ) {
      return;
    }
    const snapshot = await fetchBank();
    if (snapshot.workspacePath !== appInfo.currentWorkspacePath) {
      throw new Error("当前工作区已变化，请重新打开题库。");
    }
    applyExternalSnapshot(snapshot);
    setExternalBankNotice(null);
    setNotice({ type: "ok", text: "已加载外部题库更新。" });
  };
  const dismissExternalBankNotice = () => setExternalBankNotice(null);

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
  useExternalBankSync({
    enabled: Boolean(bank && appInfo?.currentWorkspacePath),
    workspacePath: appInfo?.currentWorkspacePath ?? "",
    saveState,
    hasSaveIssue: Boolean(saveIssue),
    hasPendingUploads: compileExport.hasPendingUploads(),
    isWorkspaceChanging: workspace.isChangingWorkspace,
    applySnapshot: applyExternalSnapshot,
    showNotice: setNotice,
    setExternalBankNotice
  });
  const bankSettings = useBankSettingsActions({
    bank,
    updateBank,
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
  const flushPendingChanges = () => pending.flushPendingChanges({
    waitForSaveAs: conflicts.waitForSaveAs,
    hasPendingUploads: compileExport.hasPendingUploads,
    isWorkspaceChanging,
    flushCurrentChanges
  });

  const lifecycleValue = useStableSlice<LifecycleContextValue>({
    saveState,
    saveIssue,
    isConflictDialogOpen: conflicts.isConflictDialogOpen,
    isSavingConflictAs: conflicts.isSavingConflictAs,
    isSaveAsUncertain: conflicts.isSaveAsUncertain,
    notice,
    externalBankNotice,
    loadError,
    recoveryCandidates,
    setNotice,
    reloadExternalBank,
    dismissExternalBankNotice,
    retrySave,
    refreshSaveConflict: refreshConflict,
    useDiskVersion: conflicts.useDiskVersion,
    overwriteDiskVersion: conflicts.overwriteDiskVersion,
    saveConflictAs: conflicts.saveConflictAs,
    openConflictDialog: conflicts.openConflictDialog,
    closeConflictDialog: conflicts.closeConflictDialog,
    retryInitialLoad: loadAppAndBank,
    recoverFromCandidate,
    flushPendingChanges,
    beginDraftCommit,
    takeDraftCommitRejection
  });
  const workspaceValue = useStableSlice<WorkspaceContextValue>({
    appInfo,
    isChangingWorkspace: workspace.isChangingWorkspace,
    isWorkspaceUncertain: workspace.isWorkspaceUncertain,
    texPathDraft: workspace.texPathDraft,
    setTexPathDraft: workspace.setTexPathDraft,
    createSampleWorkspace: workspace.createSampleWorkspace,
    createNewWorkspace: workspace.createNewWorkspace,
    openWorkspace: workspace.openWorkspace,
    switchToWorkspace: workspace.switchToWorkspace,
    relocateWorkspace: workspace.relocateWorkspace,
    moveWorkspaceInList: workspace.moveWorkspaceInList,
    removeWorkspaceFromList: workspace.removeWorkspaceFromList,
    saveTexPathOverride: workspace.saveTexPathOverride,
    openCurrentWorkspaceFolder: workspace.openCurrentWorkspaceFolder
  });
  const questionsValue = useStableSlice<QuestionContextValue>({
    bank,
    activeId,
    activeItem: derived.activeItem,
    orderedItems: derived.orderedItems,
    numberById: derived.numberById,
    setActiveId,
    updateBank,
    updateItem,
    commitSource,
    moveItemToChapter,
    addItem: reorder.addItem,
    deleteItem: reorder.deleteItem,
    deleteActiveItem: reorder.deleteActiveItem,
    undoDelete: reorder.undoDelete,
    moveActive: reorder.moveActive,
    canUndoDelete: reorder.canUndoDelete
  });
  const selectionValue = useStableSlice<SelectionContextValue>({
    filteredItems: derived.filteredItems,
    listItems: derived.listItems,
    chapters: derived.chapters,
    topics: derived.topics,
    questionTypes: derived.questionTypes,
    selectedIds: selection.selectedIds,
    chapterFilters: selection.chapterFilters,
    topicFilters: selection.topicFilters,
    typeFilters: selection.typeFilters,
    bookFilters: selection.bookFilters,
    reviewPriorityFilters: selection.reviewPriorityFilters,
    reviewStatusFilters: selection.reviewStatusFilters,
    search: selection.search,
    listMode: selection.listMode,
    setChapterFilters: selection.setChapterFilters,
    setTopicFilters: selection.setTopicFilters,
    setTypeFilters: selection.setTypeFilters,
    setBookFilters: selection.setBookFilters,
    setReviewPriorityFilters: selection.setReviewPriorityFilters,
    setReviewStatusFilters: selection.setReviewStatusFilters,
    setSearch: selection.setSearch,
    setListMode: selection.setListMode,
    clearFilters: selection.clearFilters,
    toggleSelected: selection.toggleSelected,
    toggleAllVisible: () => selection.toggleAllVisible(derived.listItems)
  });
  const compileExportValue = useStableSlice<CompileExportContextValue>({
    exportName: compileExport.exportName,
    exportOrderMode: compileExport.exportOrderMode,
    randomSeed: compileExport.randomSeed,
    isExporting: compileExport.isExporting,
    isCompiling: compileExport.isCompiling,
    compileResult: compileExport.compileResult,
    exportFailureResult: compileExport.exportFailureResult,
    compileStatus: compileExport.compileStatus,
    setExportName: compileExport.setExportName,
    setExportOrderMode: compileExport.setExportOrderMode,
    setRandomSeed: compileExport.setRandomSeed,
    uploadAsset: compileExport.uploadAsset,
    compileCurrentItem: compileExport.compileCurrentItem,
    exportSelected: compileExport.exportSelected
  });
  const workspaceUiValue = useStableSlice<WorkspaceUiContextValue>({
    activeModule,
    setActiveModule,
    draggingId: reorder.draggingId,
    dropTarget: reorder.dropTarget,
    reorderMenu: reorder.reorderMenu,
    addMenu: reorder.addMenu,
    reorderDialogItem: reorder.reorderDialogItem,
    reorderTarget: reorder.reorderTarget,
    reorderError: reorder.reorderError,
    reorderInputRef: reorder.reorderInputRef,
    setReorderTarget: reorder.setReorderTarget,
    setReorderError: reorder.setReorderError,
    openReorderDialog: reorder.openReorderDialog,
    closeReorderDialog: reorder.closeReorderDialog,
    submitReorder: reorder.submitReorder,
    openReorderMenu: reorder.openReorderMenu,
    openAddMenu: reorder.openAddMenu,
    startPointerDrag: reorder.startPointerDrag,
    startMouseDrag: reorder.startMouseDrag
  });
  const appViewValue = useStableSlice<AppViewContextValue>({
    activeView: appView.activeView,
    setActiveView: appView.setActiveView
  });
  const bankSettingsValue = useStableSlice<BankSettingsContextValue>({
    chapters: derived.chapters,
    books: bank?.books ?? NO_BOOKS,
    createChapter: bankSettings.createChapter,
    renameChapter: bankSettings.renameChapter,
    moveChapter: bankSettings.moveChapter,
    moveChapterToIndex: bankSettings.moveChapterToIndex,
    deleteChapter: bankSettings.deleteChapter,
    createBook: bankSettings.createBook,
    renameBook: bankSettings.renameBook,
    setBookPaths: bankSettings.setBookPaths,
    deleteBook: bankSettings.deleteBook
  });

  return {
    lifecycle: lifecycleValue,
    workspace: workspaceValue,
    questions: questionsValue,
    selection: selectionValue,
    compileExport: compileExportValue,
    workspaceUi: workspaceUiValue,
    appView: appViewValue,
    bankSettings: bankSettingsValue
  };
}
