import { describe, expect, it } from "vitest";
import { migrateLegacyBank } from "../../shared/bank-migration.js";
import type {
  LegacyBank,
  LegacyBankV2,
  LegacyQuestionItem
} from "../../shared/types.js";
import { validateBankPayload } from "../../shared/validation.js";
import { createSampleBank } from "../../server/bank-schema.js";

describe("legacy bank migration to v3", () => {
  it("is deterministic, discards stars, and derives chapter-local order", () => {
    const legacy = createLegacyBank();
    const first = migrateLegacyBank(legacy);
    const second = migrateLegacyBank(legacy);

    expect(second).toEqual(first);
    expect(first.version).toBe(3);
    expect(first.chapters.map(({ name, order }) => ({ name, order }))).toEqual([
      { name: "第一章", order: 1 },
      { name: "第二章", order: 2 }
    ]);
    expect(first.books).toEqual([]);
    expect(first.imports).toEqual([]);
    expect(first.items.map((item) => ({
      id: item.id,
      chapterId: item.chapterId,
      chapterOrder: item.chapterOrder,
      source: item.source,
      reviewPriority: item.reviewPriority,
      reviewStatus: item.reviewStatus,
      solutionSource: item.solutionSource
    }))).toEqual([
      {
        id: "first-a",
        chapterId: first.chapters[0].id,
        chapterOrder: 1,
        source: { bookId: null, label: "1" },
        reviewPriority: null,
        reviewStatus: "approved",
        solutionSource: null
      },
      {
        id: "uncategorized",
        chapterId: null,
        chapterOrder: 1,
        source: { bookId: null, label: "1" },
        reviewPriority: null,
        reviewStatus: "approved",
        solutionSource: null
      },
      {
        id: "second",
        chapterId: first.chapters[1].id,
        chapterOrder: 1,
        source: { bookId: null, label: "1" },
        reviewPriority: null,
        reviewStatus: "approved",
        solutionSource: null
      },
      {
        id: "first-b",
        chapterId: first.chapters[0].id,
        chapterOrder: 2,
        source: { bookId: null, label: "1" },
        reviewPriority: null,
        reviewStatus: "approved",
        solutionSource: null
      }
    ]);
  });

  it("merges normalized legacy chapter names and permits bookless duplicate labels", () => {
    const legacy = createLegacyBank();
    legacy.items.push(createLegacyItem("first-case", 5, "第一章", "1"));
    legacy.items.push(createLegacyItem("first-normalized", 6, "  第一章  ", "1"));

    const result = validateBankPayload(legacy);
    expect(result.ok).toBe(true);
    expect(result.value?.chapters).toHaveLength(2);
    expect(
      result.value?.items.filter(
        (item) => item.chapterId === result.value?.chapters[0].id
      )
    ).toHaveLength(4);
  });

  it("parses book prefixes, converts pending tags, and drops legacy review fields", () => {
    const legacy: LegacyBank = {
      version: 1,
      settings: createSampleBank().settings,
      items: [
        createLegacyItem("a", 1, "第一章", "李正元高数1.17", ["待审阅", "极限"]),
        createLegacyItem("b", 2, "第一章", "880高数1.1.1.12", ["积分"]),
        createLegacyItem("c", 3, "第二章", "900高数1.A.4", [])
      ]
    };

    const result = migrateLegacyBank(legacy);
    expect(result.books.map((book) => book.title)).toEqual([
      "李正元高数",
      "880高数",
      "900高数"
    ]);
    expect(
      result.items.map((item) => ({
        source: item.source,
        tags: item.tags,
        reviewStatus: item.reviewStatus
      }))
    ).toEqual([
      {
        source: {
          bookId: result.books[0].id,
          label: "1.17"
        },
        tags: ["极限"],
        reviewStatus: "pending"
      },
      {
        source: {
          bookId: result.books[1].id,
          label: "1.1.1.12"
        },
        tags: ["积分"],
        reviewStatus: "approved"
      },
      {
        source: {
          bookId: result.books[2].id,
          label: "1.A.4"
        },
        tags: [],
        reviewStatus: "approved"
      }
    ]);
    expect(result.items.every((item) => item.reviewPriority === null)).toBe(true);
    expect(result.items.every((item) => item.solutionSource === null)).toBe(true);
    expect(result.items.every((item) => !("errorReasonOptionIds" in item))).toBe(true);
  });

  it("keeps duplicate legacy book+label loadable by unlinking the later duplicate", () => {
    const legacy: LegacyBank = {
      version: 1,
      settings: createSampleBank().settings,
      items: [
        createLegacyItem("a", 1, "第一章", "A书1.2"),
        createLegacyItem("b", 2, "第一章", "A书1.2")
      ]
    };
    const result = migrateLegacyBank(legacy);
    expect(result.items[0].source).toEqual({
      bookId: result.books[0].id,
      label: "1.2"
    });
    expect(result.items[1].source).toEqual({
      bookId: null,
      label: "1.2"
    });
    expect(validateBankPayload(result).ok).toBe(true);
  });

  it("migrates v2 banks through the read path", () => {
    const legacy = createLegacyV2Bank();
    const result = validateBankPayload(legacy);
    expect(result.ok).toBe(true);
    const bank = result.value;
    expect(bank?.version).toBe(3);
    expect(bank?.books.map((book) => book.title)).toEqual(["A书"]);
    expect(bank?.items[0].source).toEqual({
      bookId: bank?.books[0].id,
      label: "1.2"
    });
    expect(bank?.items[0].reviewStatus).toBe("pending");
    expect(bank?.items[0].reviewPriority).toBeNull();
    expect(bank?.items[0].solutionSource).toBeNull();
    expect(bank?.items[0].tags).toEqual(["x"]);
    expect(bank?.items[0]).not.toHaveProperty("masteryOptionId");
    expect(bank?.items[0]).not.toHaveProperty("errorReasonOptionIds");
  });
});

function createLegacyBank(): LegacyBank {
  return {
    version: 1,
    settings: createSampleBank().settings,
    items: [
      createLegacyItem("second", 3, "第二章", "1"),
      createLegacyItem("first-b", 4, "第一章", "1"),
      createLegacyItem("first-a", 1, "第一章", "1"),
      createLegacyItem("uncategorized", 2, " ", "1")
    ]
  };
}

function createLegacyItem(
  id: string,
  order: number,
  chapter: string,
  sourceNumber: string,
  tags: string[] = ["legacy"]
): LegacyQuestionItem {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    order,
    sourceNumber,
    chapter,
    tags,
    star: 4,
    modules: {
      question: { tex: id },
      solution: { tex: "" },
      note: { tex: "" }
    },
    assets: [],
    createdAt: now,
    updatedAt: now
  };
}

function createLegacyV2Bank(): LegacyBankV2 {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    version: 2,
    settings: createSampleBank().settings,
    chapters: [{ id: "c1", name: "第一章", order: 1 }],
    masteryOptions: [
      {
        id: "m1",
        name: "难",
        order: 1,
        color: "#112233",
        pattern: "solid"
      }
    ],
    errorReasonOptions: [
      {
        id: "e1",
        name: "错",
        order: 1,
        color: "#223344",
        pattern: "dots"
      }
    ],
    masteryHistory: [],
    items: [
      {
        id: "i1",
        sourceNumber: "A书1.2",
        chapterId: "c1",
        chapterOrder: 1,
        tags: ["待审阅", "x"],
        masteryOptionId: "m1",
        errorReasonOptionIds: ["e1"],
        modules: {
          question: { tex: "题目" },
          solution: { tex: "解析" },
          note: { tex: "备注" }
        },
        assets: [],
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}
