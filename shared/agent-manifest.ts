import { normalizeUniqueName } from "./names.js";
import { normalizeSourceLabel } from "./question-source.js";
import {
  isReservedTag,
  isReviewPriority,
  isSolutionSource
} from "./review-fields.js";
import { isAgentBatchId } from "./agent-undo.js";
import type {
  ReviewPriority,
  SolutionSource
} from "./types.js";
import {
  getOptionalStringField,
  hasControlCharacter,
  invalid,
  isRecord,
  parseStringArray,
  ValidationError,
  type ValidationResult
} from "./validation-primitives.js";

export interface AgentManifestBatch {
  id?: string;
  note?: string;
  agent?: string;
}

export interface AgentManifestBook {
  id?: string;
  title: string;
  filePath?: string;
  fileHash?: string;
  answerBookPath?: string;
  answerBookHash?: string;
}

export interface AgentManifestBank {
  name: string;
  path?: string;
  copySettingsFromCurrent?: boolean;
}

export interface AgentManifestChapter {
  name: string;
}

export interface AgentManifestSource {
  bookId?: string;
  bookTitle?: string;
  label: string;
}

export interface AgentManifestAsset {
  key: string;
  originalName: string;
  filePath?: string;
}

export interface AgentManifestQuestion {
  id?: string;
  source?: AgentManifestSource | null;
  chapterId?: string;
  chapterName?: string;
  tags?: string[];
  reviewPriority?: ReviewPriority | null;
  modules: {
    question: { tex: string };
    solution?: { tex: string };
    note?: { tex: string };
  };
  solutionSource?: SolutionSource;
  solutionRef?: string | null;
  variantOf?: string | null;
  assets?: string[];
}

export interface AgentImportManifest {
  schemaVersion: 1;
  batch?: AgentManifestBatch;
  bank?: AgentManifestBank;
  chapters?: AgentManifestChapter[];
  books?: AgentManifestBook[];
  assets?: AgentManifestAsset[];
  questions: AgentManifestQuestion[];
}

export interface AgentImportConflict {
  id?: string;
  source: string;
  reason: "approved";
}

export interface AgentImportWarning {
  code: string;
  message: string;
  question?: string;
}

export interface AgentImportCounts {
  created: number;
  updated: number;
  skipped: number;
  conflicts: number;
  assets: number;
}

export interface AgentImportChapterAssignment {
  question: string;
  chapterId: string | null;
  chapterName: string | null;
}

export interface AgentImportSummary {
  status: "completed" | "partial";
  dryRun: boolean;
  batchId: string | null;
  revision: string;
  counts: AgentImportCounts;
  conflicts: AgentImportConflict[];
  warnings: AgentImportWarning[];
  chapterAssignments: AgentImportChapterAssignment[];
  createdWorkspace?: {
    path: string;
    switched: boolean;
  };
}

const MAX_QUESTIONS = 200;
const MAX_ASSETS = 40;
const MAX_BOOKS = 50;
const MAX_CHAPTERS = 200;
const ASSET_KEY_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function validateAgentImportManifest(
  value: unknown
): ValidationResult<AgentImportManifest> {
  try {
    return { ok: true, value: parseManifest(value) };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

function parseManifest(value: unknown): AgentImportManifest {
  if (!isRecord(value)) throw new ValidationError("导入清单必须是对象。");
  if (value.schemaVersion !== 1) {
    throw new ValidationError("导入清单 schemaVersion 必须为 1。");
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    throw new ValidationError("导入清单必须包含至少一道题。");
  }
  if (value.questions.length > MAX_QUESTIONS) {
    throw new ValidationError(`单次导入最多 ${MAX_QUESTIONS} 道题。`);
  }
  const batch = parseBatch(value.batch);
  const bank = parseBank(value.bank);
  const chapters = parseChapters(value.chapters);
  const books = parseBooks(value.books);
  const assets = parseAssets(value.assets);
  const assetKeys = new Set(assets.map((asset) => asset.key));
  const questions = value.questions.map((question) =>
    parseQuestion(question, assetKeys)
  );
  return {
    schemaVersion: 1,
    ...(batch ? { batch } : {}),
    ...(bank ? { bank } : {}),
    ...(chapters.length ? { chapters } : {}),
    ...(books.length ? { books } : {}),
    ...(assets.length ? { assets } : {}),
    questions
  };
}

function parseBank(value: unknown): AgentManifestBank | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new ValidationError("bank 必须是对象。");
  const name = requiredString(value, "name").normalize("NFKC");
  if (hasControlCharacter(name)) {
    throw new ValidationError("bank.name 含有无效字符。");
  }
  const pathValue = optionalString(value, "path");
  const copySettingsFromCurrent = value.copySettingsFromCurrent;
  if (
    copySettingsFromCurrent !== undefined &&
    typeof copySettingsFromCurrent !== "boolean"
  ) {
    throw new ValidationError("bank.copySettingsFromCurrent 必须是布尔值。");
  }
  return {
    name,
    ...(pathValue ? { path: pathValue } : {}),
    ...(typeof copySettingsFromCurrent === "boolean"
      ? { copySettingsFromCurrent }
      : {})
  };
}

function parseChapters(value: unknown): AgentManifestChapter[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("chapters 必须是数组。");
  if (value.length > MAX_CHAPTERS) {
    throw new ValidationError(`单次导入最多 ${MAX_CHAPTERS} 个章节。`);
  }
  const names = new Set<string>();
  return value.map((chapter, index) => {
    if (!isRecord(chapter)) {
      throw new ValidationError(`chapters[${index}] 必须是对象。`);
    }
    const name = requiredString(chapter, "name").normalize("NFKC");
    if (hasControlCharacter(name)) {
      throw new ValidationError(`章节名称无效：${name}`);
    }
    const key = normalizeUniqueName(name);
    if (names.has(key)) {
      throw new ValidationError(`章节名称重复：${name}`);
    }
    names.add(key);
    return { name };
  });
}

function parseBatch(value: unknown): AgentManifestBatch | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new ValidationError("batch 必须是对象。");
  const id = optionalString(value, "id");
  if (id && !isAgentBatchId(id)) {
    throw new ValidationError("batch.id 只能包含字母、数字、点、下划线和短横线。");
  }
  return {
    ...(id ? { id } : {}),
    ...(optionalString(value, "note")
      ? { note: optionalString(value, "note") }
      : {}),
    ...(optionalString(value, "agent")
      ? { agent: optionalString(value, "agent") }
      : {})
  };
}

function parseBooks(value: unknown): AgentManifestBook[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("books 必须是数组。");
  if (value.length > MAX_BOOKS) {
    throw new ValidationError(`单次导入最多 ${MAX_BOOKS} 本书目。`);
  }
  const titles = new Set<string>();
  return value.map((book, index) => {
    if (!isRecord(book)) throw new ValidationError(`books[${index}] 必须是对象。`);
    const title = requiredString(book, "title").normalize("NFKC");
    const normalizedTitle = title.toLocaleLowerCase("en-US");
    if (titles.has(normalizedTitle)) {
      throw new ValidationError(`书目名称重复：${title}`);
    }
    titles.add(normalizedTitle);
    return {
      ...(optionalString(book, "id") ? { id: optionalString(book, "id") } : {}),
      title,
      ...optionalPath(book, "filePath"),
      ...optionalHash(book, "fileHash"),
      ...optionalPath(book, "answerBookPath"),
      ...optionalHash(book, "answerBookHash")
    };
  });
}

function parseAssets(value: unknown): AgentManifestAsset[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("assets 必须是数组。");
  if (value.length > MAX_ASSETS) {
    throw new ValidationError(`单次导入最多 ${MAX_ASSETS} 个附件。`);
  }
  const keys = new Set<string>();
  return value.map((asset, index) => {
    if (!isRecord(asset)) throw new ValidationError(`assets[${index}] 必须是对象。`);
    const key = requiredString(asset, "key");
    if (!ASSET_KEY_PATTERN.test(key)) {
      throw new ValidationError(`附件 key 无效：${key}`);
    }
    if (keys.has(key)) throw new ValidationError(`附件 key 重复：${key}`);
    keys.add(key);
    const originalName = requiredString(asset, "originalName");
    if (hasControlCharacter(originalName)) {
      throw new ValidationError(`附件原始文件名无效：${originalName}`);
    }
    return {
      key,
      originalName,
      ...(optionalString(asset, "filePath")
        ? { filePath: optionalString(asset, "filePath") }
        : {})
    };
  });
}

function parseQuestion(
  value: unknown,
  assetKeys: Set<string>
): AgentManifestQuestion {
  if (!isRecord(value)) throw new ValidationError("questions 中的题目必须是对象。");
  const modules = parseModules(value.modules);
  const solutionSource = parseSolutionSource(value.solutionSource);
  if (modules.solution?.tex.trim() && !solutionSource) {
    throw new ValidationError("有解答内容时必须提供 solutionSource。");
  }
  const tags = parseStringArray(value.tags ?? [], "tags");
  if (tags.some((tag) => isReservedTag(tag))) {
    throw new ValidationError("「待审阅」是保留标签，请使用审阅状态。");
  }
  const questionAssets = parseQuestionAssets(value.assets, assetKeys);
  return {
    ...(optionalString(value, "id") ? { id: optionalString(value, "id") } : {}),
    ...(Object.hasOwn(value, "source")
      ? { source: parseSource(value.source) }
      : {}),
    ...(optionalString(value, "chapterId")
      ? { chapterId: optionalString(value, "chapterId") }
      : {}),
    ...(optionalString(value, "chapterName")
      ? { chapterName: optionalString(value, "chapterName") }
      : {}),
    tags,
    reviewPriority: parsePriority(value.reviewPriority),
    modules,
    ...(solutionSource ? { solutionSource } : {}),
    ...(Object.hasOwn(value, "solutionRef")
      ? { solutionRef: optionalNullableString(value, "solutionRef") }
      : {}),
    ...(Object.hasOwn(value, "variantOf")
      ? { variantOf: optionalNullableString(value, "variantOf") }
      : {}),
    assets: questionAssets
  };
}

function parseSource(value: unknown): AgentManifestSource | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new ValidationError("source 必须是对象或 null。");
  const label = normalizeSourceLabel(requiredString(value, "label"));
  if (!label) throw new ValidationError("source.label 不能为空。");
  return {
    ...(optionalString(value, "bookId")
      ? { bookId: optionalString(value, "bookId") }
      : {}),
    ...(optionalString(value, "bookTitle")
      ? { bookTitle: requiredString(value, "bookTitle").normalize("NFKC") }
      : {}),
    label
  };
}

function parseModules(value: unknown): AgentManifestQuestion["modules"] {
  if (!isRecord(value)) throw new ValidationError("题目缺少 modules。");
  const question = parseModule(value.question, "question");
  if (!question) throw new ValidationError("题目缺少 question 模块。");
  const solution = parseModule(value.solution, "solution");
  const note = parseModule(value.note, "note");
  return {
    question,
    ...(solution ? { solution } : {}),
    ...(note ? { note } : {})
  };
}

function parseModule(
  value: unknown,
  kind: "question" | "solution" | "note"
): { tex: string } | undefined {
  if (value === undefined || value === null) {
    if (kind === "question") throw new ValidationError("题目缺少 question 模块。");
    return undefined;
  }
  if (!isRecord(value)) throw new ValidationError(`${kind} 模块必须是对象。`);
  const tex = value.tex;
  if (typeof tex !== "string") {
    throw new ValidationError(`${kind}.tex 必须是字符串。`);
  }
  if (kind === "question" && !tex.trim()) {
    throw new ValidationError("question 模块不能为空。");
  }
  return { tex };
}

function parseQuestionAssets(
  value: unknown,
  assetKeys: Set<string>
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((key) => typeof key === "string")) {
    throw new ValidationError("题目 assets 必须是字符串数组。");
  }
  const keys = value.map((key) => key.trim());
  if (keys.some((key) => !assetKeys.has(key))) {
    throw new ValidationError("题目引用了清单中不存在的附件 key。");
  }
  if (new Set(keys).size !== keys.length) {
    throw new ValidationError("题目 assets 不得重复。");
  }
  return keys;
}

function parsePriority(value: unknown): ReviewPriority | null {
  if (value === undefined || value === null) return null;
  if (!isReviewPriority(value)) {
    throw new ValidationError("reviewPriority 必须是 skip、recheck、must 或 null。");
  }
  return value;
}

function parseSolutionSource(value: unknown): SolutionSource | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isSolutionSource(value)) {
    throw new ValidationError("solutionSource 取值无效。");
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = getOptionalStringField(record, key);
  if (value instanceof ValidationError) throw value;
  return value;
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string
): string | null {
  return optionalString(record, key) ?? null;
}

function requiredString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${key} 必须是非空字符串。`);
  }
  return value.trim();
}

function optionalPath(
  record: Record<string, unknown>,
  key: string
): Record<string, string> {
  const value = optionalString(record, key);
  return value ? { [key]: value } : {};
}

function optionalHash(
  record: Record<string, unknown>,
  key: string
): Record<string, string> {
  const value = optionalString(record, key);
  if (!value) return {};
  const hash = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new ValidationError(`${key} 必须是 SHA-256 十六进制字符串。`);
  }
  return { [key]: hash };
}
