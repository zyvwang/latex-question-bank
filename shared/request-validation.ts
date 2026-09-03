import {
  parseLatexSettings,
  parseQuestionItem,
  parseV2Bank
} from "./bank-validation.js";
import type {
  CompileItemRequest,
  ExportOrderMode,
  ExportRequest,
  RecoverBankRequest,
  RevealExportRequest,
  SaveBankAsRequest,
  SaveBankRequest,
  TexPathRequest,
  WorkspaceMoveRequest,
  WorkspacePathRequest,
  WorkspaceRelocateRequest
} from "./types.js";
import {
  getOptionalStringField,
  invalid,
  isRecord,
  requiredNonEmptyString,
  requiredRevision,
  ValidationError,
  type ValidationResult
} from "./validation-primitives.js";

export function validateSaveBankRequest(
  value: unknown
): ValidationResult<SaveBankRequest> {
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

export function validateSaveBankAsRequest(
  value: unknown
): ValidationResult<SaveBankAsRequest> {
  try {
    if (!isRecord(value)) throw new ValidationError("请求体必须是对象。");
    return {
      ok: true,
      value: {
        sourceWorkspacePath: requiredNonEmptyString(
          value,
          "sourceWorkspacePath"
        ),
        targetWorkspacePath: requiredNonEmptyString(
          value,
          "targetWorkspacePath"
        ),
        bank: parseV2Bank(value.bank)
      }
    };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

export function validateRecoverBankRequest(
  value: unknown
): ValidationResult<RecoverBankRequest> {
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
  if (workspacePath === undefined) {
    return invalid("workspacePath 必须是字符串。");
  }
  if (!workspacePath) return invalid(missingMessage);
  return { ok: true, value: { workspacePath } };
}

export function validateWorkspaceMoveRequest(
  value: unknown
): ValidationResult<WorkspaceMoveRequest> {
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

export function validateWorkspaceRelocateRequest(
  value: unknown
): ValidationResult<WorkspaceRelocateRequest> {
  try {
    if (!isRecord(value)) throw new ValidationError("请求体必须是对象。");
    return {
      ok: true,
      value: {
        workspacePath: requiredNonEmptyString(value, "workspacePath"),
        replacementPath: requiredNonEmptyString(value, "replacementPath")
      }
    };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

export function validateTexPathRequest(
  value: unknown
): ValidationResult<TexPathRequest> {
  if (!isRecord(value)) return invalid("请求体必须是对象。");
  const texPath = getOptionalStringField(value, "texPath");
  if (texPath instanceof ValidationError) return invalid(texPath.message);
  return { ok: true, value: { texPath: texPath || undefined } };
}

export function validateCompileItemRequest(
  value: unknown
): ValidationResult<CompileItemRequest> {
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

export function validateExportRequest(
  value: unknown
): ValidationResult<ExportRequest> {
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
