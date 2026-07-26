import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import type { Bank } from "../shared/types.js";
import { validateBankPayload } from "../shared/validation.js";
import { StorageError } from "./storage-types.js";

/**
 * `.history/` 保留的磁盘快照份数。写侧的裁剪(bank-storage)和读侧的候选枚举
 * (recovery-storage)必须用同一个值,否则会列出已被裁掉的候选或漏列可恢复版本。
 */
export const MAX_HISTORY_SNAPSHOTS = 10;

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function safeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function revisionForContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function parseStoredBank(raw: string): Bank {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StorageError("bank.json 不是有效的 JSON。", "BANK_JSON_INVALID");
  }
  return requireValidBank(parsed);
}

export function requireValidBank(value: unknown): Bank {
  const validation = validateBankPayload(value);
  if (!validation.ok || !validation.value) {
    throw new StorageError(validation.error ?? "题库数据无效。", "BANK_INVALID");
  }
  return validation.value;
}
