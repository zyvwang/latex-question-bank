import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";
import {
  isRecord,
  validateBankPayload,
  validateCompileItemRequest,
  validateExportRequest,
  validateRecoverBankRequest,
  validateSaveBankRequest,
  validateTexPathRequest,
  validateWorkspaceMoveRequest,
  validateWorkspacePathRequest
} from "../../shared/validation.js";
import { validateBankPayload as validateBankPayloadDirect } from "../../shared/bank-validation.js";
import { isRecord as isRecordDirect } from "../../shared/validation-primitives.js";

describe("shared validation", () => {
  it("keeps the compatibility barrel wired to the split validators", () => {
    expect(validateBankPayload).toBe(validateBankPayloadDirect);
    expect(isRecord).toBe(isRecordDirect);
  });

  it("validates request envelope variants", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);

    expect(validateWorkspacePathRequest(null).ok).toBe(false);
    expect(validateWorkspacePathRequest({ workspacePath: 3 }).ok).toBe(false);
    expect(validateWorkspacePathRequest({ workspacePath: " " }).ok).toBe(false);
    expect(validateWorkspacePathRequest({ workspacePath: " /tmp/bank " }).value?.workspacePath).toBe(
      "/tmp/bank"
    );

    expect(validateWorkspaceMoveRequest({}).ok).toBe(false);
    expect(validateWorkspaceMoveRequest({ workspacePath: "/tmp", direction: "left" }).ok).toBe(false);
    expect(validateWorkspaceMoveRequest({ workspacePath: "/tmp", direction: "up" }).ok).toBe(true);
    expect(validateWorkspaceMoveRequest({ workspacePath: "/tmp", direction: "down" }).ok).toBe(true);

    expect(validateTexPathRequest(null).ok).toBe(false);
    expect(validateTexPathRequest({ texPath: 3 }).ok).toBe(false);
    expect(validateTexPathRequest({ texPath: " " }).value?.texPath).toBeUndefined();
    expect(validateTexPathRequest({ texPath: " /bin/latexmk " }).value?.texPath).toBe("/bin/latexmk");

    expect(validateRecoverBankRequest(null).ok).toBe(false);
    expect(validateRecoverBankRequest({ candidateId: 3 }).ok).toBe(false);
    expect(validateRecoverBankRequest({ candidateId: " " }).ok).toBe(false);
    expect(validateRecoverBankRequest({ candidateId: "bank.json.bak", workspacePath: "/bank" }).ok).toBe(true);

    expect(validateExportRequest(null).ok).toBe(false);
    expect(validateExportRequest({ workspacePath: "/tmp/bank", baseRevision: "a".repeat(64), itemIds: [3], fileName: "x" }).ok).toBe(false);
    expect(validateExportRequest({ workspacePath: "/tmp/bank", baseRevision: "a".repeat(64), itemIds: [], fileName: 3 }).ok).toBe(false);
    expect(validateExportRequest({ workspacePath: "/tmp/bank", baseRevision: "a".repeat(64), itemIds: [], fileName: "x", orderMode: "sideways" }).ok).toBe(false);
    expect(validateExportRequest({ workspacePath: "/tmp/bank", baseRevision: "a".repeat(64), itemIds: [], fileName: "x", randomSeed: 3 }).ok).toBe(false);
    expect(validateExportRequest({ workspacePath: "/tmp/bank", baseRevision: "a".repeat(64), itemIds: [], fileName: "x", orderMode: "normal" }).ok).toBe(true);
    expect(
      validateExportRequest({ workspacePath: "/tmp/bank", baseRevision: "a".repeat(64), itemIds: [], fileName: "x", orderMode: "random", randomSeed: " seed " })
        .value?.randomSeed
    ).toBe("seed");
  });

  it("accepts valid v3 banks and rejects unsafe v3 saves", () => {
    const bank = createSampleBank();
    const item = bank.items[0];

    expect(validateBankPayload(bank).ok).toBe(true);
    expect(validateBankPayload(bank).value?.version).toBe(3);
    expect(
      validateSaveBankRequest({
        workspacePath: "/tmp/bank",
        baseRevision: "a".repeat(64),
        bank
      }).ok
    ).toBe(true);
    expect(validateSaveBankRequest(null).ok).toBe(false);
    expect(validateSaveBankRequest({ workspacePath: " ", baseRevision: "", bank }).ok).toBe(false);
    expect(validateSaveBankRequest({ workspacePath: "/tmp", baseRevision: 1, bank }).ok).toBe(false);

    const invalidBanks: unknown[] = [
      null,
      { ...bank, version: 2 },
      { ...bank, items: "not-array" },
      { ...bank, books: "not-array" },
      { ...bank, imports: "not-array" },
      { ...bank, settings: null },
      { ...bank, settings: { ...bank.settings, pageSize: "letter" } },
      { ...bank, items: [null] },
      { ...bank, items: [{ ...item, source: { bookId: null, label: 5 } }] },
      { ...bank, items: [{ ...item, source: { bookId: null, label: " " } }] },
      { ...bank, items: [{ ...item, source: { bookId: 5, label: "1" } }] },
      { ...bank, items: [{ ...item, source: { bookId: "missing", label: "1" } }] },
      { ...bank, items: [{ ...item, id: 5 }] },
      { ...bank, items: [{ ...item, id: "" }] },
      { ...bank, items: [{ ...item, chapterOrder: Number.NaN }] },
      { ...bank, items: [{ ...item, chapterOrder: 0 }] },
      { ...bank, items: [{ ...item, chapterId: 5 }] },
      { ...bank, items: [{ ...item, chapterId: "missing" }] },
      { ...bank, items: [{ ...item, tags: [5] }] },
      { ...bank, items: [{ ...item, tags: ["待审阅"] }] },
      { ...bank, items: [{ ...item, reviewPriority: "urgent" }] },
      { ...bank, items: [{ ...item, reviewStatus: "draft" }] },
      { ...bank, items: [{ ...item, solutionSource: "book" }] },
      { ...bank, items: [{ ...item, solutionRef: 5 }] },
      { ...bank, items: [{ ...item, variantOf: 5 }] },
      { ...bank, items: [{ ...item, importBatchId: 5 }] },
      { ...bank, items: [{ ...item, importedAt: 5 }] },
      { ...bank, items: [{ ...item, modules: undefined }] },
      { ...bank, items: [{ ...item, modules: { ...item.modules, note: null } }] },
      {
        ...bank,
        items: [{ ...item, modules: { ...item.modules, explanation: { tex: "extra" } } }]
      },
      { ...bank, items: [{ ...item, assets: "not-array" }] },
      { ...bank, items: [{ ...item, assets: [null] }] },
      {
        ...bank,
        items: [{
          ...item,
          assets: [{
            id: "a",
            fileName: "../escape.png",
            originalName: "escape.png",
            relativePath: "assets/escape.png",
            mimeType: "image/png",
            size: 1,
            uploadedAt: item.createdAt
          }]
        }]
      },
      {
        ...bank,
        items: [{
          ...item,
          assets: [{
            id: "a",
            fileName: "safe.png",
            originalName: "safe.png",
            relativePath: "../safe.png",
            mimeType: "image/png",
            size: 1,
            uploadedAt: item.createdAt
          }]
        }]
      },
      {
        ...bank,
        items: [{
          ...item,
          assets: [{
            id: "a",
            fileName: "safe.png",
            originalName: "safe.png",
            relativePath: "assets/safe.png",
            mimeType: "image/png",
            size: 1,
            uploadedAt: item.createdAt,
            sha256: "not-a-hash"
          }]
        }]
      },
      { ...bank, items: [item, { ...item }] },
      { ...bank, items: [item, { ...item, id: "other" }] },
      { ...bank, chapters: [{ ...bank.chapters[0], name: " " }] },
      {
        ...bank,
        chapters: [
          bank.chapters[0],
          { ...bank.chapters[1], name: bank.chapters[0].name.toUpperCase() }
        ]
      },
      { ...bank, books: [{ ...bank.books[0], fileHash: "bad" }] },
      {
        ...bank,
        books: [
          bank.books[0],
          { ...bank.books[0], id: "book-other", title: `  ${bank.books[0].title.toUpperCase()}  ` }
        ]
      },
      {
        ...bank,
        imports: Array.from({ length: 51 }, (_, index) => importRecord(index))
      },
      { ...bank, imports: [{ ...importRecord(0), status: "unknown" }] },
      { ...bank, imports: [{ ...importRecord(0), newCount: -1 }] },
      { ...bank, imports: [{ ...importRecord(0), itemIds: [3] }] },
      { ...bank, imports: [{ ...importRecord(0), historySnapshot: "../escape.json" }] }
    ];
    for (const value of invalidBanks) {
      expect(
        validateSaveBankRequest({
          workspacePath: "/tmp/bank",
          baseRevision: "a".repeat(64),
          bank: value
        }).ok
      ).toBe(false);
    }

    expect(
      validateBankPayload({
        version: 1,
        settings: bank.settings,
        items: [{
          id: item.id,
          order: 1,
          sourceNumber: "1",
          chapter: "旧章节",
          tags: item.tags,
          star: 3,
          modules: undefined,
          assets: item.assets,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        }]
      }).ok
    ).toBe(false);
  });

  it("validates compile requests independently", () => {
    const bank = createSampleBank();
    expect(validateCompileItemRequest(null).ok).toBe(false);
    expect(validateCompileItemRequest({ workspacePath: "/tmp/bank", item: {}, settings: {} }).ok).toBe(false);
    expect(validateCompileItemRequest({ workspacePath: "/tmp/bank", item: bank.items[0], settings: bank.settings }).ok).toBe(true);
  });
});

function importRecord(index: number): Bank["imports"][number] {
  return {
    id: `import-${index}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    note: null,
    bookTitles: ["示例题库"],
    newCount: 1,
    updatedCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    itemIds: [],
    updatedItemIds: [],
    historySnapshot: null,
    status: "completed",
    undoneAt: null
  };
}
