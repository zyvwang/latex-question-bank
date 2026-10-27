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
import {
  isRecord,
  parseStringArray,
  ValidationError
} from "./validation-primitives.js";

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

  return buildBankFromLegacy({
    settings: bank.settings,
    chapters,
    sourceItems: items
  });
}

export function migrateV2Bank(bank: LegacyBankV2): Bank {
  return buildBankFromLegacy({
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

// v3 与 v4 只差题目上的标签字段：这里只把 tags 拆成 topics/questionTypes，
// 其余字段原样交给 v4 解析器做完整校验。
export function upgradeV3Payload(
  value: Record<string, unknown>
): Record<string, unknown> {
  if (!Array.isArray(value.items)) throw new ValidationError("题库 items 必须是数组。");
  return {
    ...value,
    version: 4,
    items: value.items.map((item: unknown) => {
      if (!isRecord(item)) return item;
      const { tags, ...rest } = item;
      return {
        ...rest,
        ...splitLegacyTags(parseStringArray(tags, "tags"), "drop")
      };
    })
  };
}

const TOPIC_TAG_PREFIX = "考点·";
const TYPE_TAG_PREFIX = "题型·";

// v3 用「考点·」「题型·」前缀区分维度；「考法·」和自由标签已不再保存。
// v1/v2 早于前缀约定，那时的无前缀标签实际就是考点，所以保留为考点。
export function splitLegacyTags(
  tags: readonly string[],
  unprefixed: "topics" | "drop"
): Pick<QuestionItem, "topics" | "questionTypes"> {
  const topics: string[] = [];
  const questionTypes: string[] = [];
  const push = (target: string[], raw: string) => {
    const value = raw.trim();
    if (value && !isReservedTag(value) && !target.includes(value)) target.push(value);
  };
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.startsWith(TOPIC_TAG_PREFIX)) {
      push(topics, trimmed.slice(TOPIC_TAG_PREFIX.length));
    } else if (trimmed.startsWith(TYPE_TAG_PREFIX)) {
      push(questionTypes, trimmed.slice(TYPE_TAG_PREFIX.length));
    } else if (unprefixed === "topics" && !trimmed.startsWith("考法·")) {
      push(topics, trimmed);
    }
  }
  return { topics, questionTypes };
}

function buildBankFromLegacy(input: {
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
    // v2 allowed duplicate source numbers. v3+ requires book+label uniqueness,
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
      ...splitLegacyTags(item.tags, "topics"),
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
    version: 4,
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
