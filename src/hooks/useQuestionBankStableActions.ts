import type { ContextValueInput } from "./questionBankContextValueTypes.js";
import { useLatestCallback } from "./useLatestCallback.js";

export function useQuestionBankStableActions(input: ContextValueInput) {
  return {
    retrySave: useLatestCallback(input.retrySave),
    refreshSaveConflict: useLatestCallback(input.refreshSaveConflict),
    useDiskVersion: useLatestCallback(input.useDiskVersion),
    overwriteDiskVersion: useLatestCallback(input.overwriteDiskVersion),
    saveConflictAs: useLatestCallback(input.saveConflictAs),
    openConflictDialog: useLatestCallback(input.openConflictDialog),
    closeConflictDialog: useLatestCallback(input.closeConflictDialog),
    loadAppAndBank: useLatestCallback(input.loadAppAndBank),
    recoverFromCandidate: useLatestCallback(input.recoverFromCandidate),
    flushPendingChanges: useLatestCallback(input.flushPendingChanges),
    reloadExternalBank: useLatestCallback(input.reloadExternalBank),
    dismissExternalBankNotice: useLatestCallback(
      input.dismissExternalBankNotice
    ),
    updateBank: useLatestCallback(input.updateBank),
    updateItem: useLatestCallback(input.updateItem),
    commitSource: useLatestCallback(input.commitSource),
    moveItemToChapter: useLatestCallback(input.moveItemToChapter),
    addItem: useLatestCallback(input.reorder.addItem),
    deleteItem: useLatestCallback(input.reorder.deleteItem),
    deleteActiveItem: useLatestCallback(input.reorder.deleteActiveItem),
    undoDelete: useLatestCallback(input.reorder.undoDelete),
    moveActive: useLatestCallback(input.reorder.moveActive),
    toggleSelected: useLatestCallback(input.selection.toggleSelected),
    toggleAllVisible: useLatestCallback(() =>
      input.selection.toggleAllVisible(input.derived.listItems)
    ),
    createSampleWorkspace: useLatestCallback(input.workspace.createSampleWorkspace),
    createNewWorkspace: useLatestCallback(input.workspace.createNewWorkspace),
    openWorkspace: useLatestCallback(input.workspace.openWorkspace),
    switchToWorkspace: useLatestCallback(input.workspace.switchToWorkspace),
    relocateWorkspace: useLatestCallback(input.workspace.relocateWorkspace),
    moveWorkspaceInList: useLatestCallback(input.workspace.moveWorkspaceInList),
    removeWorkspaceFromList: useLatestCallback(input.workspace.removeWorkspaceFromList),
    saveTexPathOverride: useLatestCallback(input.workspace.saveTexPathOverride),
    openCurrentWorkspaceFolder: useLatestCallback(input.workspace.openCurrentWorkspaceFolder),
    uploadAsset: useLatestCallback(input.compileExport.uploadAsset),
    compileCurrentItem: useLatestCallback(input.compileExport.compileCurrentItem),
    exportSelected: useLatestCallback(input.compileExport.exportSelected),
    openReorderDialog: useLatestCallback(input.reorder.openReorderDialog),
    closeReorderDialog: useLatestCallback(input.reorder.closeReorderDialog),
    submitReorder: useLatestCallback(input.reorder.submitReorder),
    openReorderMenu: useLatestCallback(input.reorder.openReorderMenu),
    openAddMenu: useLatestCallback(input.reorder.openAddMenu),
    startPointerDrag: useLatestCallback(input.reorder.startPointerDrag),
    startMouseDrag: useLatestCallback(input.reorder.startMouseDrag),
    createChapter: useLatestCallback(input.bankSettings.createChapter),
    renameChapter: useLatestCallback(input.bankSettings.renameChapter),
    moveChapter: useLatestCallback(input.bankSettings.moveChapter),
    moveChapterToIndex: useLatestCallback(input.bankSettings.moveChapterToIndex),
    deleteChapter: useLatestCallback(input.bankSettings.deleteChapter),
    createBook: useLatestCallback(input.bankSettings.createBook),
    renameBook: useLatestCallback(input.bankSettings.renameBook),
    setBookPaths: useLatestCallback(input.bankSettings.setBookPaths),
    deleteBook: useLatestCallback(input.bankSettings.deleteBook)
  };
}
