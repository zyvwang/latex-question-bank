import type { Dispatch, SetStateAction } from "react";
import type {
  AppInfo,
  Bank,
  ModuleKind,
  QuestionItem,
  RecoveryCandidate
} from "../../shared/types.js";
import type {
  ExternalBankNotice,
  Notice,
  SaveIssue,
  SaveState
} from "./controllerTypes.js";
import type { useCompileExportActions } from "./useCompileExportActions.js";
import type { useBankSettingsActions } from "./useBankSettingsActions.js";
import type { useAppView } from "./useAppView.js";
import type { useQuestionDerivedData } from "./useQuestionDerivedData.js";
import type { useQuestionReorder } from "./useQuestionReorder.js";
import type { useSelectionFilters } from "./useSelectionFilters.js";
import type { useWorkspaceActions } from "./useWorkspaceActions.js";

export interface ContextValueInput {
  appInfo: AppInfo | null;
  bank: Bank | null;
  activeId: string | null;
  notice: Notice | null;
  externalBankNotice: ExternalBankNotice | null;
  loadError: string | null;
  recoveryCandidates: RecoveryCandidate[];
  reloadExternalBank: () => Promise<void>;
  dismissExternalBankNotice: () => void;
  saveState: SaveState;
  saveIssue: SaveIssue | null;
  isConflictDialogOpen: boolean;
  isSavingConflictAs: boolean;
  isSaveAsUncertain: boolean;
  activeModule: ModuleKind;
  appView: ReturnType<typeof useAppView>;
  derived: ReturnType<typeof useQuestionDerivedData>;
  selection: ReturnType<typeof useSelectionFilters>;
  compileExport: ReturnType<typeof useCompileExportActions>;
  workspace: ReturnType<typeof useWorkspaceActions>;
  reorder: ReturnType<typeof useQuestionReorder>;
  bankSettings: ReturnType<typeof useBankSettingsActions>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setNotice: (notice: Notice | null) => void;
  beginDraftCommit: () => void;
  takeDraftCommitRejection: () => string | null;
  setActiveModule: (kind: ModuleKind) => void;
  updateBank: (updater: (current: Bank) => Bank) => void;
  updateItem: (id: string, patch: Partial<QuestionItem>) => void;
  commitSource: (id: string, source: QuestionItem["source"]) => boolean;
  moveItemToChapter: (id: string, chapterId: string | null) => boolean;
  retrySave: () => Promise<void>;
  refreshSaveConflict: () => Promise<void>;
  useDiskVersion: () => Promise<void>;
  overwriteDiskVersion: () => Promise<void>;
  saveConflictAs: () => Promise<void>;
  openConflictDialog: () => void;
  closeConflictDialog: () => void;
  loadAppAndBank: () => Promise<void>;
  recoverFromCandidate: (candidateId: string) => Promise<void>;
  flushPendingChanges: () => Promise<void>;
}
