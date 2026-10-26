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
    saveIssue: input.saveIssue,
    isConflictDialogOpen: input.isConflictDialogOpen,
    isSavingConflictAs: input.isSavingConflictAs,
    isSaveAsUncertain: input.isSaveAsUncertain,
    notice: input.notice,
    externalBankNotice: input.externalBankNotice,
    loadError: input.loadError,
    recoveryCandidates: input.recoveryCandidates,
    setNotice: input.setNotice,
    reloadExternalBank: stable.reloadExternalBank,
    dismissExternalBankNotice: stable.dismissExternalBankNotice,
    retrySave: stable.retrySave,
    refreshSaveConflict: stable.refreshSaveConflict,
    useDiskVersion: stable.useDiskVersion,
    overwriteDiskVersion: stable.overwriteDiskVersion,
    saveConflictAs: stable.saveConflictAs,
    openConflictDialog: stable.openConflictDialog,
    closeConflictDialog: stable.closeConflictDialog,
    retryInitialLoad: stable.loadAppAndBank,
    recoverFromCandidate: stable.recoverFromCandidate,
    flushPendingChanges: stable.flushPendingChanges,
    beginDraftCommit: input.beginDraftCommit,
    takeDraftCommitRejection: input.takeDraftCommitRejection
  }), [
    input.beginDraftCommit,
    input.externalBankNotice,
    input.loadError,
    input.isConflictDialogOpen,
    input.isSavingConflictAs,
    input.isSaveAsUncertain,
    input.notice,
    input.recoveryCandidates,
    input.saveState,
    input.saveIssue,
    input.setNotice,
    input.takeDraftCommitRejection,
    stable.flushPendingChanges,
    stable.loadAppAndBank,
    stable.closeConflictDialog,
    stable.openConflictDialog,
    stable.overwriteDiskVersion,
    stable.refreshSaveConflict,
    stable.recoverFromCandidate,
    stable.reloadExternalBank,
    stable.dismissExternalBankNotice,
    stable.retrySave,
    stable.saveConflictAs,
    stable.useDiskVersion
  ]);

  const workspace = useMemo<QuestionBankContextValues["workspace"]>(() => ({
    appInfo: input.appInfo,
    isChangingWorkspace: input.workspace.isChangingWorkspace,
    isWorkspaceUncertain: input.workspace.isWorkspaceUncertain,
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
    input.workspace.isWorkspaceUncertain,
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
    commitSource: stable.commitSource,
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
    stable.commitSource,
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
    bookFilters: input.selection.bookFilters,
    reviewPriorityFilters: input.selection.reviewPriorityFilters,
    reviewStatusFilters: input.selection.reviewStatusFilters,
    search: input.selection.search,
    listMode: input.selection.listMode,
    setChapterFilters: input.selection.setChapterFilters,
    setTagFilters: input.selection.setTagFilters,
    setBookFilters: input.selection.setBookFilters,
    setReviewPriorityFilters: input.selection.setReviewPriorityFilters,
    setReviewStatusFilters: input.selection.setReviewStatusFilters,
    setSearch: input.selection.setSearch,
    setListMode: input.selection.setListMode,
    clearFilters: input.selection.clearFilters,
    toggleSelected: stable.toggleSelected,
    toggleAllVisible: stable.toggleAllVisible
  }), [
    input.derived.chapters,
    input.derived.filteredItems,
    input.derived.listItems,
    input.derived.tags,
    input.selection.bookFilters,
    input.selection.chapterFilters,
    input.selection.clearFilters,
    input.selection.listMode,
    input.selection.reviewPriorityFilters,
    input.selection.reviewStatusFilters,
    input.selection.search,
    input.selection.setBookFilters,
    input.selection.setChapterFilters,
    input.selection.setListMode,
    input.selection.setReviewPriorityFilters,
    input.selection.setReviewStatusFilters,
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
    setActiveView: input.appView.setActiveView
  }), [input.appView.activeView, input.appView.setActiveView]);

  const bankSettings = useMemo<QuestionBankContextValues["bankSettings"]>(() => ({
    chapters: input.derived.chapters,
    books: input.bank?.books ?? [],
    createChapter: stable.createChapter,
    renameChapter: stable.renameChapter,
    moveChapter: stable.moveChapter,
    moveChapterToIndex: stable.moveChapterToIndex,
    deleteChapter: stable.deleteChapter,
    createBook: stable.createBook,
    renameBook: stable.renameBook,
    setBookPaths: stable.setBookPaths,
    deleteBook: stable.deleteBook
  }), [
    input.bank?.books,
    input.derived.chapters,
    stable.createChapter,
    stable.createBook,
    stable.deleteBook,
    stable.deleteChapter,
    stable.moveChapter,
    stable.moveChapterToIndex,
    stable.renameBook,
    stable.renameChapter,
    stable.setBookPaths
  ]);

  return {
    lifecycle,
    workspace,
    questions,
    selection,
    compileExport,
    workspaceUi,
    appView,
    bankSettings
  };
}
