import type { AppInfo, Bank, BookRecord, ModuleKind } from "../../shared/types.js";
import type { Dispatch, SetStateAction } from "react";
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
import type { useAutosave } from "./useAutosave.js";
import type { useAppView } from "./useAppView.js";
import type { useBankSettingsActions } from "./useBankSettingsActions.js";
import type { useCompileExportActions } from "./useCompileExportActions.js";
import type { useQuestionDerivedData } from "./useQuestionDerivedData.js";
import type { useQuestionReorder } from "./useQuestionReorder.js";
import type { useSelectionFilters } from "./useSelectionFilters.js";
import type { useWorkspaceActions } from "./useWorkspaceActions.js";
import type { useSaveConflictActions } from "./useSaveConflictActions.js";
import { useStableSlice } from "./useStableSlice.js";
import {
  distributionStatus,
  distributionStatusFilter,
  type DistributionStatus
} from "../reviewDistribution.js";

// 空题库时保持同一引用，避免 bankSettings 每次渲染都变成新对象。
const NO_BOOKS: BookRecord[] = [];

type LifecycleActions = Pick<QuestionBankContextValues["lifecycle"],
  "notice" | "externalBankNotice" | "loadError" | "recoveryCandidates" |
  "setNotice" | "reloadExternalBank" | "dismissExternalBankNotice" |
  "recoverFromCandidate" | "flushPendingChanges" | "beginDraftCommit" |
  "takeDraftCommitRejection">;
type ItemActions = Pick<QuestionBankContextValues["questions"],
  "updateBank" | "updateItem" | "commitSource" | "moveItemToChapter">;

interface ContextSlicesOptions extends LifecycleActions, ItemActions {
  appInfo: AppInfo | null;
  bank: Bank | null;
  activeId: string | null;
  setActiveId: QuestionBankContextValues["questions"]["setActiveId"];
  activeModule: ModuleKind;
  setActiveModule: Dispatch<SetStateAction<ModuleKind>>;
  autosave: ReturnType<typeof useAutosave>;
  conflicts: ReturnType<typeof useSaveConflictActions>;
  workspace: ReturnType<typeof useWorkspaceActions>;
  derived: ReturnType<typeof useQuestionDerivedData>;
  selection: ReturnType<typeof useSelectionFilters>;
  compileExport: ReturnType<typeof useCompileExportActions>;
  reorder: ReturnType<typeof useQuestionReorder>;
  appView: ReturnType<typeof useAppView>;
  bankSettings: ReturnType<typeof useBankSettingsActions>;
  loadAppAndBank: QuestionBankContextValues["lifecycle"]["retryInitialLoad"];
}

export function useQuestionBankContextSlices({
  appInfo, bank, activeId, setActiveId, activeModule, setActiveModule,
  autosave, conflicts, workspace, derived, selection, compileExport, reorder,
  appView, bankSettings, notice, externalBankNotice, loadError, recoveryCandidates,
  setNotice, reloadExternalBank, dismissExternalBankNotice, loadAppAndBank,
  recoverFromCandidate, flushPendingChanges, beginDraftCommit,
  takeDraftCommitRejection, updateBank, updateItem, commitSource, moveItemToChapter
}: ContextSlicesOptions): QuestionBankContextValues {
  const { saveState, saveIssue, retrySave, refreshConflict } = autosave;
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
  const openQuestionFromDistribution = (id: string) => {
    // 当前列表看不到这道题时先清筛选，否则编辑页侧栏里找不到正在编辑的题。
    if (!derived.listItems.some((item) => item.id === id)) {
      selection.clearFilters();
    }
    setActiveId(id);
    setActiveModule("question");
    appView.setActiveView("editor");
  };
  const showDistributionStatusInEditor = (status: DistributionStatus) => {
    const first = derived.orderedItems.find(
      (item) => distributionStatus(item.reviewPriority) === status
    );
    if (!first) return;
    selection.clearFilters();
    selection.setReviewPriorityFilters([distributionStatusFilter(status)]);
    setActiveId(first.id);
    setActiveModule("question");
    appView.setActiveView("editor");
  };
  const appViewValue = useStableSlice<AppViewContextValue>({
    activeView: appView.activeView,
    setActiveView: appView.setActiveView,
    distributionHighlight: appView.distributionHighlight,
    setDistributionHighlight: appView.setDistributionHighlight,
    distributionFocusedId: appView.distributionFocusedId,
    setDistributionFocusedId: appView.setDistributionFocusedId,
    distributionScrollTop: appView.distributionScrollTop,
    setDistributionScrollTop: appView.setDistributionScrollTop,
    openQuestionFromDistribution,
    showDistributionStatusInEditor
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
