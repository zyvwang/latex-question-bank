// Agent 导入的纯规划逻辑：不读写磁盘，只根据当前 bank 和清单算出新 bank 与摘要数据。
// 落盘、快照、加锁和广播在 agent-import-service.ts。
import { randomUUID } from "node:crypto";
import type {
  AgentImportManifest,
  AgentImportSummary,
  AgentImportWarning,
  AgentManifestBook,
  AgentManifestQuestion,
  AgentManifestSource
} from "../shared/agent-manifest.js";
import { nextChapterOrder } from "../shared/chapter-order.js";
import { mergeTags, normalizeUniqueName } from "../shared/names.js";
import {
  normalizeSourceLabel,
  sourceKey
} from "../shared/question-source.js";
import type {
  Bank,
  BookRecord,
  Chapter,
  ImportBatchRecord,
  QuestionAsset,
  QuestionItem,
  QuestionSource
} from "../shared/types.js";
import { ValidationError } from "../shared/validation-primitives.js";
import type { PreparedQuestionAsset } from "./asset-service.js";

export interface AssetPlan {
  assetsByKey: Map<string, QuestionAsset>;
  toWrite: PreparedQuestionAsset[];
}

export interface PlanInput {
  current: Bank;
  manifest: AgentImportManifest;
  batchId: string;
  now: string;
  overwrite: boolean;
  assetsByKey: Map<string, QuestionAsset>;
}

export interface PlanResult {
  bank: Bank;
  createdIds: string[];
  updatedIds: string[];
  conflicts: AgentImportSummary["conflicts"];
  warnings: AgentImportWarning[];
  chapterAssignments: AgentImportSummary["chapterAssignments"];
  bookTitles: Set<string>;
}

// 规划过程中会就地追加/改名书目，三个索引必须同步维护。
interface BookIndex {
  books: BookRecord[];
  bookById: Map<string, BookRecord>;
  bookByTitle: Map<string, BookRecord>;
  now: string;
}

interface ChapterIndex {
  chapterById: Map<string, Chapter>;
  chapterByName: Map<string, Chapter>;
}

interface ResolvedChapter {
  chapterId: string | null;
  provided: boolean;
  warning?: string;
}

export function collectUsedAssetKeys(manifest: AgentImportManifest): Set<string> {
  const keys = new Set<string>();
  for (const question of manifest.questions) {
    for (const key of collectQuestionAssetKeys(question)) keys.add(key);
  }
  return keys;
}

export function buildAssetPlan(
  current: Bank,
  usedKeys: Set<string>,
  preparedByKey: Map<string, PreparedQuestionAsset>
): AssetPlan {
  const existingBySha = new Map<string, QuestionAsset>();
  for (const item of current.items) {
    for (const asset of item.assets) {
      if (asset.sha256) existingBySha.set(asset.sha256, asset);
    }
  }
  const assetsByKey = new Map<string, QuestionAsset>();
  const preparedBySha = new Map<string, QuestionAsset>();
  const toWrite: PreparedQuestionAsset[] = [];
  for (const key of usedKeys) {
    const prepared = preparedByKey.get(key);
    if (!prepared) {
      throw new ValidationError(`附件占位符引用了不存在的 key：${key}`);
    }
    const sha = prepared.asset.sha256;
    if (!sha) throw new ValidationError("附件缺少内容哈希。");
    const existing = existingBySha.get(sha);
    if (existing) {
      assetsByKey.set(key, existing);
      continue;
    }
    const alreadyPrepared = preparedBySha.get(sha);
    if (alreadyPrepared) {
      assetsByKey.set(key, alreadyPrepared);
      continue;
    }
    assetsByKey.set(key, prepared.asset);
    preparedBySha.set(sha, prepared.asset);
    toWrite.push(prepared);
  }
  return { assetsByKey, toWrite };
}

export function planBank(input: PlanInput): PlanResult {
  const books = input.current.books.map((book) => ({ ...book }));
  const chapters = input.current.chapters.map((chapter) => ({ ...chapter }));
  const items = input.current.items.map((item) => ({
    ...item,
    topics: [...item.topics],
    questionTypes: [...item.questionTypes],
    assets: [...item.assets],
    modules: {
      question: { ...item.modules.question },
      solution: { ...item.modules.solution },
      note: { ...item.modules.note }
    }
  }));
  const bookIndex: BookIndex = {
    books,
    bookById: new Map(books.map((book) => [book.id, book])),
    bookByTitle: new Map(
      books.map((book) => [normalizeUniqueName(book.title), book])
    ),
    now: input.now
  };
  const chapterIndex: ChapterIndex = {
    chapterById: new Map(chapters.map((chapter) => [chapter.id, chapter])),
    chapterByName: new Map(
      chapters.map((chapter) => [normalizeUniqueName(chapter.name), chapter])
    )
  };
  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemBySource = new Map<string, QuestionItem>();
  for (const item of items) indexSource(itemBySource, item);
  const knownIds = new Set(items.map((item) => item.id));
  const bookTitles = new Set<string>();
  const conflicts: AgentImportSummary["conflicts"] = [];
  const warnings: AgentImportWarning[] = [];
  const chapterAssignments: AgentImportSummary["chapterAssignments"] = [];
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const manifestKeys = new Set<string>();
  const manifestIds = new Set<string>();

  for (const manifestBook of input.manifest.books ?? []) {
    upsertManifestBook(manifestBook, bookIndex);
  }

  for (const question of input.manifest.questions) {
    const source = resolveSource(question, bookIndex);
    if (source?.bookId) {
      const book = bookIndex.bookById.get(source.bookId);
      if (book) bookTitles.add(book.title);
    }
    const lookupKey = source
      ? sourceKey(source.bookId, source.label)
      : null;
    if (lookupKey) {
      if (manifestKeys.has(lookupKey)) {
        throw new ValidationError(
          `同一导入清单中来源题号重复：${source?.label ?? ""}`
        );
      }
      manifestKeys.add(lookupKey);
    }
    if (question.id) {
      if (manifestIds.has(question.id)) {
        throw new ValidationError(`同一导入清单中题目 ID 重复：${question.id}`);
      }
      manifestIds.add(question.id);
    }
    const target = resolveTarget(question, {
      itemById,
      itemBySource,
      lookupKey
    });
    const label = source?.label ?? question.id ?? "未命名题目";

    if (target && target.reviewStatus === "approved" && !input.overwrite) {
      conflicts.push({
        id: target.id,
        source: label,
        reason: "approved"
      });
      continue;
    }

    const chapter = resolveChapter(question, chapterIndex);
    if (chapter.warning) {
      warnings.push({
        code: "CHAPTER_NOT_FOUND",
        message: chapter.warning,
        question: label
      });
    }

    const questionAssets = collectQuestionAssetKeys(question).flatMap((key) => {
      const asset = input.assetsByKey.get(key);
      return asset ? [{ ...asset }] : [];
    });
    const context = { input, items, knownIds, question, source, chapter, questionAssets };

    let next: QuestionItem;
    if (target) {
      next = buildUpdatedItem(target, context);
      replaceItem(items, next);
      if (target.source) {
        const oldKey = sourceKey(target.source.bookId, target.source.label);
        if (oldKey && itemBySource.get(oldKey)?.id === target.id) {
          itemBySource.delete(oldKey);
        }
      }
      updatedIds.push(next.id);
    } else {
      next = buildNewItem(context);
      if (itemById.has(next.id)) {
        throw new ValidationError(`题目 ID 已存在：${next.id}`);
      }
      items.push(next);
      knownIds.add(next.id);
      createdIds.push(next.id);
    }
    itemById.set(next.id, next);
    indexSource(itemBySource, next);
    chapterAssignments.push({
      question: label,
      chapterId: next.chapterId,
      chapterName: next.chapterId
        ? (chapterIndex.chapterById.get(next.chapterId)?.name ?? null)
        : null
    });
  }

  return {
    bank: {
      ...input.current,
      books,
      chapters,
      items,
      imports: [...input.current.imports]
    },
    createdIds,
    updatedIds,
    conflicts,
    warnings,
    chapterAssignments,
    bookTitles
  };
}

export function mergeBatchRecord(
  existing: ImportBatchRecord,
  additions: ImportBatchRecord
): ImportBatchRecord {
  return {
    ...existing,
    note: additions.note ?? existing.note,
    bookTitles: uniqueUnion(existing.bookTitles, additions.bookTitles),
    newCount: existing.newCount + additions.newCount,
    updatedCount: existing.updatedCount + additions.updatedCount,
    skippedCount: existing.skippedCount + additions.skippedCount,
    conflictCount: existing.conflictCount + additions.conflictCount,
    itemIds: uniqueUnion(existing.itemIds, additions.itemIds),
    updatedItemIds: uniqueUnion(
      existing.updatedItemIds,
      additions.updatedItemIds
    ),
    status:
      existing.status === "partial" || additions.status === "partial"
        ? "partial"
        : "completed",
    undoneAt: null
  };
}

interface ItemContext {
  input: PlanInput;
  items: QuestionItem[];
  knownIds: Set<string>;
  question: AgentManifestQuestion;
  source: QuestionSource | null;
  chapter: ResolvedChapter;
  questionAssets: QuestionAsset[];
}

function buildUpdatedItem(target: QuestionItem, context: ItemContext): QuestionItem {
  const { input, items, knownIds, question, source, chapter, questionAssets } = context;
  const moving = chapter.provided && chapter.chapterId !== target.chapterId && chapter.chapterId !== null;
  const substitute = (tex: string) => substituteAssets(tex, input.assetsByKey);
  const modules = {
    ...target.modules,
    question: { tex: substitute(question.modules.question.tex) },
    ...(question.modules.solution
      ? { solution: { tex: substitute(question.modules.solution.tex) } }
      : {}),
    ...(question.modules.note
      ? { note: { tex: substitute(question.modules.note.tex) } }
      : {})
  };
  const next: QuestionItem = {
    ...target,
    source: Object.hasOwn(question, "source")
      ? source
      : target.source,
    chapterId: moving ? chapter.chapterId : target.chapterId,
    chapterOrder: moving
      ? nextChapterOrder(items, chapter.chapterId)
      : target.chapterOrder,
    topics: mergeTags(target.topics, question.topics ?? []),
    questionTypes: mergeTags(target.questionTypes, question.questionTypes ?? []),
    reviewPriority: target.reviewPriority,
    reviewStatus: "pending",
    solutionSource: question.solutionSource ?? target.solutionSource,
    solutionRef: Object.hasOwn(question, "solutionRef")
      ? (question.solutionRef ?? null)
      : target.solutionRef,
    variantOf: Object.hasOwn(question, "variantOf")
      ? (question.variantOf ?? null)
      : target.variantOf,
    importBatchId: input.batchId,
    importedAt: input.now,
    modules,
    assets: mergeAssets(target.assets, questionAssets),
    updatedAt: input.now
  };
  if (next.variantOf) {
    validateVariant(next.variantOf, knownIds, next.id);
  }
  return next;
}

function buildNewItem(context: ItemContext): QuestionItem {
  const { input, items, knownIds, question, source, chapter, questionAssets } = context;
  const id = question.id ?? randomUUID();
  const variantOf = question.variantOf ?? null;
  if (variantOf) validateVariant(variantOf, knownIds, id);
  const solutionTex = question.modules.solution?.tex ?? "";
  const substitute = (tex: string) => substituteAssets(tex, input.assetsByKey);
  return {
    id,
    source,
    chapterId: chapter.chapterId,
    chapterOrder: nextChapterOrder(items, chapter.chapterId),
    topics: question.topics ?? [],
    questionTypes: question.questionTypes ?? [],
    reviewPriority: question.reviewPriority ?? null,
    reviewStatus: "pending",
    solutionSource:
      question.solutionSource ?? (solutionTex.trim() ? null : "none"),
    solutionRef: question.solutionRef ?? null,
    variantOf,
    importBatchId: input.batchId,
    importedAt: input.now,
    modules: {
      question: { tex: substitute(question.modules.question.tex) },
      solution: { tex: substitute(solutionTex) },
      note: { tex: substitute(question.modules.note?.tex ?? "") }
    },
    assets: mergeAssets([], questionAssets),
    createdAt: input.now,
    updatedAt: input.now
  };
}

function indexSource(
  itemBySource: Map<string, QuestionItem>,
  item: QuestionItem
): void {
  if (!item.source) return;
  const key = sourceKey(item.source.bookId, item.source.label);
  if (key) itemBySource.set(key, item);
}

function resolveSource(
  question: AgentManifestQuestion,
  index: BookIndex
): QuestionSource | null {
  if (!question.source) return null;
  const book = resolveBook(question.source, index);
  return {
    bookId: book?.id ?? null,
    label: normalizeSourceLabel(question.source.label)
  };
}

function resolveBook(
  source: AgentManifestSource,
  index: BookIndex
): BookRecord | null {
  if (source.bookId) {
    const book = index.bookById.get(source.bookId);
    if (!book) {
      throw new ValidationError(`题目引用了不存在的书目：${source.bookId}`);
    }
    if (
      source.bookTitle &&
      normalizeUniqueName(book.title) !== normalizeUniqueName(source.bookTitle)
    ) {
      throw new ValidationError("source.bookId 与 source.bookTitle 不一致。");
    }
    return book;
  }
  if (source.bookTitle) {
    const existing = index.bookByTitle.get(normalizeUniqueName(source.bookTitle));
    return existing ?? createBook({ title: source.bookTitle }, index);
  }
  return null;
}

function resolveTarget(
  question: AgentManifestQuestion,
  context: {
    itemById: Map<string, QuestionItem>;
    itemBySource: Map<string, QuestionItem>;
    lookupKey: string | null;
  }
): QuestionItem | null {
  if (question.id) {
    const item = context.itemById.get(question.id);
    if (!item) {
      throw new ValidationError(`要更新的题目不存在：${question.id}`);
    }
    return item;
  }
  if (context.lookupKey) {
    return context.itemBySource.get(context.lookupKey) ?? null;
  }
  return null;
}

function resolveChapter(
  question: AgentManifestQuestion,
  index: ChapterIndex
): ResolvedChapter {
  const provided =
    question.chapterId !== undefined || question.chapterName !== undefined;
  if (!provided) return { chapterId: null, provided: false };
  if (question.chapterId) {
    const byId = index.chapterById.get(question.chapterId);
    if (!byId) {
      return {
        chapterId: null,
        provided: true,
        warning: `章节不存在：${question.chapterId}`
      };
    }
    if (
      question.chapterName &&
      normalizeUniqueName(byId.name) !== normalizeUniqueName(question.chapterName)
    ) {
      throw new ValidationError("chapterId 与 chapterName 不一致。");
    }
    return { chapterId: byId.id, provided: true };
  }
  if (question.chapterName) {
    const byName = index.chapterByName.get(
      normalizeUniqueName(question.chapterName)
    );
    if (!byName) {
      return {
        chapterId: null,
        provided: true,
        warning: `章节不存在：${question.chapterName}`
      };
    }
    return { chapterId: byName.id, provided: true };
  }
  return { chapterId: null, provided: true };
}

function upsertManifestBook(
  manifestBook: AgentManifestBook,
  index: BookIndex
): void {
  const byId = manifestBook.id
    ? index.bookById.get(manifestBook.id)
    : undefined;
  const existing =
    byId ?? index.bookByTitle.get(normalizeUniqueName(manifestBook.title));
  if (!existing) {
    createBook(manifestBook, index);
    return;
  }
  const previousKey = normalizeUniqueName(existing.title);
  existing.title = manifestBook.title;
  if (manifestBook.filePath !== undefined) {
    existing.filePath = manifestBook.filePath;
  }
  if (manifestBook.fileHash !== undefined) {
    existing.fileHash = manifestBook.fileHash;
  }
  if (manifestBook.answerBookPath !== undefined) {
    existing.answerBookPath = manifestBook.answerBookPath;
  }
  if (manifestBook.answerBookHash !== undefined) {
    existing.answerBookHash = manifestBook.answerBookHash;
  }
  existing.updatedAt = index.now;
  if (index.bookByTitle.get(previousKey) === existing) {
    index.bookByTitle.delete(previousKey);
  }
  index.bookByTitle.set(normalizeUniqueName(existing.title), existing);
}

function createBook(
  book: Pick<AgentManifestBook, "id" | "title" | "filePath" | "fileHash" | "answerBookPath" | "answerBookHash">,
  index: BookIndex
): BookRecord {
  const normalizedTitle = normalizeUniqueName(book.title);
  if (!normalizedTitle) {
    throw new ValidationError("书目名称不能为空。");
  }
  if (index.bookByTitle.has(normalizedTitle)) {
    throw new ValidationError(`书目名称重复：${book.title}`);
  }
  const id = book.id ?? `book-${randomUUID()}`;
  if (index.bookById.has(id)) {
    throw new ValidationError(`书目 ID 已存在：${id}`);
  }
  const record: BookRecord = {
    id,
    title: book.title,
    filePath: book.filePath ?? null,
    fileHash: book.fileHash ?? null,
    answerBookPath: book.answerBookPath ?? null,
    answerBookHash: book.answerBookHash ?? null,
    createdAt: index.now,
    updatedAt: index.now
  };
  index.books.push(record);
  index.bookById.set(id, record);
  index.bookByTitle.set(normalizedTitle, record);
  return record;
}

function collectQuestionAssetKeys(
  question: AgentManifestQuestion
): string[] {
  const keys = new Set(question.assets ?? []);
  for (const tex of [
    question.modules.question.tex,
    question.modules.solution?.tex ?? "",
    question.modules.note?.tex ?? ""
  ]) {
    for (const match of tex.matchAll(/\{\{asset:\s*([^}]*)\}\}/g)) {
      keys.add(match[1]?.trim() ?? "");
    }
  }
  return [...keys];
}

function substituteAssets(
  tex: string,
  assetsByKey: Map<string, QuestionAsset>
): string {
  return tex.replace(/\{\{asset:\s*([^}]*)\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const asset = assetsByKey.get(key);
    if (!asset) {
      throw new ValidationError(`附件占位符引用了不存在的 key：${key}`);
    }
    return asset.relativePath;
  });
}

function mergeAssets(
  existing: QuestionAsset[],
  added: QuestionAsset[]
): QuestionAsset[] {
  const values = [...existing];
  const ids = new Set(existing.map((asset) => asset.id));
  const hashes = new Set(
    existing
      .map((asset) => asset.sha256)
      .filter((hash): hash is string => Boolean(hash))
  );
  for (const asset of added) {
    if (ids.has(asset.id)) continue;
    if (asset.sha256 && hashes.has(asset.sha256)) continue;
    values.push(asset);
    ids.add(asset.id);
    if (asset.sha256) hashes.add(asset.sha256);
  }
  return values;
}

function replaceItem(items: QuestionItem[], next: QuestionItem): void {
  const index = items.findIndex((item) => item.id === next.id);
  if (index >= 0) items[index] = next;
}

function validateVariant(
  variantOf: string,
  knownIds: Set<string>,
  itemId: string
): void {
  if (variantOf === itemId) {
    throw new ValidationError("variantOf 不能指向题目自身。");
  }
  if (!knownIds.has(variantOf)) {
    throw new ValidationError(`variantOf 指向不存在的题目：${variantOf}`);
  }
}

function uniqueUnion(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}
