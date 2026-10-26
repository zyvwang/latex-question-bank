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
  BookRecord,
  Chapter,
  CompileResponse,
  ExportOrderMode,
  ModuleKind,
  QuestionItem,
  RecoveryCandidate
} from "../../shared/types.js";
import type {
  AddMenu,
  AddMode,
  ExternalBankNotice,
  Notice,
  ReorderMenu,
  SaveIssue,
  SaveState
} from "../hooks/controllerTypes.js";
import type { AppView } from "../hooks/useAppView.js";
import type { QuestionListMode } from "../hooks/useSelectionFilters.js";
import type { DropPosition } from "../itemOrder.js";

export interface LifecycleContextValue {
  saveState: SaveState;
  saveIssue: SaveIssue | null;
  isConflictDialogOpen: boolean;
  isSavingConflictAs: boolean;
  isSaveAsUncertain: boolean;
  notice: Notice | null;
  externalBankNotice: ExternalBankNotice | null;
  loadError: string | null;
  recoveryCandidates: RecoveryCandidate[];
  setNotice: (notice: Notice | null) => void;
  reloadExternalBank: () => Promise<void>;
  dismissExternalBankNotice: () => void;
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
  isWorkspaceUncertain: boolean;
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
  commitSource: (id: string, source: QuestionItem["source"]) => boolean;
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
  bookFilters: string[];
  reviewPriorityFilters: string[];
  reviewStatusFilters: string[];
  search: string;
  listMode: QuestionListMode;
  setChapterFilters: (value: string[]) => void;
  setTagFilters: (value: string[]) => void;
  setBookFilters: (value: string[]) => void;
  setReviewPriorityFilters: (value: string[]) => void;
  setReviewStatusFilters: (value: string[]) => void;
  setSearch: (value: string) => void;
  setListMode: (value: QuestionListMode) => void;
  clearFilters: () => void;
  toggleSelected: (id: string) => void;
  toggleAllVisible: () => void;
}

export interface AppViewContextValue {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
}

export interface BankSettingsContextValue {
  chapters: Chapter[];
  books: BookRecord[];
  createChapter: (name: string) => string | null;
  renameChapter: (id: string, name: string) => boolean;
  moveChapter: (id: string, direction: -1 | 1) => void;
  moveChapterToIndex: (id: string, targetIndex: number) => void;
  deleteChapter: (id: string) => void;
  createBook: (title: string) => string | null;
  renameBook: (id: string, title: string) => boolean;
  setBookPaths: (
    id: string,
    patch: Pick<BookRecord, "filePath" | "answerBookPath">
  ) => void;
  deleteBook: (id: string) => void;
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
  bankSettings: BankSettingsContextValue;
}
