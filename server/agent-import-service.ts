import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type {
  AgentImportManifest,
  AgentImportSummary,
  AgentImportWarning,
  AgentManifestBook,
  AgentManifestQuestion,
  AgentManifestSource
} from "../shared/agent-manifest.js";
import { parseV3Bank } from "../shared/bank-validation.js";
import { normalizeUniqueName } from "../shared/names.js";
import {
  normalizeSourceLabel,
  sourceKey
} from "../shared/question-source.js";
import { isReservedTag } from "../shared/review-fields.js";
import type {
  Bank,
  BookRecord,
  ImportBatchRecord,
  QuestionAsset,
  QuestionItem,
  QuestionSource
} from "../shared/types.js";
import { ValidationError } from "../shared/validation-primitives.js";
import {
  prepareQuestionAsset,
  writePreparedAsset,
  type PreparedQuestionAsset,
  type UploadedFile
} from "./asset-service.js";
import {
  activateAgentWorkspace,
  assertAgentWorkspaceAvailable,
  buildAgentBank,
  resolveAgentWorkspacePath
} from "./agent-workspace-service.js";
import { createHistorySnapshot } from "./bank-storage.js";
import { broadcastBankChanged } from "./events.js";
import { writeJsonFileAtomic } from "./json-file.js";
import {
  parseStoredBank,
  revisionForContent,
  serializeJson
} from "./storage-utils.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import {
  createWorkspaceWithBank,
  getWorkspaceDirs,
  readAppState
} from "./workspace-storage.js";

export interface AgentImportInput {
  workspacePath: string;
  manifest: AgentImportManifest;
  files: UploadedFile[];
  dryRun: boolean;
  overwrite: boolean;
  baseRevision?: string;
  createBank?: boolean;
  switchWorkspace?: boolean;
}

interface PreparedAssetInputs {
  preparedByKey: Map<string, PreparedQuestionAsset>;
  usedKeys: Set<string>;
}

export async function applyAgentImport(
  input: AgentImportInput
): Promise<AgentImportSummary> {
  validateCreateBankMode(input);
  const prepared = await prepareAssetInputs(input.manifest, input.files);
  return input.createBank
    ? applyCreateBankImport(input, prepared)
    : applyCurrentBankImport(input, prepared);
}

function validateCreateBankMode(input: AgentImportInput): void {
  if (input.createBank) {
    if (!input.manifest.bank) {
      throw new ValidationError("--create-bank 需要清单提供 bank.name。");
    }
    return;
  }
  if (input.manifest.bank || (input.manifest.chapters?.length ?? 0) > 0) {
    throw new ValidationError(
      "清单中的 bank/chapters 只能与 --create-bank 一起使用。"
    );
  }
}

async function prepareAssetInputs(
  manifest: AgentImportManifest,
  files: UploadedFile[]
): Promise<PreparedAssetInputs> {
  const usedKeys = collectUsedAssetKeys(manifest);
  if (files.length !== (manifest.assets?.length ?? 0)) {
    throw new ValidationError("上传的附件数量与清单 assets 数量不一致。");
  }
  const preparedAssets = await Promise.all(
    files.map((file) => prepareQuestionAsset(file))
  );
  const preparedByKey = new Map<string, PreparedQuestionAsset>();
  manifest.assets?.forEach((asset, index) => {
    const prepared = preparedAssets[index];
    if (prepared) preparedByKey.set(asset.key, prepared);
  });
  return { preparedByKey, usedKeys };
}

async function applyCurrentBankImport(
  input: AgentImportInput,
  prepared: PreparedAssetInputs
): Promise<AgentImportSummary> {
  const state = await readAppState();
  const workspacePath = state.currentWorkspacePath;
  if (!workspacePath) {
    throw new StorageError("还没有打开题库。", "WORKSPACE_NOT_SELECTED", 400);
  }
  if (
    !input.workspacePath ||
    path.resolve(workspacePath) !== path.resolve(input.workspacePath)
  ) {
    throw new StorageError(
      "Agent 导入目标不是当前题库，请先切换工作区。",
      "WORKSPACE_CHANGED",
      409
    );
  }

  return withWorkspaceWriteLock(workspacePath, async () => {
    const dirs = getWorkspaceDirs(workspacePath);
    const raw = await readFile(dirs.bankPath, "utf8");
    const currentRevision = revisionForContent(raw);
    if (input.baseRevision && input.baseRevision !== currentRevision) {
      throw new StorageError(
        "题库在 Agent 读取后被其他程序修改，请重试。",
        "BANK_CONFLICT",
        409
      );
    }
    return importIntoBank({
      dirs,
      workspacePath,
      current: parseStoredBank(raw),
      raw,
      currentRevision,
      input,
      prepared
    });
  });
}

async function applyCreateBankImport(
  input: AgentImportInput,
  prepared: PreparedAssetInputs
): Promise<AgentImportSummary> {
  const bankSpec = input.manifest.bank!;
  const workspacePath = resolveAgentWorkspacePath(bankSpec.name, bankSpec.path);
  const initialBank = await buildAgentBank({
    chapters: input.manifest.chapters?.map((chapter) => chapter.name),
    copySettingsFromCurrent: bankSpec.copySettingsFromCurrent !== false
  });
  const initialRaw = serializeJson(initialBank);
  const initialRevision = revisionForContent(initialRaw);
  const now = new Date().toISOString();
  const batchId = input.manifest.batch?.id ?? `import-${randomUUID()}`;
  const assetPlan = buildAssetPlan(
    initialBank,
    prepared.usedKeys,
    prepared.preparedByKey
  );
  const draft = planBank({
    current: initialBank,
    manifest: input.manifest,
    batchId,
    now,
    overwrite: input.overwrite,
    assetsByKey: assetPlan.assetsByKey
  });
  const summary = buildSummary({
    draft,
    input,
    batchId,
    existingBatch: undefined,
    revision: initialRevision,
    assetCount: assetPlan.toWrite.length,
    createdWorkspace: {
      path: workspacePath,
      switched: input.dryRun ? false : input.switchWorkspace === true
    }
  });
  if (input.dryRun) {
    await assertAgentWorkspaceAvailable(workspacePath);
    parseV3Bank({ ...draft.bank, imports: [] });
    return summary;
  }

  parseV3Bank({ ...draft.bank, imports: [] });
  await assertAgentWorkspaceAvailable(workspacePath);
  const committed = await withWorkspaceWriteLock(workspacePath, async () => {
    await assertAgentWorkspaceAvailable(workspacePath);
    const dirs = await createWorkspaceWithBank(workspacePath, initialBank);
    return commitImport({
      dirs,
      current: initialBank,
      raw: initialRaw,
      currentRevision: initialRevision,
      manifest: input.manifest,
      batchId,
      now,
      draft,
      assetPlan,
      existingBatch: undefined
    });
  });

  if (input.switchWorkspace) {
    await activateAgentWorkspace(workspacePath);
  }
  broadcastImport(workspacePath, committed.revision, batchId, summary);
  return { ...summary, revision: committed.revision };
}

async function importIntoBank(options: {
  dirs: WorkspaceDirs;
  workspacePath: string;
  current: Bank;
  raw: string;
  currentRevision: string;
  input: AgentImportInput;
  prepared: PreparedAssetInputs;
}): Promise<AgentImportSummary> {
  const {
    dirs,
    workspacePath,
    current,
    raw,
    currentRevision,
    input,
    prepared
  } = options;
  const now = new Date().toISOString();
  const batchId = input.manifest.batch?.id ?? `import-${randomUUID()}`;
  const existingBatch = current.imports.find(
    (batch) => batch.id === batchId
  );
  if (existingBatch?.status === "undone") {
    throw new ValidationError(
      `批次已撤销，请使用新的批次 ID：${batchId}`
    );
  }
  const assetPlan = buildAssetPlan(
    current,
    prepared.usedKeys,
    prepared.preparedByKey
  );
  const draft = planBank({
    current,
    manifest: input.manifest,
    batchId,
    now,
    overwrite: input.overwrite,
    assetsByKey: assetPlan.assetsByKey
  });
  const summary = buildSummary({
    draft,
    input,
    batchId,
    existingBatch,
    revision: currentRevision,
    assetCount: assetPlan.toWrite.length
  });
  if (input.dryRun) {
    parseV3Bank({ ...draft.bank, imports: current.imports });
    return summary;
  }

  const committed = await commitImport({
    dirs,
    current,
    raw,
    currentRevision,
    manifest: input.manifest,
    batchId,
    now,
    draft,
    assetPlan,
    existingBatch
  });
  broadcastImport(workspacePath, committed.revision, batchId, summary);
  return { ...summary, revision: committed.revision };
}

function buildSummary(options: {
  draft: PlanResult;
  input: AgentImportInput;
  batchId: string;
  existingBatch: ImportBatchRecord | undefined;
  revision: string;
  assetCount: number;
  createdWorkspace?: { path: string; switched: boolean };
}): AgentImportSummary {
  const { draft, input, batchId, existingBatch, revision } = options;
  return {
    status: draft.conflicts.length ? ("partial" as const) : ("completed" as const),
    dryRun: input.dryRun,
    batchId: input.dryRun ? (existingBatch?.id ?? null) : batchId,
    revision,
    counts: {
      created: draft.createdIds.length,
      updated: draft.updatedIds.length,
      skipped: 0,
      conflicts: draft.conflicts.length,
      assets: options.assetCount
    },
    conflicts: draft.conflicts,
    warnings: draft.warnings,
    chapterAssignments: draft.chapterAssignments,
    ...(options.createdWorkspace
      ? { createdWorkspace: options.createdWorkspace }
      : {})
  };
}

async function commitImport(options: {
  dirs: WorkspaceDirs;
  current: Bank;
  raw: string;
  currentRevision: string;
  manifest: AgentImportManifest;
  batchId: string;
  now: string;
  draft: PlanResult;
  assetPlan: AssetPlan;
  existingBatch: ImportBatchRecord | undefined;
}): Promise<{
  record: ImportBatchRecord;
  finalBank: Bank;
  revision: string;
}> {
  const {
    dirs,
    current,
    raw,
    currentRevision,
    manifest,
    batchId,
    now,
    draft,
    assetPlan,
    existingBatch
  } = options;
  const writtenPaths: string[] = [];
  try {
    for (const prepared of assetPlan.toWrite) {
      await writePreparedAsset(prepared, dirs.assetDir);
      writtenPaths.push(path.join(dirs.assetDir, prepared.asset.fileName));
    }
    const historySnapshot = existingBatch
      ? existingBatch.historySnapshot
      : await createHistorySnapshot(dirs, raw, currentRevision);
    const additions: ImportBatchRecord = {
      id: batchId,
      createdAt: now,
      note: manifest.batch?.note ?? null,
      bookTitles: [...draft.bookTitles],
      newCount: draft.createdIds.length,
      updatedCount: draft.updatedIds.length,
      skippedCount: 0,
      conflictCount: draft.conflicts.length,
      itemIds: [...draft.createdIds],
      updatedItemIds: [...draft.updatedIds],
      historySnapshot,
      status: draft.conflicts.length ? "partial" : "completed",
      undoneAt: null
    };
    const record = existingBatch
      ? mergeBatchRecord(existingBatch, additions)
      : additions;
    const imports = existingBatch
      ? current.imports.map((batch) =>
          batch.id === record.id ? record : batch
        )
      : [record, ...current.imports].slice(0, 50);
    const finalBank = parseV3Bank({ ...draft.bank, imports });
    await writeJsonFileAtomic(dirs.bankPath, finalBank);
    const revision = revisionForContent(serializeJson(finalBank));
    return { record, finalBank, revision };
  } catch (error) {
    await Promise.all(
      writtenPaths.map((filePath) => rm(filePath, { force: true }))
    );
    throw error;
  }
}

function mergeBatchRecord(
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

function uniqueUnion(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

function broadcastImport(
  workspacePath: string,
  revision: string,
  batchId: string,
  summary: AgentImportSummary
): void {
  try {
    broadcastBankChanged({
      workspacePath,
      revision,
      source: "agent-import",
      batchId,
      counts: summary.counts
    });
  } catch {
    // A renderer event is best-effort; the import itself is already durable.
  }
}

interface AssetPlan {
  assetsByKey: Map<string, QuestionAsset>;
  toWrite: PreparedQuestionAsset[];
}

function buildAssetPlan(
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

interface PlanInput {
  current: Bank;
  manifest: AgentImportManifest;
  batchId: string;
  now: string;
  overwrite: boolean;
  assetsByKey: Map<string, QuestionAsset>;
}

interface PlanResult {
  bank: Bank;
  createdIds: string[];
  updatedIds: string[];
  conflicts: AgentImportSummary["conflicts"];
  warnings: AgentImportWarning[];
  chapterAssignments: AgentImportSummary["chapterAssignments"];
  bookTitles: Set<string>;
}

function planBank(input: PlanInput): PlanResult {
  const books = input.current.books.map((book) => ({ ...book }));
  const chapters = input.current.chapters.map((chapter) => ({ ...chapter }));
  const items = input.current.items.map((item) => ({
    ...item,
    tags: [...item.tags],
    assets: [...item.assets],
    modules: {
      question: { ...item.modules.question },
      solution: { ...item.modules.solution },
      note: { ...item.modules.note }
    }
  }));
  const bookById = new Map(books.map((book) => [book.id, book]));
  const bookByTitle = new Map(
    books.map((book) => [normalizeUniqueName(book.title), book])
  );
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const chapterByName = new Map(
    chapters.map((chapter) => [normalizeUniqueName(chapter.name), chapter])
  );
  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemBySource = new Map<string, QuestionItem>();
  for (const item of items) {
    if (!item.source) continue;
    const key = sourceKey(item.source.bookId, item.source.label);
    if (key) itemBySource.set(key, item);
  }
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
    upsertManifestBook(manifestBook, {
      books,
      bookById,
      bookByTitle,
      now: input.now
    });
  }

  for (const question of input.manifest.questions) {
    const source = resolveSource(question, {
      books,
      bookById,
      bookByTitle,
      now: input.now
    });
    if (source?.bookId) {
      const book = bookById.get(source.bookId);
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

    const chapter = resolveChapter(question, { chapterById, chapterByName });
    if (chapter.warning) {
      warnings.push({
        code: "CHAPTER_NOT_FOUND",
        message: chapter.warning,
        question: label
      });
    }

    const assetKeys = collectQuestionAssetKeys(question);
    const questionAssets = assetKeys.flatMap((key) => {
      const asset = input.assetsByKey.get(key);
      return asset ? [{ ...asset }] : [];
    });

    if (target) {
      const moving = chapter.provided && chapter.chapterId !== target.chapterId && chapter.chapterId !== null;
      const modules = {
        ...target.modules,
        question: {
          tex: substituteAssets(question.modules.question.tex, input.assetsByKey)
        },
        ...(question.modules.solution
          ? {
              solution: {
                tex: substituteAssets(
                  question.modules.solution.tex,
                  input.assetsByKey
                )
              }
            }
          : {}),
        ...(question.modules.note
          ? {
              note: {
                tex: substituteAssets(
                  question.modules.note.tex,
                  input.assetsByKey
                )
              }
            }
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
        tags: unionTags(target.tags, question.tags ?? []),
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
      replaceItem(items, next);
      itemById.set(next.id, next);
      if (target.source) {
        const oldKey = sourceKey(target.source.bookId, target.source.label);
        if (oldKey && itemBySource.get(oldKey)?.id === target.id) {
          itemBySource.delete(oldKey);
        }
      }
      if (next.source) {
        const nextKey = sourceKey(next.source.bookId, next.source.label);
        if (nextKey) itemBySource.set(nextKey, next);
      }
      updatedIds.push(next.id);
      chapterAssignments.push({
        question: label,
        chapterId: next.chapterId,
        chapterName: next.chapterId
          ? (chapterById.get(next.chapterId)?.name ?? null)
          : null
      });
      continue;
    }

    const id = question.id ?? randomUUID();
    if (itemById.has(id)) {
      throw new ValidationError(`题目 ID 已存在：${id}`);
    }
    const variantOf = question.variantOf ?? null;
    if (variantOf) validateVariant(variantOf, knownIds, id);
    const solutionTex = question.modules.solution?.tex ?? "";
    const next: QuestionItem = {
      id,
      source,
      chapterId: chapter.chapterId,
      chapterOrder: nextChapterOrder(items, chapter.chapterId),
      tags: question.tags ?? [],
      reviewPriority: question.reviewPriority ?? null,
      reviewStatus: "pending",
      solutionSource:
        question.solutionSource ?? (solutionTex.trim() ? null : "none"),
      solutionRef: question.solutionRef ?? null,
      variantOf,
      importBatchId: input.batchId,
      importedAt: input.now,
      modules: {
        question: {
          tex: substituteAssets(question.modules.question.tex, input.assetsByKey)
        },
        solution: {
          tex: substituteAssets(solutionTex, input.assetsByKey)
        },
        note: {
          tex: substituteAssets(
            question.modules.note?.tex ?? "",
            input.assetsByKey
          )
        }
      },
      assets: dedupeAssets(questionAssets),
      createdAt: input.now,
      updatedAt: input.now
    };
    items.push(next);
    itemById.set(id, next);
    knownIds.add(id);
    if (source) {
      const key = sourceKey(source.bookId, source.label);
      if (key) itemBySource.set(key, next);
    }
    createdIds.push(id);
    chapterAssignments.push({
      question: label,
      chapterId: next.chapterId,
      chapterName: next.chapterId
        ? (chapterById.get(next.chapterId)?.name ?? null)
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

function resolveSource(
  question: AgentManifestQuestion,
  context: {
    books: BookRecord[];
    bookById: Map<string, BookRecord>;
    bookByTitle: Map<string, BookRecord>;
    now: string;
  }
): QuestionSource | null {
  if (question.source === undefined) {
    return null;
  }
  if (question.source === null) return null;
  const source = question.source;
  const book = resolveBook(source, context);
  return {
    bookId: book?.id ?? null,
    label: normalizeSourceLabel(source.label)
  };
}

function resolveBook(
  source: AgentManifestSource,
  context: {
    books: BookRecord[];
    bookById: Map<string, BookRecord>;
    bookByTitle: Map<string, BookRecord>;
    now: string;
  }
): BookRecord | null {
  if (source.bookId) {
    const book = context.bookById.get(source.bookId);
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
    const normalized = normalizeUniqueName(source.bookTitle);
    const existing = context.bookByTitle.get(normalized);
    if (existing) return existing;
    const book = createBook(
      {
        title: source.bookTitle
      },
      context
    );
    return book;
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
  context: {
    chapterById: Map<string, { id: string; name: string }>;
    chapterByName: Map<string, { id: string; name: string }>;
  }
): { chapterId: string | null; provided: boolean; warning?: string } {
  const provided =
    question.chapterId !== undefined || question.chapterName !== undefined;
  if (!provided) return { chapterId: null, provided: false };
  if (question.chapterId) {
    const byId = context.chapterById.get(question.chapterId);
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
    const byName = context.chapterByName.get(
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
  context: {
    books: BookRecord[];
    bookById: Map<string, BookRecord>;
    bookByTitle: Map<string, BookRecord>;
    now: string;
  }
): void {
  const byId = manifestBook.id
    ? context.bookById.get(manifestBook.id)
    : undefined;
  const byTitle = context.bookByTitle.get(
    normalizeUniqueName(manifestBook.title)
  );
  const existing = byId ?? byTitle;
  if (existing) {
    const previousTitle = existing.title;
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
    existing.updatedAt = context.now;
    const previousKey = normalizeUniqueName(previousTitle);
    if (context.bookByTitle.get(previousKey) === existing) {
      context.bookByTitle.delete(previousKey);
    }
    context.bookByTitle.set(normalizeUniqueName(existing.title), existing);
    return;
  }
  createBook(manifestBook, context);
}

function createBook(
  book: {
    id?: string;
    title: string;
    filePath?: string;
    fileHash?: string;
    answerBookPath?: string;
    answerBookHash?: string;
  },
  context: {
    books: BookRecord[];
    bookById: Map<string, BookRecord>;
    bookByTitle: Map<string, BookRecord>;
    now: string;
  }
): BookRecord {
  const normalizedTitle = normalizeUniqueName(book.title);
  if (!normalizedTitle) {
    throw new ValidationError("书目名称不能为空。");
  }
  if (context.bookByTitle.has(normalizedTitle)) {
    throw new ValidationError(`书目名称重复：${book.title}`);
  }
  const id = book.id ?? `book-${randomUUID()}`;
  if (context.bookById.has(id)) {
    throw new ValidationError(`书目 ID 已存在：${id}`);
  }
  const record: BookRecord = {
    id,
    title: book.title,
    filePath: book.filePath ?? null,
    fileHash: book.fileHash ?? null,
    answerBookPath: book.answerBookPath ?? null,
    answerBookHash: book.answerBookHash ?? null,
    createdAt: context.now,
    updatedAt: context.now
  };
  context.books.push(record);
  context.bookById.set(id, record);
  context.bookByTitle.set(normalizedTitle, record);
  return record;
}

function collectUsedAssetKeys(manifest: AgentImportManifest): Set<string> {
  const keys = new Set<string>();
  for (const question of manifest.questions) {
    for (const key of collectQuestionAssetKeys(question)) keys.add(key);
  }
  return keys;
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
  return tex.replace(
    /\{\{asset:\s*([^}]*)\}\}/g,
    (_match, rawKey: string) => {
      const key = rawKey.trim();
      const asset = assetsByKey.get(key);
      if (!asset) {
        throw new ValidationError(`附件占位符引用了不存在的 key：${key}`);
      }
      return asset.relativePath;
    }
  );
}

function unionTags(existing: string[], added: string[]): string[] {
  const values = [...existing];
  const seen = new Set(
    existing.map((tag) => tag.trim().normalize("NFKC").toLocaleLowerCase("en-US"))
  );
  for (const tag of added) {
    const normalized = tag.trim().normalize("NFKC");
    if (!normalized || isReservedTag(normalized)) continue;
    const key = normalized.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values;
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

function dedupeAssets(assets: QuestionAsset[]): QuestionAsset[] {
  return mergeAssets([], assets);
}

function replaceItem(items: QuestionItem[], next: QuestionItem): void {
  const index = items.findIndex((item) => item.id === next.id);
  if (index >= 0) items[index] = next;
}

function nextChapterOrder(
  items: QuestionItem[],
  chapterId: string | null
): number {
  const orders = items
    .filter((item) => item.chapterId === chapterId)
    .map((item) => item.chapterOrder);
  return (orders.length ? Math.max(...orders) : 0) + 1;
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
