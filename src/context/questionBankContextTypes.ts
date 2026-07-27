import type {
  Dispatch,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction
} from "react";
import type {
  AppInfo,
  Bank,
  Chapter,
  MasteryHistoryEntry,
  CompileResponse,
  ExportOrderMode,
  ModuleKind,
  QuestionItem,
  RecoveryCandidate,
  ReviewOption
} from "../../shared/types.js";
import type {
  AddMenu,
  AddMode,
  Notice,
  ReorderMenu,
  SaveIssue,
  SaveState
} from "../hooks/controllerTypes.js";
import type { AppView } from "../hooks/useAppView.js";
import type { HeatmapMode } from "../heatmap.js";
import type { QuestionListMode } from "../hooks/useSelectionFilters.js";
import type { DropPosition } from "../itemOrder.js";

export interface LifecycleContextValue {
  saveState: SaveState;
  saveIssue: SaveIssue | null;
  isConflictDialogOpen: boolean;
  notice: Notice | null;
  loadError: string | null;
  recoveryCandidates: RecoveryCandidate[];
  setNotice: (notice: Notice | null) => void;
  retrySave: () => Promise<void>;
  refreshSaveConflict: () => Promise<void>;
  useDiskVersion: () => Promise<void>;
  overwriteDiskVersion: () => Promise<void>;
  saveConflictAs: () => Promise<void>;
  openConflictDialog: () => void;
  closeConflictDialog: () => void;
  retryInitialLoad: () => Promise<void>;
  recoverFromCandidate: (candidateId: string) => Promise<void>;
  flushPendingChanges: () => Promise<void>;
  /** 关闭边界专用,见 src/hooks/useBeforeCloseFlush.ts。 */
  beginDraftCommit: () => void;
  takeDraftCommitRejection: () => string | null;
}

export interface WorkspaceContextValue {
  appInfo: AppInfo | null;
  isChangingWorkspace: boolean;
  texPathDraft: string;
  setTexPathDraft: (value: string) => void;
  createSampleWorkspace: () => Promise<void>;
  createNewWorkspace: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  switchToWorkspace: (workspacePath: string) => Promise<void>;
  relocateWorkspace: (workspacePath: string) => Promise<void>;
  moveWorkspaceInList: (workspacePath: string, direction: "up" | "down") => Promise<void>;
  removeWorkspaceFromList: (workspacePath: string) => Promise<void>;
  saveTexPathOverride: () => Promise<void>;
  openCurrentWorkspaceFolder: () => void;
}

export interface QuestionContextValue {
  bank: Bank | null;
  activeId: string | null;
  activeItem: QuestionItem | null;
  orderedItems: QuestionItem[];
  numberById: Map<string, number>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  updateBank: (updater: (current: Bank) => Bank) => void;
  updateItem: (id: string, patch: Partial<QuestionItem>) => void;
  commitSourceNumber: (id: string, sourceNumber: string) => boolean;
  moveItemToChapter: (id: string, chapterId: string | null) => boolean;
  addItem: (mode?: AddMode) => void;
  deleteItem: (id: string) => void;
  deleteActiveItem: () => void;
  undoDelete: () => void;
  moveActive: (direction: -1 | 1) => void;
  canUndoDelete: boolean;
}

export interface SelectionContextValue {
  filteredItems: QuestionItem[];
  listItems: QuestionItem[];
  chapters: Chapter[];
  tags: string[];
  selectedIds: Set<string>;
  chapterFilters: string[];
  tagFilters: string[];
  masteryFilters: string[];
  errorReasonFilters: string[];
  search: string;
  listMode: QuestionListMode;
  setChapterFilters: (value: string[]) => void;
  setTagFilters: (value: string[]) => void;
  setMasteryFilters: (value: string[]) => void;
  setErrorReasonFilters: (value: string[]) => void;
  setSearch: (value: string) => void;
  setListMode: (value: QuestionListMode) => void;
  toggleSelected: (id: string) => void;
  toggleAllVisible: () => void;
}

export interface AppViewContextValue {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  heatmapMode: HeatmapMode;
  setHeatmapMode: (mode: HeatmapMode) => void;
  heatmapFocusedId: string | null;
  setHeatmapFocusedId: (id: string | null) => void;
  heatmapScrollTop: number;
  setHeatmapScrollTop: (value: number) => void;
  openQuestionFromHeatmap: (id: string) => void;
}

export interface ReviewContextValue {
  chapters: Chapter[];
  masteryOptions: ReviewOption[];
  errorReasonOptions: ReviewOption[];
  masteryHistory: MasteryHistoryEntry[];
  capacityRequest: {
    entries: MasteryHistoryEntry[];
    selectedId: string;
  } | null;
  createChapter: (name: string) => string | null;
  renameChapter: (id: string, name: string) => boolean;
  moveChapter: (id: string, direction: -1 | 1) => void;
  moveChapterToIndex: (id: string, targetIndex: number) => void;
  deleteChapter: (id: string) => void;
  createReviewOption: (
    kind: "mastery" | "errorReason",
    option: Pick<ReviewOption, "name" | "color" | "pattern">
  ) => boolean;
  updateReviewOption: (
    kind: "mastery" | "errorReason",
    id: string,
    patch: Partial<Pick<ReviewOption, "name" | "color" | "pattern">>
  ) => boolean;
  moveReviewOption: (
    kind: "mastery" | "errorReason",
    id: string,
    direction: -1 | 1
  ) => void;
  moveReviewOptionToIndex: (
    kind: "mastery" | "errorReason",
    id: string,
    targetIndex: number
  ) => void;
  deleteReviewOption: (
    kind: "mastery" | "errorReason",
    id: string
  ) => void;
  selectCapacityDeletion: (id: string) => void;
  confirmCapacityDeletion: () => void;
  cancelCapacityDeletion: () => void;
  renameHistory: (id: string, name: string) => boolean;
  deleteHistory: (id: string) => void;
  restoreHistory: (id: string) => void;
}

export interface CompileExportContextValue {
  exportName: string;
  exportOrderMode: ExportOrderMode;
  randomSeed: string;
  isExporting: boolean;
  isCompiling: boolean;
  compileResult: CompileResponse | null;
  exportFailureResult: CompileResponse | null;
  compileStatus: {
    state: "compiling" | "success" | "failure" | "stale";
    text: string;
    pdfUrl?: string;
  } | null;
  setExportName: (value: string) => void;
  setExportOrderMode: (value: ExportOrderMode) => void;
  setRandomSeed: (value: string) => void;
  uploadAsset: (kind: ModuleKind, file: File) => Promise<void>;
  compileCurrentItem: () => Promise<void>;
  exportSelected: () => Promise<void>;
}

export interface WorkspaceUiContextValue {
  activeModule: ModuleKind;
  draggingId: string | null;
  dropTarget: { id: string; position: DropPosition } | null;
  reorderMenu: ReorderMenu | null;
  addMenu: AddMenu | null;
  reorderDialogItem: QuestionItem | null;
  reorderTarget: string;
  reorderError: string;
  reorderInputRef: RefObject<HTMLInputElement | null>;
  setActiveModule: (kind: ModuleKind) => void;
  setReorderTarget: (value: string) => void;
  setReorderError: (value: string) => void;
  openReorderDialog: (id: string) => void;
  closeReorderDialog: () => void;
  submitReorder: (event: FormEvent<HTMLFormElement>) => void;
  openReorderMenu: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
  openAddMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  startPointerDrag: (event: ReactPointerEvent<HTMLSpanElement>, id: string) => void;
  startMouseDrag: (event: ReactMouseEvent<HTMLSpanElement>, id: string) => void;
}

export interface QuestionBankContextValues {
  lifecycle: LifecycleContextValue;
  workspace: WorkspaceContextValue;
  questions: QuestionContextValue;
  selection: SelectionContextValue;
  compileExport: CompileExportContextValue;
  workspaceUi: WorkspaceUiContextValue;
  appView: AppViewContextValue;
  review: ReviewContextValue;
}
