import { describe, expect, it } from "vitest";
import {
  findSourceConflict,
  moveItemWithinChapter,
  nextChapterOrder,
  orderItemsByChapter,
  reorderItemWithinChapterByDrop
} from "../../shared/chapter-order.js";
import { mergeTags } from "../../shared/names.js";
import type { Chapter, QuestionItem } from "../../shared/types.js";

const chapters: Chapter[] = [
  { id: "chapter-a", name: "第一章", order: 1 },
  { id: "chapter-b", name: "第二章", order: 2 }
];

describe("chapter-local question order", () => {
  it("orders formal chapters first and uncategorized last", () => {
    const items = [
      item("u", null, 1),
      item("b-2", "chapter-b", 2),
      item("a-2", "chapter-a", 2),
      item("b-1", "chapter-b", 1),
      item("a-1", "chapter-a", 1)
    ];
    expect(orderItemsByChapter(items, chapters).map((candidate) => candidate.id)).toEqual([
      "a-1",
      "a-2",
      "b-1",
      "b-2",
      "u"
    ]);
  });

  it("appends after the highest order even when orders have gaps", () => {
    const items = [
      item("a-1", "chapter-a", 1),
      item("a-5", "chapter-a", 5),
      item("u", null, 1)
    ];
    expect(nextChapterOrder(items, "chapter-a")).toBe(6);
    expect(nextChapterOrder(items, null)).toBe(2);
    expect(nextChapterOrder(items, "chapter-b")).toBe(1);
  });

  it("moves and drops only inside the current chapter", () => {
    const items = [
      item("a-1", "chapter-a", 1),
      item("a-2", "chapter-a", 2),
      item("b-1", "chapter-b", 1)
    ];
    const moved = moveItemWithinChapter(items, "a-2", 1, "now");
    expect(orderItemsByChapter(moved, chapters).map((candidate) => candidate.id)).toEqual([
      "a-2",
      "a-1",
      "b-1"
    ]);
    expect(
      reorderItemWithinChapterByDrop(items, "a-1", "b-1", "after")
    ).toBe(items);
  });

  it("finds book-linked source conflicts across the whole bank", () => {
    const items = [
      { ...item("a-1", "chapter-a", 1), source: { bookId: "book-1", label: "12" } },
      { ...item("a-2", "chapter-a", 2), source: { bookId: "book-1", label: "13" } },
      { ...item("b-1", "chapter-b", 1), source: { bookId: "book-1", label: "12" } }
    ];
    expect(
      findSourceConflict(items, "a-2", { bookId: "book-1", label: "12" })?.id
    ).toBe("a-1");
    expect(
      findSourceConflict(items, "a-2", { bookId: null, label: "12" })
    ).toBeNull();
    expect(
      findSourceConflict(items, "b-1", { bookId: "book-2", label: "12" })
    ).toBeNull();
  });
});

describe("mergeTags", () => {
  it("normalizes, dedupes case-insensitively, and drops reserved tags", () => {
    expect(
      mergeTags(["Limit", "洛必达"], [" limit ", "ｔａｙｌｏｒ", "", "待审阅", "Taylor", "洛必达"])
    ).toEqual(["Limit", "洛必达", "taylor"]);
  });
});

function item(
  id: string,
  chapterId: string | null,
  chapterOrder: number
): QuestionItem {
  return {
    id,
    source: { bookId: null, label: id },
    chapterId,
    chapterOrder,
    topics: [],
    questionTypes: [],
    reviewPriority: null,
    reviewStatus: "approved",
    solutionSource: "none",
    solutionRef: null,
    variantOf: null,
    importBatchId: null,
    importedAt: null,
    modules: {
      question: { tex: id },
      solution: { tex: "" },
      note: { tex: "" }
    },
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
