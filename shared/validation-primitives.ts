export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export class ValidationError extends Error {}

export function invalid<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidLocalDateKey(value: string): boolean {
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

export function requiredString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ValidationError(`${key} 必须是字符串。`);
  }
  return value;
}

export function requiredNonEmptyString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = requiredString(record, key).trim();
  if (!value) throw new ValidationError(`${key} 不能为空。`);
  return value;
}

export function requiredRevision(
  record: Record<string, unknown>,
  key: string
): string {
  const value = requiredString(record, key);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ValidationError(`${key} 必须是 SHA-256 revision。`);
  }
  return value;
}

export function requiredFiniteNumber(
  record: Record<string, unknown>,
  key: string
): number {
  const value = record[key];
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${key} 必须是数字。`);
  }
  return Number(value);
}

export function requiredPositiveInteger(
  record: Record<string, unknown>,
  key: string
): number {
  const value = requiredFiniteNumber(record, key);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(`${key} 必须是正整数。`);
  }
  return value;
}

export function getOptionalStringField(
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

export function parseStringArray(value: unknown, key: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new ValidationError(`${key} 必须是字符串数组。`);
  }
  return [...value];
}

export function nullableId(value: unknown, key: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${key} 必须是非空字符串或 null。`);
  }
  return value.trim();
}

export function pathBaseName(value: string): string {
  return value.replace(/\\/g, "/").split("/").pop() ?? "";
}

export function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
