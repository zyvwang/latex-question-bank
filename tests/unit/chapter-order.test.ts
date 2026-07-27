import { describe, expect, it } from "vitest";
import {
  findSourceNumberConflict,
  moveItemWithinChapter,
  orderItemsByChapter,
  reorderItemWithinChapterByDrop
} from "../../shared/chapter-order.js";
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

  it("finds non-empty source-number conflicts only in the target chapter", () => {
    const items = [
      { ...item("a-1", "chapter-a", 1), sourceNumber: "12" },
      { ...item("a-2", "chapter-a", 2), sourceNumber: "" },
      { ...item("b-1", "chapter-b", 1), sourceNumber: "12" }
    ];
    expect(
      findSourceNumberConflict(items, "a-2", "chapter-a", "12")?.id
    ).toBe("a-1");
    expect(
      findSourceNumberConflict(items, "a-2", null, "12")
    ).toBeNull();
  });
});

function item(
  id: string,
  chapterId: string | null,
  chapterOrder: number
): QuestionItem {
  return {
    id,
    sourceNumber: id,
    chapterId,
    chapterOrder,
    tags: [],
    masteryOptionId: null,
    errorReasonOptionIds: [],
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
