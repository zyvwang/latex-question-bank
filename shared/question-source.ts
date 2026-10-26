import type { BookRecord, QuestionItem } from "./types.js";

export function normalizeSourceLabel(value: string): string {
  return value.trim().normalize("NFKC").replaceAll("．", ".");
}

export interface ParsedLegacySource {
  title: string;
  label: string;
}

/**
 * v2 的 sourceNumber 是「书名 + 题号」的自由文本。从末尾取最长题号后缀，
 * 这样 880高数 之类的数字书名不会被误当成题号。
 */
export function parseLegacySourceNumber(
  value: string | undefined
): ParsedLegacySource | null {
  const normalized = value?.trim().normalize("NFKC");
  if (!normalized) return null;
  const match = normalized.match(/([0-9]+(?:[.．][0-9A-Za-z]+)*)$/);
  if (!match || match.index === undefined) {
    const label = normalizeSourceLabel(normalized);
    return label ? { title: "", label } : null;
  }
  const label = normalizeSourceLabel(match[1]);
  if (!label) return null;
  return {
    title: normalized.slice(0, match.index).trim(),
    label
  };
}

export function sourceKey(bookId: string | null, label: string): string | null {
  if (!bookId) return null;
  return `${bookId}\u0000${normalizeSourceLabel(label)}`;
}

export function questionSourceDisplay(
  item: Pick<QuestionItem, "source" | "chapterOrder">,
  books: BookRecord[]
): string {
  if (item.source) {
    const label = normalizeSourceLabel(item.source.label);
    const book = item.source.bookId
      ? books.find((candidate) => candidate.id === item.source?.bookId)
      : null;
    if (book) return label ? `${book.title} ${label}` : book.title;
    if (label) return label;
  }
  return `第 ${item.chapterOrder} 题`;
}

export function questionSourceSearchText(
  item: Pick<QuestionItem, "source">,
  books: BookRecord[]
): string {
  if (!item.source) return "";
  const book = item.source.bookId
    ? books.find((candidate) => candidate.id === item.source?.bookId)
    : null;
  return [book?.title, item.source.label].filter(Boolean).join(" ");
}
