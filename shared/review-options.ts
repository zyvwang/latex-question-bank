import type { ReviewOption } from "./types.js";

export const UNSET_REVIEW_COLOR = "#858681";

export const DEFAULT_MASTERY_OPTIONS: ReviewOption[] = [
  {
    id: "mastery-easy",
    name: "很简单",
    order: 1,
    color: "#2F766F",
    pattern: "solid"
  },
  {
    id: "mastery-challenging",
    name: "有难度",
    order: 2,
    color: "#A56A00",
    pattern: "diagonal"
  },
  {
    id: "mastery-hard",
    name: "太难了",
    order: 3,
    color: "#B84A3A",
    pattern: "crosshatch"
  }
];

export const DEFAULT_ERROR_REASON_OPTIONS: ReviewOption[] = [
  {
    id: "error-calculation",
    name: "计算问题",
    order: 1,
    color: "#A9571C",
    pattern: "diagonal"
  },
  {
    id: "error-knowledge",
    name: "知识问题",
    order: 2,
    color: "#3F6FA8",
    pattern: "dots"
  },
  {
    id: "error-method",
    name: "方法问题",
    order: 3,
    color: "#74558F",
    pattern: "crosshatch"
  }
];

export function cloneDefaultMasteryOptions(): ReviewOption[] {
  return DEFAULT_MASTERY_OPTIONS.map((option) => ({ ...option }));
}

export function cloneDefaultErrorReasonOptions(): ReviewOption[] {
  return DEFAULT_ERROR_REASON_OPTIONS.map((option) => ({ ...option }));
}

export function normalizeUniqueName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function hasUniqueNormalizedNames(values: Array<{ name: string }>): boolean {
  const names = new Set<string>();
  for (const value of values) {
    const name = normalizeUniqueName(value.name);
    if (!name || names.has(name)) return false;
    names.add(name);
  }
  return true;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

export function normalizeReviewOptionOrder(options: ReviewOption[]): ReviewOption[] {
  return [...options]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((option, index) => ({ ...option, order: index + 1 }));
}
