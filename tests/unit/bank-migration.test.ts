import { describe, expect, it } from "vitest";
import {
  migrateLegacyBank,
  splitLegacyTags
} from "../../shared/bank-migration.js";
import type {
  LegacyBank,
  LegacyBankV2,
  LegacyQuestionItem
} from "../../shared/types.js";
import { validateBankPayload } from "../../shared/bank-validation.js";
import { createSampleBank } from "../../server/bank-schema.js";

describe("legacy bank migration to v4", () => {
  it("is deterministic, discards stars, and derives chapter-local order", () => {
    const legacy = createLegacyBank();
    const first = migrateLegacyBank(legacy);
    const second = migrateLegacyBank(legacy);

    expect(second).toEqual(first);
    expect(first.version).toBe(4);
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
        topics: item.topics,
        questionTypes: item.questionTypes,
        reviewStatus: item.reviewStatus
      }))
    ).toEqual([
      {
        source: {
          bookId: result.books[0].id,
          label: "1.17"
        },
        topics: ["极限"],
        questionTypes: [],
        reviewStatus: "pending"
      },
      {
        source: {
          bookId: result.books[1].id,
          label: "1.1.1.12"
        },
        topics: ["积分"],
        questionTypes: [],
        reviewStatus: "approved"
      },
      {
        source: {
          bookId: result.books[2].id,
          label: "1.A.4"
        },
        topics: [],
        questionTypes: [],
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
    expect(bank?.version).toBe(4);
    expect(bank?.books.map((book) => book.title)).toEqual(["A书"]);
    expect(bank?.items[0].source).toEqual({
      bookId: bank?.books[0].id,
      label: "1.2"
    });
    expect(bank?.items[0].reviewStatus).toBe("pending");
    expect(bank?.items[0].reviewPriority).toBeNull();
    expect(bank?.items[0].solutionSource).toBeNull();
    expect(bank?.items[0].topics).toEqual(["x"]);
    expect(bank?.items[0].questionTypes).toEqual([]);
    expect(bank?.items[0]).not.toHaveProperty("masteryOptionId");
    expect(bank?.items[0]).not.toHaveProperty("errorReasonOptionIds");
  });
});

describe("v3 bank migration to v4", () => {
  it("splits prefixed tags into topics and question types and drops 考法 and free tags", () => {
    const v3 = createV3Bank([
      "考点·数列极限",
      "题型·选择",
      "考法·夹逼准则",
      "自由标签",
      " 考点·泰勒公式 ",
      "考点·数列极限",
      "题型·",
      "题型·证明"
    ]);
    const result = validateBankPayload(v3);

    expect(result.ok).toBe(true);
    expect(result.value?.version).toBe(4);
    const item = result.value?.items[0];
    expect(item?.topics).toEqual(["数列极限", "泰勒公式"]);
    expect(item?.questionTypes).toEqual(["选择", "证明"]);
    expect(item).not.toHaveProperty("tags");
    // 其余字段原样保留
    expect(item?.reviewPriority).toBe("recheck");
    expect(item?.source).toEqual(v3.items[0].source);
  });

  it("still validates every v3 field through the v4 parser", () => {
    const v3 = createV3Bank(["考点·极限"]);
    expect(validateBankPayload({ ...v3, items: [{ ...v3.items[0], tags: "考点·极限" }] }).ok).toBe(false);
    expect(validateBankPayload({ ...v3, items: [{ ...v3.items[0], tags: undefined }] }).ok).toBe(false);
    expect(validateBankPayload({ ...v3, items: [{ ...v3.items[0], chapterId: "missing" }] }).ok).toBe(false);
    expect(validateBankPayload({ ...v3, items: "x" }).ok).toBe(false);
  });

  it("keeps unprefixed legacy v1/v2 tags as topics but not 考法", () => {
    expect(splitLegacyTags(["极限", "考法·换元", "题型·解答", "待审阅"], "topics")).toEqual({
      topics: ["极限"],
      questionTypes: ["解答"]
    });
    expect(splitLegacyTags(["极限", "考点·积分"], "drop")).toEqual({
      topics: ["积分"],
      questionTypes: []
    });
  });
});

// v3 与 v4 只差题目上的 tags 字段，用当前示例题库去掉新字段、补上 tags 构造。
function createV3Bank(tags: string[]) {
  const bank = createSampleBank();
  return {
    ...bank,
    version: 3,
    items: bank.items.map(({ topics: _topics, questionTypes: _types, ...item }) => ({
      ...item,
      tags
    }))
  };
}

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
