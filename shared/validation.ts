import { migrateLegacyBank } from "./bank-migration.js";
import { normalizeChapterItemOrders } from "./chapter-order.js";
import {
  hasUniqueNormalizedNames,
  isHexColor,
  normalizeReviewOptionOrder
} from "./review-options.js";
import type {
  Bank,
  Chapter,
  CompileItemRequest,
  ExportOrderMode,
  ExportRequest,
  LatexSettings,
  LegacyBank,
  LegacyQuestionItem,
  MasteryHistoryEntry,
  ModuleKind,
  QuestionAsset,
  QuestionItem,
  RecoverBankRequest,
  ReviewOption,
  ReviewPattern,
  RevealExportRequest,
  SaveBankRequest,
  TexPathRequest,
  WorkspaceMoveRequest,
  WorkspacePathRequest
} from "./types.js";

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidLocalDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function validateBankPayload(value: unknown): ValidationResult<Bank> {
  try {
    return { ok: true, value: parseStoredBank(value) };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

export function validateSaveBankRequest(value: unknown): ValidationResult<SaveBankRequest> {
  try {
    if (!isRecord(value)) throw new ValidationError("请求体必须是对象。");
    return {
      ok: true,
      value: {
        workspacePath: requiredNonEmptyString(value, "workspacePath"),
        baseRevision: requiredRevision(value, "baseRevision"),
        bank: parseV2Bank(value.bank)
      }
    };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

export function validateRecoverBankRequest(value: unknown): ValidationResult<RecoverBankRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const candidateId = getStringField(value, "candidateId");
  if (candidateId === undefined) return invalid("candidateId 必须是字符串。");
  if (!candidateId) return invalid("缺少恢复候选。");
  return { ok: true, value: { candidateId } };
}

export function validateWorkspacePathRequest(
  value: unknown,
  missingMessage = "缺少工作区路径。"
): ValidationResult<WorkspacePathRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const workspacePath = getStringField(value, "workspacePath");
  if (workspacePath === undefined) return invalid("workspacePath 必须是字符串。");
  if (!workspacePath) return invalid(missingMessage);
  return { ok: true, value: { workspacePath } };
}

export function validateWorkspaceMoveRequest(value: unknown): ValidationResult<WorkspaceMoveRequest> {
  const pathResult = validateWorkspacePathRequest(value);
  if (!pathResult.ok || !pathResult.value) {
    return pathResult as ValidationResult<WorkspaceMoveRequest>;
  }
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const direction = value.direction;
  if (direction !== "up" && direction !== "down") {
    return invalid("工作区移动方向必须是 up 或 down。");
  }
  return {
    ok: true,
    value: { workspacePath: pathResult.value.workspacePath, direction }
  };
}

export function validateTexPathRequest(value: unknown): ValidationResult<TexPathRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const texPath = getOptionalStringField(value, "texPath");
  if (texPath instanceof ValidationError) return invalid(texPath.message);
  return { ok: true, value: { texPath: texPath || undefined } };
}

export function validateCompileItemRequest(value: unknown): ValidationResult<CompileItemRequest> {
  try {
    if (!isRecord(value)) throw new ValidationError("请求体必须是对象。");
    return {
      ok: true,
      value: {
        item: parseQuestionItem(value.item),
        settings: parseLatexSettings(value.settings)
      }
    };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

export function validateExportRequest(value: unknown): ValidationResult<ExportRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  if (
    !Array.isArray(value.itemIds) ||
    !value.itemIds.every((item) => typeof item === "string")
  ) {
    return invalid("导出题目列表必须是字符串数组。");
  }
  const fileName = getStringField(value, "fileName");
  if (fileName === undefined) return invalid("fileName 必须是字符串。");
  let orderMode: ExportOrderMode | undefined;
  try {
    orderMode = optionalExportOrderMode(value.orderMode);
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
  const randomSeed = getOptionalStringField(value, "randomSeed");
  if (randomSeed instanceof ValidationError) return invalid(randomSeed.message);
  return {
    ok: true,
    value: {
      itemIds: value.itemIds,
      fileName,
      orderMode,
      randomSeed: randomSeed || undefined
    }
  };
}

export function validateRevealExportRequest(
  value: unknown
): ValidationResult<RevealExportRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const exportName = getStringField(value, "exportName");
  if (exportName === undefined) return invalid("exportName 必须是字符串。");
  if (!exportName) return invalid("缺少导出名。");
  return { ok: true, value: { exportName } };
}

function parseStoredBank(value: unknown): Bank {
  if (!isRecord(value)) throw new ValidationError("题库数据必须是对象。");
  if (value.version === 1) return migrateLegacyBank(parseLegacyBank(value));
  if (value.version === 2) return parseV2Bank(value);
  throw new ValidationError("题库版本必须为 1 或 2。");
}

function parseV2Bank(value: unknown): Bank {
  if (!isRecord(value)) throw new ValidationError("题库数据必须是对象。");
  if (value.version !== 2) throw new ValidationError("保存的题库版本必须为 2。");
  if (!Array.isArray(value.chapters)) {
    throw new ValidationError("题库 chapters 必须是数组。");
  }
  if (!Array.isArray(value.masteryOptions)) {
    throw new ValidationError("题库 masteryOptions 必须是数组。");
  }
  if (!Array.isArray(value.errorReasonOptions)) {
    throw new ValidationError("题库 errorReasonOptions 必须是数组。");
  }
  if (!Array.isArray(value.masteryHistory)) {
    throw new ValidationError("题库 masteryHistory 必须是数组。");
  }
  if (!Array.isArray(value.items)) throw new ValidationError("题库 items 必须是数组。");

  const chapters = normalizeChapters(value.chapters.map(parseChapter));
  const masteryOptions = normalizeReviewOptionOrder(
    value.masteryOptions.map((option) => parseReviewOption(option, "掌握程度"))
  );
  const errorReasonOptions = normalizeReviewOptionOrder(
    value.errorReasonOptions.map((option) => parseReviewOption(option, "错误原因"))
  );
  assertUniqueIds(chapters, "章节");
  assertUniqueIds(masteryOptions, "掌握程度选项");
  assertUniqueIds(errorReasonOptions, "错误原因选项");
  if (!hasUniqueNormalizedNames(chapters)) {
    throw new ValidationError("章节名称必须唯一且不能为空。");
  }
  if (!hasUniqueNormalizedNames(masteryOptions)) {
    throw new ValidationError("掌握程度选项名称必须唯一且不能为空。");
  }
  if (!hasUniqueNormalizedNames(errorReasonOptions)) {
    throw new ValidationError("错误原因选项名称必须唯一且不能为空。");
  }

  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const masteryOptionIds = new Set(masteryOptions.map((option) => option.id));
  const errorReasonOptionIds = new Set(
    errorReasonOptions.map((option) => option.id)
  );
  const items = value.items.map(parseQuestionItem);
  assertUniqueIds(items, "题目");
  for (const item of items) {
    if (item.chapterId !== null && !chapterIds.has(item.chapterId)) {
      throw new ValidationError(`题目引用了不存在的章节：${item.chapterId}`);
    }
    if (
      item.masteryOptionId !== null &&
      !masteryOptionIds.has(item.masteryOptionId)
    ) {
      throw new ValidationError(
        `题目引用了不存在的掌握程度：${item.masteryOptionId}`
      );
    }
    if (
      item.errorReasonOptionIds.some((id) => !errorReasonOptionIds.has(id))
    ) {
      throw new ValidationError("题目引用了不存在的错误原因。");
    }
  }

  if (value.masteryHistory.length > 5) {
    throw new ValidationError("掌握历史最多保留五份。");
  }
  const masteryHistory = value.masteryHistory.map(parseMasteryHistoryEntry);
  assertUniqueIds(masteryHistory, "掌握历史");
  if (!hasUniqueNormalizedNames(masteryHistory)) {
    throw new ValidationError("掌握历史名称必须唯一且不能为空。");
  }
  const dates = new Set<string>();
  for (const entry of masteryHistory) {
    if (dates.has(entry.localDate)) {
      throw new ValidationError(`掌握历史日期重复：${entry.localDate}`);
    }
    dates.add(entry.localDate);
  }

  return {
    version: 2,
    settings: parseLatexSettings(value.settings),
    chapters,
    masteryOptions,
    errorReasonOptions,
    masteryHistory,
    items: normalizeChapterItemOrders(items)
  };
}

function parseLegacyBank(value: Record<string, unknown>): LegacyBank {
  if (value.version !== 1) throw new ValidationError("题库版本必须为 1。");
  if (!Array.isArray(value.items)) throw new ValidationError("题库 items 必须是数组。");
  const items = value.items.map(parseLegacyQuestionItem);
  assertUniqueIds(items, "题目");
  return {
    version: 1,
    settings: parseLatexSettings(value.settings),
    items
  };
}

function parseLegacyQuestionItem(value: unknown): LegacyQuestionItem {
  if (!isRecord(value)) throw new ValidationError("题目必须是对象。");
  const sourceNumber = getOptionalStringField(value, "sourceNumber");
  if (sourceNumber instanceof ValidationError) throw sourceNumber;
  return {
    id: requiredNonEmptyString(value, "id"),
    order: requiredFiniteNumber(value, "order"),
    sourceNumber,
    chapter: requiredString(value, "chapter"),
    tags: parseStringArray(value.tags, "tags"),
    star: parseStarRating(value.star),
    modules: parseModules(value),
    assets: parseAssets(value.assets),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt")
  };
}

function parseChapter(value: unknown): Chapter {
  if (!isRecord(value)) throw new ValidationError("章节必须是对象。");
  return {
    id: requiredNonEmptyString(value, "id"),
    name: requiredNonEmptyString(value, "name").normalize("NFKC"),
    order: requiredPositiveInteger(value, "order")
  };
}

function parseReviewOption(value: unknown, label: string): ReviewOption {
  if (!isRecord(value)) throw new ValidationError(`${label}选项必须是对象。`);
  const color = requiredString(value, "color").toUpperCase();
  if (!isHexColor(color)) {
    throw new ValidationError(`${label}颜色必须使用 #RRGGBB 格式。`);
  }
  return {
    id: requiredNonEmptyString(value, "id"),
    name: requiredNonEmptyString(value, "name").normalize("NFKC"),
    order: requiredPositiveInteger(value, "order"),
    color,
    pattern: parseReviewPattern(value.pattern)
  };
}

function parseReviewPattern(value: unknown): ReviewPattern {
  if (
    value !== "solid" &&
    value !== "dots" &&
    value !== "diagonal" &&
    value !== "crosshatch"
  ) {
    throw new ValidationError("图案类型无效。");
  }
  return value;
}

function parseQuestionItem(value: unknown): QuestionItem {
  if (!isRecord(value)) throw new ValidationError("题目必须是对象。");
  const sourceNumber = getOptionalStringField(value, "sourceNumber");
  if (sourceNumber instanceof ValidationError) throw sourceNumber;
  const chapterId = nullableId(value.chapterId, "chapterId");
  const masteryOptionId = nullableId(value.masteryOptionId, "masteryOptionId");
  const errorReasonOptionIds = parseStringArray(
    value.errorReasonOptionIds,
    "errorReasonOptionIds"
  );
  if (new Set(errorReasonOptionIds).size !== errorReasonOptionIds.length) {
    throw new ValidationError("errorReasonOptionIds 不得重复。");
  }
  return {
    id: requiredNonEmptyString(value, "id"),
    sourceNumber,
    chapterId,
    chapterOrder: requiredPositiveInteger(value, "chapterOrder"),
    tags: parseStringArray(value.tags, "tags"),
    masteryOptionId,
    errorReasonOptionIds,
    modules: parseModules(value),
    assets: parseAssets(value.assets),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt")
  };
}

function parseMasteryHistoryEntry(value: unknown): MasteryHistoryEntry {
  if (!isRecord(value)) throw new ValidationError("掌握历史必须是对象。");
  if (!Array.isArray(value.masteryOptions)) {
    throw new ValidationError("历史 masteryOptions 必须是数组。");
  }
  if (!Array.isArray(value.errorReasonOptions)) {
    throw new ValidationError("历史 errorReasonOptions 必须是数组。");
  }
  if (!isRecord(value.itemStates)) {
    throw new ValidationError("历史 itemStates 必须是对象。");
  }
  const masteryOptions = normalizeReviewOptionOrder(
    value.masteryOptions.map((option) => parseReviewOption(option, "历史掌握程度"))
  );
  const errorReasonOptions = normalizeReviewOptionOrder(
    value.errorReasonOptions.map((option) =>
      parseReviewOption(option, "历史错误原因")
    )
  );
  assertUniqueIds(masteryOptions, "历史掌握程度选项");
  assertUniqueIds(errorReasonOptions, "历史错误原因选项");
  if (
    !hasUniqueNormalizedNames(masteryOptions) ||
    !hasUniqueNormalizedNames(errorReasonOptions)
  ) {
    throw new ValidationError("历史选项名称必须唯一且不能为空。");
  }
  const masteryIds = new Set(masteryOptions.map((option) => option.id));
  const errorReasonIds = new Set(errorReasonOptions.map((option) => option.id));
  const itemStates: MasteryHistoryEntry["itemStates"] = {};
  for (const [itemId, stateValue] of Object.entries(value.itemStates)) {
    if (!itemId || !isRecord(stateValue)) {
      throw new ValidationError("历史题目状态无效。");
    }
    const masteryOptionId = nullableId(
      stateValue.masteryOptionId,
      "masteryOptionId"
    );
    const errorReasonOptionIds = parseStringArray(
      stateValue.errorReasonOptionIds,
      "errorReasonOptionIds"
    );
    if (
      masteryOptionId !== null &&
      !masteryIds.has(masteryOptionId)
    ) {
      throw new ValidationError("历史题目引用了不存在的掌握程度。");
    }
    if (errorReasonOptionIds.some((id) => !errorReasonIds.has(id))) {
      throw new ValidationError("历史题目引用了不存在的错误原因。");
    }
    if (new Set(errorReasonOptionIds).size !== errorReasonOptionIds.length) {
      throw new ValidationError("历史错误原因引用不得重复。");
    }
    itemStates[itemId] = { masteryOptionId, errorReasonOptionIds };
  }
  const localDate = requiredString(value, "localDate");
  if (!isValidLocalDateKey(localDate)) {
    throw new ValidationError("掌握历史 localDate 必须是有效的 YYYY-MM-DD 日期。");
  }
  return {
    id: requiredNonEmptyString(value, "id"),
    localDate,
    name: requiredNonEmptyString(value, "name").normalize("NFKC"),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
    masteryOptions,
    errorReasonOptions,
    itemStates
  };
}

function parseModules(
  value: Record<string, unknown>
): QuestionItem["modules"] {
  if (!isRecord(value.modules)) {
    throw new ValidationError("题目缺少有效的 modules。");
  }
  const invalidKind = Object.keys(value.modules).find(
    (kind) => kind !== "question" && kind !== "solution" && kind !== "note"
  );
  if (invalidKind) {
    throw new ValidationError(`题目包含无效模块：${invalidKind}`);
  }
  return {
    question: parseQuestionModule(value.modules.question, "question"),
    solution: parseQuestionModule(value.modules.solution, "solution"),
    note: parseQuestionModule(value.modules.note, "note")
  };
}

function parseQuestionModule(
  value: unknown,
  kind: ModuleKind
): { tex: string } {
  if (!isRecord(value)) {
    throw new ValidationError(`题目 ${kind} 模块必须是对象。`);
  }
  return { tex: requiredString(value, "tex") };
}

function parseAssets(value: unknown): QuestionAsset[] {
  if (!Array.isArray(value)) throw new ValidationError("题目 assets 必须是数组。");
  return value.map(parseQuestionAsset);
}

function parseQuestionAsset(value: unknown): QuestionAsset {
  if (!isRecord(value)) throw new ValidationError("素材必须是对象。");
  const fileName = requiredString(value, "fileName");
  const relativePath = requiredString(value, "relativePath");
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    hasControlCharacter(fileName) ||
    fileName !== pathBaseName(fileName)
  ) {
    throw new ValidationError("素材 fileName 必须是安全文件名。");
  }
  if (relativePath !== `assets/${fileName}`) {
    throw new ValidationError("素材 relativePath 必须指向 assets 目录中的对应文件。");
  }
  return {
    id: requiredString(value, "id"),
    fileName,
    originalName: requiredString(value, "originalName"),
    relativePath,
    mimeType: requiredString(value, "mimeType"),
    size: requiredFiniteNumber(value, "size"),
    uploadedAt: requiredString(value, "uploadedAt")
  };
}

function parseLatexSettings(value: unknown): LatexSettings {
  if (!isRecord(value) || !isRecord(value.spacing)) {
    throw new ValidationError("缺少有效的 LaTeX 设置。");
  }
  if (value.pageSize !== "a4") {
    throw new ValidationError("pageSize 必须是 a4。");
  }
  return {
    pageSize: "a4",
    preamble: requiredString(value, "preamble"),
    spacing: {
      item: requiredString(value.spacing, "item"),
      module: requiredString(value.spacing, "module")
    }
  };
}

function parseStarRating(value: unknown): LegacyQuestionItem["star"] {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ValidationError("题目星级必须是 1 到 5 的整数。");
  }
  return rating as LegacyQuestionItem["star"];
}

function parseStringArray(value: unknown, key: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new ValidationError(`${key} 必须是字符串数组。`);
  }
  return [...value];
}

function normalizeChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((chapter, index) => ({ ...chapter, order: index + 1 }));
}

function assertUniqueIds(
  values: Array<{ id: string }>,
  label: string
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new ValidationError(`${label} id 重复：${value.id}`);
    }
    ids.add(value.id);
  }
}

function nullableId(value: unknown, key: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${key} 必须是非空字符串或 null。`);
  }
  return value.trim();
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ValidationError(`${key} 必须是字符串。`);
  }
  return value;
}

function requiredNonEmptyString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = requiredString(record, key).trim();
  if (!value) throw new ValidationError(`${key} 不能为空。`);
  return value;
}

function requiredRevision(
  record: Record<string, unknown>,
  key: string
): string {
  const value = requiredString(record, key);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ValidationError(`${key} 必须是 SHA-256 revision。`);
  }
  return value;
}

function requiredFiniteNumber(
  record: Record<string, unknown>,
  key: string
): number {
  const value = record[key];
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${key} 必须是数字。`);
  }
  return Number(value);
}

function requiredPositiveInteger(
  record: Record<string, unknown>,
  key: string
): number {
  const value = requiredFiniteNumber(record, key);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(`${key} 必须是正整数。`);
  }
  return value;
}

function optionalExportOrderMode(
  value: unknown
): ExportOrderMode | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "normal" || value === "random") return value;
  throw new ValidationError("导出顺序必须是 normal 或 random。");
}

function getStringField(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function getOptionalStringField(
  record: Record<string, unknown>,
  key: string
): string | ValidationError | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    return new ValidationError(`${key} 必须是字符串。`);
  }
  return value.trim();
}

function invalid<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

export class ValidationError extends Error {}

function pathBaseName(value: string): string {
  return value.replace(/\\/g, "/").split("/").pop() ?? "";
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
