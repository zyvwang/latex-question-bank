import { describe, expect, it } from "vitest";
import type { Chapter, QuestionItem } from "../../shared/types.js";
import {
  matchesQuestionFilters,
  UNCATEGORIZED_FILTER,
  UNSET_REVIEW_FILTER,
  type QuestionFilters
} from "../../src/questionFilters.js";

const chapters: Chapter[] = [
  { id: "chapter-a", name: "第一章", order: 1 },
  { id: "chapter-b", name: "第二章", order: 2 }
];
const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
const items = [
  item("a", "chapter-a", ["极限"], "easy", ["method"]),
  item("b", "chapter-b", ["矩阵"], "hard", ["calculation", "method"]),
  item("u", null, ["极限"], null, [])
];

describe("question filters", () => {
  it("uses OR inside chapter, tag, mastery, and error-reason fields", () => {
    expect(
      matchingIds({
        ...emptyFilters(),
        chapterFilters: ["chapter-a", "chapter-b"]
      })
    ).toEqual(["a", "b"]);
    expect(
      matchingIds({
        ...emptyFilters(),
        masteryFilters: ["easy", "hard"]
      })
    ).toEqual(["a", "b"]);
    expect(
      matchingIds({
        ...emptyFilters(),
        errorReasonFilters: ["calculation", "method"]
      })
    ).toEqual(["a", "b"]);
  });

  it("uses AND between different fields", () => {
    expect(
      matchingIds({
        ...emptyFilters(),
        tagFilters: ["极限"],
        masteryFilters: ["easy"]
      })
    ).toEqual(["a"]);
    expect(
      matchingIds({
        ...emptyFilters(),
        masteryFilters: ["easy"],
        errorReasonFilters: ["calculation"]
      })
    ).toEqual([]);
  });

  it("filters uncategorized and unset review states explicitly", () => {
    expect(
      matchingIds({
        ...emptyFilters(),
        chapterFilters: [UNCATEGORIZED_FILTER],
        masteryFilters: [UNSET_REVIEW_FILTER],
        errorReasonFilters: [UNSET_REVIEW_FILTER]
      })
    ).toEqual(["u"]);
  });
});

function matchingIds(filters: QuestionFilters): string[] {
  return items
    .filter((candidate) =>
      matchesQuestionFilters(candidate, filters, chapterById)
    )
    .map((candidate) => candidate.id);
}

function emptyFilters(): QuestionFilters {
  return {
    chapterFilters: [],
    tagFilters: [],
    masteryFilters: [],
    errorReasonFilters: [],
    search: ""
  };
}

function item(
  id: string,
  chapterId: string | null,
  tags: string[],
  masteryOptionId: string | null,
  errorReasonOptionIds: string[]
): QuestionItem {
  return {
    id,
    sourceNumber: id,
    chapterId,
    chapterOrder: 1,
    tags,
    masteryOptionId,
    errorReasonOptionIds,
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
