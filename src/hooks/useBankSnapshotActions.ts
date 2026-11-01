import { useCallback, type Dispatch, type SetStateAction } from "react";
import type {
  AppInfo, Bank, BankSnapshot, ModuleKind, WorkspaceTransitionResponse
} from "../../shared/types.js";
import type { QuestionBankContextValues } from "../context/questionBankContextTypes.js";
import type { ExternalBankNotice } from "./controllerTypes.js";
import type { useAutosave } from "./useAutosave.js";
import type { useSelectionFilters } from "./useSelectionFilters.js";
import type { useCompileExportActions } from "./useCompileExportActions.js";
import type { useAppView, AppView } from "./useAppView.js";

type StateSetter<T> = Dispatch<SetStateAction<T>>;
interface BankSnapshotActionsOptions {
  appInfo: AppInfo | null;
  activeView: AppView;
  resetAutosave: ReturnType<typeof useAutosave>["resetAutosave"];
  selectAllItems: ReturnType<typeof useSelectionFilters>["selectAllItems"];
  clearFilters: ReturnType<typeof useSelectionFilters>["clearFilters"];
  setSelectedIds: ReturnType<typeof useSelectionFilters>["setSelectedIds"];
  resetCompileState: ReturnType<typeof useCompileExportActions>["resetCompileState"];
  resetAppView: ReturnType<typeof useAppView>["resetAppView"];
  setAppInfo: StateSetter<AppInfo | null>;
  setBank: StateSetter<Bank | null>;
  setActiveId: StateSetter<string | null>;
  setLoadError: StateSetter<string | null>;
  setRecoveryCandidates: StateSetter<QuestionBankContextValues["lifecycle"]["recoveryCandidates"]>;
  setActiveModule: StateSetter<ModuleKind>;
  setExternalBankNotice: StateSetter<ExternalBankNotice | null>;
  setNotice: QuestionBankContextValues["lifecycle"]["setNotice"];
}

export function useBankSnapshotActions({
  appInfo, activeView, resetAutosave, selectAllItems, clearFilters, setSelectedIds,
  resetCompileState, resetAppView, setAppInfo, setBank, setActiveId, setLoadError,
  setRecoveryCandidates, setActiveModule, setExternalBankNotice, setNotice
}: BankSnapshotActionsOptions) {
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
      setAppInfo,
      setBank,
      setActiveId,
      setLoadError,
      setRecoveryCandidates,
      setActiveModule,
      setExternalBankNotice,
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
      setAppInfo,
      setBank,
      setActiveId,
      setLoadError,
      setRecoveryCandidates,
      setActiveModule,
      setExternalBankNotice,
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
        activeView === "settings" ? "settings" : "editor";
      applyBankSnapshot(response.appInfo, response.snapshot, nextActiveView);
    },
    [
      appInfo?.currentWorkspacePath,
      activeView,
      applyBankSnapshot,
      applySetupState,
      setAppInfo
    ]
  );

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
    [resetAutosave, setSelectedIds, setBank, setActiveId]
  );
  return { applyBankSnapshot, applySetupState, applyWorkspaceTransition, applyExternalSnapshot };
}
