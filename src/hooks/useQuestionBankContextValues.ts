import { useMemo } from "react";
import type { QuestionBankContextValues } from "../context/questionBankContextTypes.js";
import type { ContextValueInput } from "./questionBankContextValueTypes.js";
import { useQuestionBankStableActions } from "./useQuestionBankStableActions.js";

export function useQuestionBankContextValues(
  input: ContextValueInput
): QuestionBankContextValues {
  const stable = useQuestionBankStableActions(input);

  const lifecycle = useMemo<QuestionBankContextValues["lifecycle"]>(() => ({
    saveState: input.saveState,
    notice: input.notice,
    loadError: input.loadError,
    recoveryCandidates: input.recoveryCandidates,
    setNotice: input.setNotice,
    retrySave: stable.retrySave,
    retryInitialLoad: stable.loadAppAndBank,
    recoverFromCandidate: stable.recoverFromCandidate,
    flushPendingChanges: stable.flushPendingChanges
  }), [
    input.loadError,
    input.notice,
    input.recoveryCandidates,
    input.saveState,
    input.setNotice,
    stable.flushPendingChanges,
    stable.loadAppAndBank,
    stable.recoverFromCandidate,
    stable.retrySave
  ]);

  const workspace = useMemo<QuestionBankContextValues["workspace"]>(() => ({
    appInfo: input.appInfo,
    isChangingWorkspace: input.workspace.isChangingWorkspace,
    texPathDraft: input.workspace.texPathDraft,
    setTexPathDraft: input.workspace.setTexPathDraft,
    createSampleWorkspace: stable.createSampleWorkspace,
    createNewWorkspace: stable.createNewWorkspace,
    openWorkspace: stable.openWorkspace,
    switchToWorkspace: stable.switchToWorkspace,
    relocateWorkspace: stable.relocateWorkspace,
    moveWorkspaceInList: stable.moveWorkspaceInList,
    removeWorkspaceFromList: stable.removeWorkspaceFromList,
    saveTexPathOverride: stable.saveTexPathOverride,
    openCurrentWorkspaceFolder: stable.openCurrentWorkspaceFolder
  }), [
    input.appInfo,
    input.workspace.isChangingWorkspace,
    input.workspace.setTexPathDraft,
    input.workspace.texPathDraft,
    stable.createNewWorkspace,
    stable.createSampleWorkspace,
    stable.removeWorkspaceFromList,
    stable.moveWorkspaceInList,
    stable.openCurrentWorkspaceFolder,
    stable.openWorkspace,
    stable.relocateWorkspace,
    stable.saveTexPathOverride,
    stable.switchToWorkspace
  ]);

  const questions = useMemo<QuestionBankContextValues["questions"]>(() => ({
    bank: input.bank,
    activeId: input.activeId,
    activeItem: input.derived.activeItem,
    orderedItems: input.derived.orderedItems,
    numberById: input.derived.numberById,
    setActiveId: input.setActiveId,
    updateBank: stable.updateBank,
    updateItem: stable.updateItem,
    commitSourceNumber: stable.commitSourceNumber,
    moveItemToChapter: stable.moveItemToChapter,
    addItem: stable.addItem,
    deleteItem: stable.deleteItem,
    deleteActiveItem: stable.deleteActiveItem,
    undoDelete: stable.undoDelete,
    moveActive: stable.moveActive,
    canUndoDelete: input.reorder.canUndoDelete
  }), [
    input.activeId,
    input.bank,
    input.derived.activeItem,
    input.derived.numberById,
    input.derived.orderedItems,
    input.reorder.canUndoDelete,
    input.setActiveId,
    stable.addItem,
    stable.deleteActiveItem,
    stable.deleteItem,
    stable.moveActive,
    stable.commitSourceNumber,
    stable.moveItemToChapter,
    stable.undoDelete,
    stable.updateBank,
    stable.updateItem
  ]);

  const selection = useMemo<QuestionBankContextValues["selection"]>(() => ({
    filteredItems: input.derived.filteredItems,
    listItems: input.derived.listItems,
    chapters: input.derived.chapters,
    tags: input.derived.tags,
    selectedIds: input.selection.selectedIds,
    chapterFilters: input.selection.chapterFilters,
    tagFilters: input.selection.tagFilters,
    masteryFilters: input.selection.masteryFilters,
    errorReasonFilters: input.selection.errorReasonFilters,
    search: input.selection.search,
    listMode: input.selection.listMode,
    setChapterFilters: input.selection.setChapterFilters,
    setTagFilters: input.selection.setTagFilters,
    setMasteryFilters: input.selection.setMasteryFilters,
    setErrorReasonFilters: input.selection.setErrorReasonFilters,
    setSearch: input.selection.setSearch,
    setListMode: input.selection.setListMode,
    toggleSelected: stable.toggleSelected,
    toggleAllVisible: stable.toggleAllVisible
  }), [
    input.derived.chapters,
    input.derived.filteredItems,
    input.derived.listItems,
    input.derived.tags,
    input.selection.chapterFilters,
    input.selection.errorReasonFilters,
    input.selection.listMode,
    input.selection.masteryFilters,
    input.selection.search,
    input.selection.setChapterFilters,
    input.selection.setErrorReasonFilters,
    input.selection.setListMode,
    input.selection.setMasteryFilters,
    input.selection.setSearch,
    input.selection.setTagFilters,
    input.selection.selectedIds,
    input.selection.tagFilters,
    stable.toggleAllVisible,
    stable.toggleSelected
  ]);

  const compileExport = useMemo<QuestionBankContextValues["compileExport"]>(() => ({
    exportName: input.compileExport.exportName,
    exportOrderMode: input.compileExport.exportOrderMode,
    randomSeed: input.compileExport.randomSeed,
    isExporting: input.compileExport.isExporting,
    isCompiling: input.compileExport.isCompiling,
    compileResult: input.compileExport.compileResult,
    exportFailureResult: input.compileExport.exportFailureResult,
    compileStatus: input.compileExport.compileStatus,
    setExportName: input.compileExport.setExportName,
    setExportOrderMode: input.compileExport.setExportOrderMode,
    setRandomSeed: input.compileExport.setRandomSeed,
    uploadAsset: stable.uploadAsset,
    compileCurrentItem: stable.compileCurrentItem,
    exportSelected: stable.exportSelected
  }), [
    input.compileExport.compileResult,
    input.compileExport.compileStatus,
    input.compileExport.exportName,
    input.compileExport.exportFailureResult,
    input.compileExport.exportOrderMode,
    input.compileExport.isCompiling,
    input.compileExport.isExporting,
    input.compileExport.randomSeed,
    input.compileExport.setExportName,
    input.compileExport.setExportOrderMode,
    input.compileExport.setRandomSeed,
    stable.compileCurrentItem,
    stable.exportSelected,
    stable.uploadAsset
  ]);

  const workspaceUi = useMemo<QuestionBankContextValues["workspaceUi"]>(() => ({
    activeModule: input.activeModule,
    setActiveModule: input.setActiveModule,
    draggingId: input.reorder.draggingId,
    dropTarget: input.reorder.dropTarget,
    reorderMenu: input.reorder.reorderMenu,
    addMenu: input.reorder.addMenu,
    reorderDialogItem: input.reorder.reorderDialogItem,
    reorderTarget: input.reorder.reorderTarget,
    reorderError: input.reorder.reorderError,
    reorderInputRef: input.reorder.reorderInputRef,
    setReorderTarget: input.reorder.setReorderTarget,
    setReorderError: input.reorder.setReorderError,
    openReorderDialog: stable.openReorderDialog,
    closeReorderDialog: stable.closeReorderDialog,
    submitReorder: stable.submitReorder,
    openReorderMenu: stable.openReorderMenu,
    openAddMenu: stable.openAddMenu,
    startPointerDrag: stable.startPointerDrag,
    startMouseDrag: stable.startMouseDrag
  }), [
    input.activeModule,
    input.reorder.addMenu,
    input.reorder.draggingId,
    input.reorder.dropTarget,
    input.reorder.reorderDialogItem,
    input.reorder.reorderError,
    input.reorder.reorderMenu,
    input.reorder.reorderTarget,
    input.reorder.reorderInputRef,
    input.reorder.setReorderError,
    input.reorder.setReorderTarget,
    input.setActiveModule,
    stable.closeReorderDialog,
    stable.openAddMenu,
    stable.openReorderDialog,
    stable.openReorderMenu,
    stable.startMouseDrag,
    stable.startPointerDrag,
    stable.submitReorder
  ]);

  const appView = useMemo<QuestionBankContextValues["appView"]>(() => ({
    activeView: input.appView.activeView,
    setActiveView: input.appView.setActiveView,
    heatmapMode: input.appView.heatmapMode,
    setHeatmapMode: input.appView.setHeatmapMode,
    heatmapFocusedId: input.appView.heatmapFocusedId,
    setHeatmapFocusedId: input.appView.setHeatmapFocusedId,
    heatmapScrollTop: input.appView.heatmapScrollTop,
    setHeatmapScrollTop: input.appView.setHeatmapScrollTop,
    openQuestionFromHeatmap: stable.openQuestionFromHeatmap
  }), [
    input.appView.activeView,
    input.appView.heatmapFocusedId,
    input.appView.heatmapMode,
    input.appView.heatmapScrollTop,
    input.appView.setActiveView,
    input.appView.setHeatmapFocusedId,
    input.appView.setHeatmapMode,
    input.appView.setHeatmapScrollTop,
    stable.openQuestionFromHeatmap
  ]);

  const review = useMemo<QuestionBankContextValues["review"]>(() => ({
    chapters: input.derived.chapters,
    masteryOptions: input.bank?.masteryOptions ?? [],
    errorReasonOptions: input.bank?.errorReasonOptions ?? [],
    masteryHistory: input.reviewHistory.masteryHistory,
    capacityRequest: input.reviewHistory.capacityRequest,
    createChapter: stable.createChapter,
    renameChapter: stable.renameChapter,
    moveChapter: stable.moveChapter,
    moveChapterToIndex: stable.moveChapterToIndex,
    deleteChapter: stable.deleteChapter,
    createReviewOption: stable.createReviewOption,
    updateReviewOption: stable.updateReviewOption,
    moveReviewOption: stable.moveReviewOption,
    moveReviewOptionToIndex: stable.moveReviewOptionToIndex,
    deleteReviewOption: stable.deleteReviewOption,
    selectCapacityDeletion: stable.selectCapacityDeletion,
    confirmCapacityDeletion: stable.confirmCapacityDeletion,
    cancelCapacityDeletion: stable.cancelCapacityDeletion,
    renameHistory: stable.renameHistory,
    deleteHistory: stable.deleteHistory,
    restoreHistory: stable.restoreHistory
  }), [
    input.bank?.errorReasonOptions,
    input.bank?.masteryOptions,
    input.derived.chapters,
    input.reviewHistory.capacityRequest,
    input.reviewHistory.masteryHistory,
    stable.createChapter,
    stable.createReviewOption,
    stable.deleteChapter,
    stable.deleteReviewOption,
    stable.deleteHistory,
    stable.moveChapter,
    stable.moveChapterToIndex,
    stable.moveReviewOption,
    stable.moveReviewOptionToIndex,
    stable.renameHistory,
    stable.renameChapter,
    stable.restoreHistory,
    stable.cancelCapacityDeletion,
    stable.confirmCapacityDeletion,
    stable.selectCapacityDeletion,
    stable.updateReviewOption
  ]);

  return {
    lifecycle,
    workspace,
    questions,
    selection,
    compileExport,
    workspaceUi,
    appView,
    review
  };
}
