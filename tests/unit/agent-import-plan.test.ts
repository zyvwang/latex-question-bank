import { describe, expect, it } from "vitest";
import type { AgentImportManifest } from "../../shared/agent-manifest.js";
import type { ImportBatchRecord, QuestionAsset } from "../../shared/types.js";
import { createSampleBank } from "../../server/bank-schema.js";
import {
  buildAssetPlan,
  collectUsedAssetKeys,
  mergeBatchRecord,
  planBank,
  type PlanInput
} from "../../server/agent-import-plan.js";
import type { PreparedQuestionAsset } from "../../server/asset-service.js";

const now = "2026-10-26T00:00:00.000Z";

function plan(manifest: Omit<AgentImportManifest, "schemaVersion">, overrides: Partial<PlanInput> = {}) {
  return planBank({
    current: createSampleBank(),
    manifest: { schemaVersion: 1, ...manifest },
    batchId: "batch-1",
    now,
    overwrite: false,
    assetsByKey: new Map(),
    ...overrides
  });
}

function asset(id: string, sha256: string): QuestionAsset {
  return {
    id,
    fileName: `${id}.png`,
    originalName: `${id}.png`,
    relativePath: `assets/${id}.png`,
    mimeType: "image/png",
    size: 1,
    uploadedAt: now,
    sha256
  };
}

describe("planBank", () => {
  it("reports approved matches as conflicts unless overwrite is set", () => {
    const manifest = {
      questions: [{
        source: { bookId: "book-sample", label: "示例 1" },
        tags: ["极限", "新标签", "待审阅"],
        modules: { question: { tex: "新题干" } }
      }]
    };
    const skipped = plan(manifest);
    expect(skipped.conflicts).toEqual([
      { id: "sample-limit", source: "示例 1", reason: "approved" }
    ]);
    expect(skipped.updatedIds).toEqual([]);
    expect(skipped.bank.items.find((item) => item.id === "sample-limit")?.modules.question.tex)
      .not.toBe("新题干");

    const overwritten = plan(manifest, { overwrite: true });
    const item = overwritten.bank.items.find((candidate) => candidate.id === "sample-limit");
    expect(overwritten.updatedIds).toEqual(["sample-limit"]);
    expect(item).toMatchObject({
      reviewStatus: "pending",
      importBatchId: "batch-1",
      tags: ["极限", "等价无穷小", "新标签"],
      modules: { question: { tex: "新题干" } }
    });
    expect(item?.modules.solution.tex).not.toBe("");
  });

  it("creates questions, reuses a book created by title, and appends to the chapter", () => {
    const result = plan({
      questions: [
        {
          source: { bookTitle: "新书", label: "1.1" },
          chapterName: "微积分/极限",
          modules: { question: { tex: "A" } }
        },
        {
          source: { bookTitle: "新书", label: "1.2" },
          chapterName: "不存在的章",
          modules: { question: { tex: "B" }, solution: { tex: "解" } }
        }
      ]
    });
    const books = result.bank.books.filter((book) => book.title === "新书");
    expect(books).toHaveLength(1);
    const created = result.createdIds.map((id) => result.bank.items.find((item) => item.id === id));
    expect(created.map((item) => item?.source)).toEqual([
      { bookId: books[0]?.id, label: "1.1" },
      { bookId: books[0]?.id, label: "1.2" }
    ]);
    expect(created[0]).toMatchObject({ chapterId: "chapter-calculus", chapterOrder: 2, solutionSource: "none" });
    expect(created[1]).toMatchObject({ chapterId: null, solutionSource: null });
    expect(result.warnings).toEqual([
      { code: "CHAPTER_NOT_FOUND", message: "章节不存在：不存在的章", question: "1.2" }
    ]);
    expect([...result.bookTitles]).toEqual(["新书"]);
  });

  it("rejects duplicate sources, unknown variants, and missing asset keys", () => {
    const question = { source: { bookId: "book-sample", label: "dup" }, modules: { question: { tex: "x" } } };
    expect(() => plan({ questions: [question, question] })).toThrow("来源题号重复");
    expect(() =>
      plan({ questions: [{ variantOf: "missing", modules: { question: { tex: "x" } } }] })
    ).toThrow("variantOf 指向不存在的题目");
    expect(() =>
      plan({ questions: [{ modules: { question: { tex: "{{asset: fig}}" } } }] })
    ).toThrow("不存在的 key：fig");
  });

  it("substitutes asset placeholders and attaches each asset once", () => {
    const fig = asset("fig", "sha-fig");
    const result = plan(
      {
        questions: [{
          assets: ["fig"],
          modules: { question: { tex: "见 {{asset:fig}} 与 {{asset: fig }}" } }
        }]
      },
      { assetsByKey: new Map([["fig", fig]]) }
    );
    const item = result.bank.items.find((candidate) => candidate.id === result.createdIds[0]);
    expect(item?.modules.question.tex).toBe("见 assets/fig.png 与 assets/fig.png");
    expect(item?.assets).toEqual([fig]);
  });
});

describe("buildAssetPlan", () => {
  it("reuses existing and duplicate uploads by content hash", () => {
    const bank = createSampleBank();
    const existing = asset("existing", "sha-old");
    bank.items[0]!.assets = [existing];
    const prepared = (id: string, sha: string): PreparedQuestionAsset => ({
      asset: asset(id, sha),
      buffer: Buffer.from(id)
    });
    const result = buildAssetPlan(
      bank,
      collectUsedAssetKeys({
        schemaVersion: 1,
        questions: [{ modules: { question: { tex: "{{asset:a}}{{asset:b}}{{asset:c}}" } } }]
      }),
      new Map([
        ["a", prepared("a", "sha-old")],
        ["b", prepared("b", "sha-new")],
        ["c", prepared("c", "sha-new")]
      ])
    );
    expect(result.assetsByKey.get("a")).toBe(existing);
    expect(result.assetsByKey.get("c")).toBe(result.assetsByKey.get("b"));
    expect(result.toWrite.map((entry) => entry.asset.id)).toEqual(["b"]);
  });
});

describe("mergeBatchRecord", () => {
  it("unions ids and keeps partial status from either chunk", () => {
    const base: ImportBatchRecord = {
      id: "batch-1",
      createdAt: now,
      note: "first",
      bookTitles: ["A"],
      newCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      conflictCount: 1,
      itemIds: ["q1"],
      updatedItemIds: [],
      historySnapshot: "snapshot-1",
      status: "partial",
      undoneAt: null
    };
    const merged = mergeBatchRecord(base, {
      ...base,
      note: null,
      bookTitles: ["A", "B"],
      newCount: 2,
      conflictCount: 0,
      itemIds: ["q1", "q2"],
      updatedItemIds: ["q0"],
      historySnapshot: "snapshot-2",
      status: "completed"
    });
    expect(merged).toMatchObject({
      note: "first",
      bookTitles: ["A", "B"],
      newCount: 3,
      conflictCount: 1,
      itemIds: ["q1", "q2"],
      updatedItemIds: ["q0"],
      historySnapshot: "snapshot-1",
      status: "partial"
    });
  });
});
