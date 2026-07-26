import type { Dispatch, SetStateAction } from "react";
import type {
  AppInfo,
  Bank,
  ModuleKind,
  QuestionItem,
  RecoveryCandidate
} from "../../shared/types.js";
import type { Notice, SaveState } from "./controllerTypes.js";
import type { useCompileExportActions } from "./useCompileExportActions.js";
import type { useBankSettingsActions } from "./useBankSettingsActions.js";
import type { useAppView } from "./useAppView.js";
import type { useQuestionDerivedData } from "./useQuestionDerivedData.js";
import type { useQuestionReorder } from "./useQuestionReorder.js";
import type { useReviewHistory } from "./useReviewHistory.js";
import type { useSelectionFilters } from "./useSelectionFilters.js";
import type { useWorkspaceActions } from "./useWorkspaceActions.js";

export interface ContextValueInput {
  appInfo: AppInfo | null;
  bank: Bank | null;
  activeId: string | null;
  notice: Notice | null;
  loadError: string | null;
  recoveryCandidates: RecoveryCandidate[];
  saveState: SaveState;
  activeModule: ModuleKind;
  appView: ReturnType<typeof useAppView>;
  derived: ReturnType<typeof useQuestionDerivedData>;
  selection: ReturnType<typeof useSelectionFilters>;
  compileExport: ReturnType<typeof useCompileExportActions>;
  workspace: ReturnType<typeof useWorkspaceActions>;
  reorder: ReturnType<typeof useQuestionReorder>;
  bankSettings: ReturnType<typeof useBankSettingsActions>;
  reviewHistory: ReturnType<typeof useReviewHistory>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setNotice: (notice: Notice | null) => void;
  beginDraftCommit: () => void;
  takeDraftCommitRejection: () => string | null;
  setActiveModule: (kind: ModuleKind) => void;
  openQuestionFromHeatmap: (id: string) => void;
  updateBank: (updater: (current: Bank) => Bank) => void;
  updateItem: (id: string, patch: Partial<QuestionItem>) => void;
  commitSourceNumber: (id: string, sourceNumber: string) => boolean;
  moveItemToChapter: (id: string, chapterId: string | null) => boolean;
  retrySave: () => Promise<void>;
  loadAppAndBank: () => Promise<void>;
  recoverFromCandidate: (candidateId: string) => Promise<void>;
  flushPendingChanges: () => Promise<void>;
}
