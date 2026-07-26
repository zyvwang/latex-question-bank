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
  LatexSettings,
  LegacyBank,
  LegacyQuestionItem,
  MasteryHistoryEntry,
  ModuleKind,
  QuestionAsset,
  QuestionItem,
  ReviewOption,
  ReviewPattern,
} from "./types.js";
import {
  getOptionalStringField,
  hasControlCharacter,
  invalid,
  isRecord,
  isValidLocalDateKey,
  nullableId,
  parseStringArray,
  pathBaseName,
  requiredFiniteNumber,
  requiredNonEmptyString,
  requiredPositiveInteger,
  requiredString,
  ValidationError,
  type ValidationResult
} from "./validation-primitives.js";

export function validateBankPayload(value: unknown): ValidationResult<Bank> {
  try {
    return { ok: true, value: parseStoredBank(value) };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

function parseStoredBank(value: unknown): Bank {
  if (!isRecord(value)) throw new ValidationError("题库数据必须是对象。");
  if (value.version === 1) return migrateLegacyBank(parseLegacyBank(value));
  if (value.version === 2) return parseV2Bank(value);
  throw new ValidationError("题库版本必须为 1 或 2。");
}

export function parseV2Bank(value: unknown): Bank {
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

export function parseQuestionItem(value: unknown): QuestionItem {
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

export function parseLatexSettings(value: unknown): LatexSettings {
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
