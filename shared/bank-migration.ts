import type {
  Bank,
  BookRecord,
  Chapter,
  LegacyBank,
  LegacyBankV2,
  QuestionItem
} from "./types.js";
import {
  normalizeBookTitle,
  normalizeUniqueName
} from "./names.js";
import {
  parseLegacySourceNumber,
  sourceKey
} from "./question-source.js";
import { isReservedTag } from "./review-fields.js";

interface MigrationSourceItem {
  id: string;
  sourceNumber?: string;
  chapterId: string | null;
  chapterOrder: number;
  tags: string[];
  modules: QuestionItem["modules"];
  assets: QuestionItem["assets"];
  createdAt: string;
  updatedAt: string;
}

export function migrateLegacyBank(bank: LegacyBank): Bank {
  const legacyItems = [...bank.items].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const chapters: Chapter[] = [];
  const chapterByName = new Map<string, Chapter>();
  const usedChapterIds = new Set<string>();

  for (const item of legacyItems) {
    const displayName = item.chapter.trim().normalize("NFKC");
    const normalizedName = normalizeUniqueName(displayName);
    if (!normalizedName || chapterByName.has(normalizedName)) continue;
    const chapter: Chapter = {
      id: deterministicId("chapter", normalizedName, usedChapterIds),
      name: displayName,
      order: chapters.length + 1
    };
    chapters.push(chapter);
    chapterByName.set(normalizedName, chapter);
  }

  const nextOrder = new Map<string | null, number>();
  const items: MigrationSourceItem[] = legacyItems.map((item) => {
    const chapterName = normalizeUniqueName(item.chapter);
    const chapterId = chapterName
      ? (chapterByName.get(chapterName)?.id ?? null)
      : null;
    const chapterOrder = (nextOrder.get(chapterId) ?? 0) + 1;
    nextOrder.set(chapterId, chapterOrder);
    return {
      id: item.id,
      sourceNumber: item.sourceNumber,
      chapterId,
      chapterOrder,
      tags: [...item.tags],
      modules: {
        question: { ...item.modules.question },
        solution: { ...item.modules.solution },
        note: { ...item.modules.note }
      },
      assets: item.assets.map((asset) => ({ ...asset })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  });

  return buildV3Bank({
    settings: bank.settings,
    chapters,
    sourceItems: items
  });
}

export function migrateV2Bank(bank: LegacyBankV2): Bank {
  return buildV3Bank({
    settings: bank.settings,
    chapters: bank.chapters,
    sourceItems: bank.items.map((item) => ({
      id: item.id,
      sourceNumber: item.sourceNumber,
      chapterId: item.chapterId,
      chapterOrder: item.chapterOrder,
      tags: [...item.tags],
      modules: {
        question: { ...item.modules.question },
        solution: { ...item.modules.solution },
        note: { ...item.modules.note }
      },
      assets: item.assets.map((asset) => ({ ...asset })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  });
}

function buildV3Bank(input: {
  settings: Bank["settings"];
  chapters: Chapter[];
  sourceItems: MigrationSourceItem[];
}): Bank {
  const parsedSources = input.sourceItems.map((item) =>
    parseLegacySourceNumber(item.sourceNumber)
  );
  const books: BookRecord[] = [];
  const bookByTitle = new Map<string, BookRecord>();
  const usedBookIds = new Set<string>();
  const timestamp = migrationTimestamp(input.sourceItems);

  for (const parsed of parsedSources) {
    if (!parsed?.title) continue;
    const normalizedTitle = normalizeBookTitle(parsed.title);
    if (!normalizedTitle || bookByTitle.has(normalizedTitle)) continue;
    const book: BookRecord = {
      id: deterministicId("book", normalizedTitle, usedBookIds),
      title: parsed.title,
      filePath: null,
      fileHash: null,
      answerBookPath: null,
      answerBookHash: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    books.push(book);
    bookByTitle.set(normalizedTitle, book);
  }

  const usedSourceKeys = new Set<string>();
  const items: QuestionItem[] = input.sourceItems.map((item, index) => {
    const parsed = parsedSources[index];
    const book = parsed?.title
      ? (bookByTitle.get(normalizeBookTitle(parsed.title)) ?? null)
      : null;
    const key = parsed ? sourceKey(book?.id ?? null, parsed.label) : null;
    // v2 allowed duplicate source numbers. v3 requires book+label uniqueness,
    // so duplicates keep the visible label but lose the book link instead of
    // making the whole bank unreadable.
    const duplicate = key !== null && usedSourceKeys.has(key);
    if (key && !duplicate) usedSourceKeys.add(key);
    const pending = item.tags.some((tag) => isReservedTag(tag));
    return {
      id: item.id,
      source: parsed
        ? {
            bookId: duplicate ? null : (book?.id ?? null),
            label: parsed.label
          }
        : null,
      chapterId: item.chapterId,
      chapterOrder: item.chapterOrder,
      tags: item.tags.filter((tag) => !isReservedTag(tag)),
      reviewPriority: null,
      reviewStatus: pending ? "pending" : "approved",
      solutionSource: null,
      solutionRef: null,
      variantOf: null,
      importBatchId: null,
      importedAt: null,
      modules: item.modules,
      assets: item.assets,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  });

  return {
    version: 3,
    settings: {
      ...input.settings,
      spacing: { ...input.settings.spacing }
    },
    chapters: input.chapters.map((chapter) => ({ ...chapter })),
    books,
    imports: [],
    items
  };
}

function migrationTimestamp(items: MigrationSourceItem[]): string {
  const timestamps = items
    .map((item) => item.createdAt)
    .filter((value) => value.trim())
    .sort();
  return timestamps[0] ?? "1970-01-01T00:00:00.000Z";
}

function deterministicId(
  prefix: "chapter" | "book",
  normalizedName: string,
  usedIds: Set<string>
): string {
  const base = `${prefix}-${fnv1a32(normalizedName)
    .toString(16)
    .padStart(8, "0")}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
