import { useCallback, useEffect, useMemo, useState } from "react";
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
  QuestionItem
} from "../../shared/types.js";
import {
  findSourceNumberConflict,
  itemsInChapter,
  normalizeChapterItemOrders,
  sourceNumberConflictGroups
} from "../../shared/chapter-order.js";
import type { QuestionBankContextValues } from "../context/questionBankContextTypes.js";
import { useAutosave } from "./useAutosave.js";
import { useAppView } from "./useAppView.js";
import { useBankSettingsActions } from "./useBankSettingsActions.js";
import { useCompileExportActions } from "./useCompileExportActions.js";
import { useQuestionDerivedData } from "./useQuestionDerivedData.js";
import { useQuestionBankContextValues } from "./useQuestionBankContextValues.js";
import { useQuestionReorder } from "./useQuestionReorder.js";
import { useReviewHistory } from "./useReviewHistory.js";
import { useSelectionFilters } from "./useSelectionFilters.js";
import { useWorkspaceActions } from "./useWorkspaceActions.js";

export function useQuestionBankModel(): QuestionBankContextValues {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<QuestionBankContextValues["lifecycle"]["notice"]>(null);
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
  const { persistBank, resetAutosave, retrySave, saveState } = autosave;

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
  }, [bank, updateItem]);

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
  }, [bank, updateBank]);

  const compileExport = useCompileExportActions({
    activeItem: derived.activeItem,
    bank,
    workspacePath: appInfo?.currentWorkspacePath ?? "",
    selectedIds: selection.selectedIds,
    persistBank,
    setNotice,
    updateItem
  });
  const { clearFilters, selectAllItems } = selection;
  const { resetCompileState } = compileExport;

  const applyBankSnapshot = useCallback(
    (nextAppInfo: AppInfo, snapshot: BankSnapshot) => {
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
      resetAppView();
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
      selectAllItems
    ]
  );
  const reloadWorkspace = useCallback(
    async (nextAppInfo: AppInfo) => {
      applyBankSnapshot(nextAppInfo, await fetchBank());
    },
    [applyBankSnapshot]
  );

  const workspace = useWorkspaceActions({
    appInfo,
    bank,
    persistBank,
    reloadWorkspace,
    setAppInfo,
    setNotice
  });
  const bankSettings = useBankSettingsActions({
    bank,
    updateBank,
    updateReviewBank: applyReviewMutation,
    setNotice
  });
  const reorder = useQuestionReorder({
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

  const loadAppAndBank = useCallback(async () => {
    setLoadError(null);
    const nextAppInfo = await fetchAppInfo();
    setAppInfo(nextAppInfo);
    applyBankSnapshot(nextAppInfo, await fetchBank());
  }, [applyBankSnapshot]);

  useEffect(() => {
    loadAppAndBank().catch((error) => {
      const message = error instanceof Error ? error.message : "读取题库失败。";
      setLoadError(message);
      setNotice({ type: "error", text: message });
      fetchRecoveryCandidates()
        .then(setRecoveryCandidates)
        .catch(() => setRecoveryCandidates([]));
    });
  }, [loadAppAndBank]);

  const recoverFromCandidate = useCallback(
    async (candidateId: string) => {
      const snapshot = await recoverBank(candidateId);
      resetAutosave(snapshot);
      setBank(snapshot.bank);
      setActiveId(snapshot.bank.items[0]?.id ?? null);
      selectAllItems(snapshot.bank.items);
      setLoadError(null);
      setRecoveryCandidates([]);
      setNotice({ type: "ok", text: "题库已从备份恢复。" });
    },
    [resetAutosave, selectAllItems]
  );
  const flushPendingChanges = useCallback(async () => {
    if (bank && appInfo?.currentWorkspacePath) await persistBank(bank);
  }, [appInfo?.currentWorkspacePath, bank, persistBank]);
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
    activeModule,
    derived,
    selection,
    compileExport,
    workspace,
    reorder,
    setActiveId,
    setNotice,
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
    loadAppAndBank,
    recoverFromCandidate,
    flushPendingChanges
  });
}
