export interface QuestionAsset {
  id: string;
  fileName: string;
  originalName: string;
  relativePath: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface QuestionModule {
  tex: string;
}

export type ModuleKind = "question" | "solution" | "note";

export type QuestionModules = Record<ModuleKind, QuestionModule>;

export type StarRating = 1 | 2 | 3 | 4 | 5;

export interface LegacyQuestionItem {
  id: string;
  order: number;
  sourceNumber?: string;
  chapter: string;
  tags: string[];
  star: StarRating;
  modules: QuestionModules;
  assets: QuestionAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface LegacyBank {
  version: 1;
  settings: LatexSettings;
  items: LegacyQuestionItem[];
}

export interface Chapter {
  id: string;
  name: string;
  order: number;
}

export type ReviewPattern = "solid" | "dots" | "diagonal" | "crosshatch";

export interface ReviewOption {
  id: string;
  name: string;
  order: number;
  color: string;
  pattern: ReviewPattern;
}

export interface QuestionItem {
  id: string;
  sourceNumber?: string;
  chapterId: string | null;
  chapterOrder: number;
  tags: string[];
  masteryOptionId: string | null;
  errorReasonOptionIds: string[];
  modules: QuestionModules;
  assets: QuestionAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface LatexSettings {
  preamble: string;
  pageSize: "a4";
  spacing: {
    item: string;
    module: string;
  };
}

export interface Bank {
  version: 2;
  settings: LatexSettings;
  chapters: Chapter[];
  masteryOptions: ReviewOption[];
  errorReasonOptions: ReviewOption[];
  masteryHistory: MasteryHistoryEntry[];
  items: QuestionItem[];
}

export interface MasteryHistoryItemState {
  masteryOptionId: string | null;
  errorReasonOptionIds: string[];
}

export interface MasteryHistoryEntry {
  id: string;
  localDate: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  masteryOptions: ReviewOption[];
  errorReasonOptions: ReviewOption[];
  itemStates: Record<string, MasteryHistoryItemState>;
}

export interface BankSnapshot {
  workspacePath: string;
  revision: string;
  bank: Bank;
}

export interface BankHead {
  workspacePath: string;
  revision: string;
}

export interface SaveBankRequest {
  workspacePath: string;
  baseRevision: string;
  bank: Bank;
}

export interface SaveBankAsRequest {
  sourceWorkspacePath: string;
  targetWorkspacePath: string;
  bank: Bank;
}

export interface WorkspaceRelocateRequest {
  workspacePath: string;
  replacementPath: string;
}

export interface AppState {
  version: 1;
  currentWorkspacePath?: string;
  recentWorkspacePaths: string[];
  texPathOverride?: string;
}

export interface WorkspaceSummary {
  name: string;
  path: string;
  exists: boolean;
}

export interface TexStatus {
  available: boolean;
  missingCommand?: "latexmk" | "xelatex";
  command?: string;
  source: "override" | "path" | "common" | "missing";
  version?: string;
  message: string;
}

export interface AppInfo {
  appState: AppState;
  currentWorkspaceName: string;
  currentWorkspacePath: string;
  recentWorkspaces: WorkspaceSummary[];
  texStatus: TexStatus;
  isDesktop: boolean;
  setupRequired: boolean;
}

export interface WorkspaceTransitionResponse {
  appInfo: AppInfo;
  snapshot: BankSnapshot | null;
}

export interface SaveBankAsResponse extends WorkspaceTransitionResponse {
  snapshot: BankSnapshot;
}

export interface CompileResult {
  ok: boolean;
  texPath: string;
  pdfPath?: string;
  log: string;
}

export interface CompileResponse extends CompileResult {
  texUrl?: string;
  pdfUrl?: string;
}

export interface ExportResponse {
  ok: boolean;
  exportName: string;
  exportPath: string;
  files: string[];
  results: {
    questions: CompileResponse;
    full: CompileResponse;
  };
}

export interface ExportDefaultNameResponse {
  exportName: string;
}

export interface RevealExportRequest {
  exportName: string;
}

export interface RecoveryCandidate {
  id: string;
  label: string;
  createdAt: string;
  source: "backup" | "history";
}

export interface RecoverBankRequest {
  workspacePath: string;
  candidateId: string;
}

export interface AssetUploadResponse {
  asset: QuestionAsset;
  url: string;
  insertText: string;
}

export interface WorkspacePathRequest {
  workspacePath: string;
}

export interface WorkspaceMoveRequest extends WorkspacePathRequest {
  direction: "up" | "down";
}

export interface TexPathRequest {
  texPath?: string;
}

export interface CompileItemRequest {
  workspacePath: string;
  item: QuestionItem;
  settings: LatexSettings;
}

export interface ExportRequest {
  workspacePath: string;
  baseRevision: string;
  itemIds: string[];
  fileName: string;
  orderMode?: ExportOrderMode;
  randomSeed?: string;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
}

export type TexField = ModuleKind;
export type ExportOrderMode = "normal" | "random";
