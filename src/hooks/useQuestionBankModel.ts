import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAppInfo,
  fetchBank,
  fetchBankHead,
  fetchRecoveryCandidates,
  recoverBank,
  saveBankAs
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
import { useAppView, type AppView } from "./useAppView.js";
import { useBankSettingsActions } from "./useBankSettingsActions.js";
import { useCompileExportActions } from "./useCompileExportActions.js";
import { useQuestionDerivedData } from "./useQuestionDerivedData.js";
import { useQuestionBankContextValues } from "./useQuestionBankContextValues.js";
import { useQuestionReorder } from "./useQuestionReorder.js";
import { useReviewHistory } from "./useReviewHistory.js";
import { useSelectionFilters } from "./useSelectionFilters.js";
import {
  pickWorkspaceDirectory,
  useWorkspaceActions
} from "./useWorkspaceActions.js";

export function useQuestionBankModel(): QuestionBankContextValues {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNoticeState] = useState<QuestionBankContextValues["lifecycle"]["notice"]>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 关闭前提交聚焦草稿时,用这个槽把「校验拒绝」带出 blur 的同步批次。
  // 依赖一条全项目约定:草稿提交失败一律 setNotice({ type: "error" })。
  // 只有夹在 beginDraftCommit() 与 takeDraftCommitRejection() 之间那一次同步
  // blur 里写进去的值会被读到,所以不需要判断时序;详见 useBeforeCloseFlush.ts。
  const draftRejectionRef = useRef<string | null>(null);
  const setNotice = useCallback(
    (next: QuestionBankContextValues["lifecycle"]["notice"]) => {
      if (next?.type === "error") draftRejectionRef.current = next.text;
      setNoticeState(next);
    },
    []
  );
  const beginDraftCommit = useCallback(() => {
    draftRejectionRef.current = null;
  }, []);
  const takeDraftCommitRejection = useCallback(() => {
    const text = draftRejectionRef.current;
    draftRejectionRef.current = null;
    return text;
  }, []);
  const [recoveryCandidates, setRecoveryCandidates] = useState<
    QuestionBankContextValues["lifecycle"]["recoveryCandidates"]
  >([]);
  const [activeModule, setActiveModule] = useState<ModuleKind>("question");
  const [isConflictDialogOpen, setIsConflictDialogOpen] = useState(false);
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
  useEffect(() => {
    if (saveIssue?.kind === "conflict") {
      setIsConflictDialogOpen(true);
    }
  }, [saveIssue?.kind]);

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
    persistBank,
    setNotice,
    updateBank
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
  const reloadWorkspace = useCallback(
    async (nextAppInfo: AppInfo) => {
      if (nextAppInfo.setupRequired) {
        applySetupState(nextAppInfo);
        return;
      }
      const nextActiveView =
        appView.activeView === "settings" ? "settings" : "editor";
      applyBankSnapshot(nextAppInfo, await fetchBank(), nextActiveView);
    },
    [appView.activeView, applyBankSnapshot, applySetupState]
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
    if (nextAppInfo.setupRequired) {
      applySetupState(nextAppInfo);
      return;
    }
    setAppInfo(nextAppInfo);
    applyBankSnapshot(nextAppInfo, await fetchBank());
  }, [applyBankSnapshot, applySetupState]);

  useEffect(() => {
    loadAppAndBank().catch((error) => {
      const message = error instanceof Error ? error.message : "读取题库失败。";
      setLoadError(message);
      setNotice({ type: "error", text: message });
      fetchRecoveryCandidates()
        .then(setRecoveryCandidates)
        .catch(() => setRecoveryCandidates([]));
    });
  }, [loadAppAndBank, setNotice]);

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
    [resetAutosave, selectAllItems, setNotice]
  );
  const flushPendingChanges = useCallback(async () => {
    if (bank && appInfo?.currentWorkspacePath) await persistBank(bank);
  }, [appInfo?.currentWorkspacePath, bank, persistBank]);
  const useDiskVersion = useCallback(async () => {
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
      applyBankSnapshot(appInfo, snapshot, appView.activeView);
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
    appView.activeView,
    applyBankSnapshot,
    refreshConflict,
    saveIssue?.kind,
    setNotice
  ]);
  const overwriteDiskVersion = useCallback(async () => {
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
    if (
      saveIssue?.kind !== "conflict" ||
      !bank ||
      !appInfo?.currentWorkspacePath
    ) {
      return;
    }
    const targetWorkspacePath = await pickWorkspaceDirectory(
      "选择空文件夹另存当前题库",
      "输入一个空文件夹路径，用于另存当前题库"
    );
    if (!targetWorkspacePath?.trim()) return;
    try {
      const response = await saveBankAs({
        sourceWorkspacePath: appInfo.currentWorkspacePath,
        targetWorkspacePath,
        bank
      });
      applyBankSnapshot(
        response.appInfo,
        response.snapshot,
        appView.activeView
      );
      setIsConflictDialogOpen(false);
      setNotice({
        type: "ok",
        text: `已另存为新题库：${response.appInfo.currentWorkspaceName}`
      });
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error ? error.message : "另存当前题库失败。"
      });
    }
  }, [
    appInfo?.currentWorkspacePath,
    appView.activeView,
    applyBankSnapshot,
    bank,
    saveIssue?.kind,
    setNotice
  ]);
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
    isConflictDialogOpen,
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
    useDiskVersion,
    overwriteDiskVersion,
    saveConflictAs,
    openConflictDialog: () => setIsConflictDialogOpen(true),
    closeConflictDialog: () => setIsConflictDialogOpen(false),
    loadAppAndBank,
    recoverFromCandidate,
    flushPendingChanges
  });
}
