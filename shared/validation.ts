import type {
  Bank,
  RecoverBankRequest,
  SaveBankRequest,
  CompileItemRequest,
  ExportOrderMode,
  ExportRequest,
  LatexSettings,
  ModuleKind,
  QuestionAsset,
  QuestionItem,
  RevealExportRequest,
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

export function validateBankPayload(value: unknown): ValidationResult<Bank> {
  try {
    return { ok: true, value: parseBank(value) };
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
        bank: parseBank(value.bank)
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

export function validateWorkspacePathRequest(value: unknown, missingMessage = "缺少工作区路径。"): ValidationResult<WorkspacePathRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const workspacePath = getStringField(value, "workspacePath");
  if (workspacePath === undefined) return invalid("workspacePath 必须是字符串。");
  if (!workspacePath) return invalid(missingMessage);
  return { ok: true, value: { workspacePath } };
}

export function validateWorkspaceMoveRequest(value: unknown): ValidationResult<WorkspaceMoveRequest> {
  const pathResult = validateWorkspacePathRequest(value);
  if (!pathResult.ok || !pathResult.value) return pathResult as ValidationResult<WorkspaceMoveRequest>;
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const direction = value.direction;
  if (direction !== "up" && direction !== "down") {
    return invalid("工作区移动方向必须是 up 或 down。");
  }
  return { ok: true, value: { workspacePath: pathResult.value.workspacePath, direction } };
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
  if (!Array.isArray(value.itemIds) || !value.itemIds.every((item) => typeof item === "string")) {
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

export function validateRevealExportRequest(value: unknown): ValidationResult<RevealExportRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const exportName = getStringField(value, "exportName");
  if (exportName === undefined) return invalid("exportName 必须是字符串。");
  if (!exportName) return invalid("缺少导出名。");
  return { ok: true, value: { exportName } };
}

function parseBank(value: unknown): Bank {
  if (!isRecord(value)) throw new ValidationError("题库数据必须是对象。");
  if (value.version !== 1) throw new ValidationError("题库版本必须为 1。");
  if (!Array.isArray(value.items)) throw new ValidationError("题库 items 必须是数组。");
  const items = value.items.map((item) => parseQuestionItem(item));
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new ValidationError(`题目 id 重复：${item.id}`);
    ids.add(item.id);
  }
  return {
    version: 1,
    settings: parseLatexSettings(value.settings),
    items: items
      .sort((left, right) => left.order - right.order)
      .map((item, index) => ({ ...item, order: index + 1 }))
  };
}

function parseQuestionItem(value: unknown): QuestionItem {
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

function parseModules(value: Record<string, unknown>): QuestionItem["modules"] {
  if (isRecord(value.modules)) {
    const invalidKind = Object.keys(value.modules).find(
      (kind) => kind !== "question" && kind !== "solution" && kind !== "note"
    );
    if (invalidKind) throw new ValidationError(`题目包含无效模块：${invalidKind}`);
    return {
      question: parseQuestionModule(value.modules.question, "question"),
      solution: parseQuestionModule(value.modules.solution, "solution"),
      note: parseQuestionModule(value.modules.note, "note")
    };
  }
  throw new ValidationError("题目缺少有效的 modules。");
}

function parseQuestionModule(value: unknown, kind: ModuleKind): { tex: string } {
  if (!isRecord(value)) throw new ValidationError(`题目 ${kind} 模块必须是对象。`);
  return { tex: requiredString(value, "tex") };
}

function parseAssets(value: unknown): QuestionAsset[] {
  if (!Array.isArray(value)) throw new ValidationError("题目 assets 必须是数组。");
  return value.map((asset) => parseQuestionAsset(asset));
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
  if (!isRecord(value) || !isRecord(value.spacing)) throw new ValidationError("缺少有效的 LaTeX 设置。");
  if (value.pageSize !== "a4") throw new ValidationError("pageSize 必须是 a4。");
  return {
    pageSize: "a4",
    preamble: requiredString(value, "preamble"),
    spacing: {
      item: requiredString(value.spacing, "item"),
      module: requiredString(value.spacing, "module")
    }
  };
}

function parseStarRating(value: unknown): QuestionItem["star"] {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ValidationError("题目星级必须是 1 到 5 的整数。");
  }
  return rating as QuestionItem["star"];
}

function parseStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ValidationError(`${key} 必须是字符串数组。`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new ValidationError(`${key} 必须是字符串。`);
  return value;
}

function requiredNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key).trim();
  if (!value) throw new ValidationError(`${key} 不能为空。`);
  return value;
}

function requiredRevision(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ValidationError(`${key} 必须是 SHA-256 revision。`);
  }
  return value;
}

function requiredFiniteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isFinite(value)) throw new ValidationError(`${key} 必须是数字。`);
  return Number(value);
}

function optionalExportOrderMode(value: unknown): ExportOrderMode | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "normal" || value === "random") return value;
  throw new ValidationError("导出顺序必须是 normal 或 random。");
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function getOptionalStringField(record: Record<string, unknown>, key: string): string | ValidationError | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return new ValidationError(`${key} 必须是字符串。`);
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
