import { describe, expect, it } from "vitest";
import type {
  BookRecord,
  Chapter,
  QuestionItem,
  ReviewPriority,
  ReviewStatus
} from "../../shared/types.js";
import {
  matchesQuestionFilters,
  UNCATEGORIZED_FILTER,
  UNSET_BOOK_FILTER,
  UNSET_PRIORITY_FILTER,
  type QuestionFilters
} from "../../src/questionFilters.js";

const chapters: Chapter[] = [
  { id: "chapter-a", name: "第一章", order: 1 },
  { id: "chapter-b", name: "第二章", order: 2 }
];
const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
const books: BookRecord[] = [
  book("book-a", "A书"),
  book("book-b", "B书")
];
const items = [
  item("a", "chapter-a", ["极限"], "must", "approved", "book-a"),
  item("b", "chapter-b", ["矩阵"], "skip", "pending", "book-b"),
  item("u", null, ["极限"], null, "approved", null)
];

describe("question filters", () => {
  it("uses OR inside chapter, tag, book, priority, and status fields", () => {
    expect(
      matchingIds({
        ...emptyFilters(),
        chapterFilters: ["chapter-a", "chapter-b"]
      })
    ).toEqual(["a", "b"]);
    expect(
      matchingIds({
        ...emptyFilters(),
        bookFilters: ["book-a", "book-b"]
      })
    ).toEqual(["a", "b"]);
    expect(
      matchingIds({
        ...emptyFilters(),
        reviewPriorityFilters: ["must", "skip"]
      })
    ).toEqual(["a", "b"]);
    expect(
      matchingIds({
        ...emptyFilters(),
        reviewStatusFilters: ["pending"]
      })
    ).toEqual(["b"]);
  });

  it("uses AND between different fields", () => {
    expect(
      matchingIds({
        ...emptyFilters(),
        tagFilters: ["极限"],
        reviewPriorityFilters: ["must"]
      })
    ).toEqual(["a"]);
    expect(
      matchingIds({
        ...emptyFilters(),
        reviewPriorityFilters: ["must"],
        reviewStatusFilters: ["pending"]
      })
    ).toEqual([]);
  });

  it("filters uncategorized, unset priority, and unbound book explicitly", () => {
    expect(
      matchingIds({
        ...emptyFilters(),
        chapterFilters: [UNCATEGORIZED_FILTER],
        reviewPriorityFilters: [UNSET_PRIORITY_FILTER],
        bookFilters: [UNSET_BOOK_FILTER]
      })
    ).toEqual(["u"]);
  });

  it("does not read LaTeX modules when search is empty", () => {
    const candidate = item("lazy", "chapter-a", ["极限"], "must");
    makeTexUnreadable(candidate);

    expect(
      matchesQuestionFilters(candidate, emptyFilters(), chapterById, books)
    ).toBe(true);
  });

  it("combines tag filters with OR inside a dimension and AND across dimensions", () => {
    const tagged = (tags: string[]) => item("t", "chapter-a", tags, "must");
    const match = (candidate: QuestionItem, tagFilters: string[]) =>
      matchesQuestionFilters(candidate, { ...emptyFilters(), tagFilters }, chapterById, books);
    const limitChoice = tagged(["考点·数列极限", "题型·选择", "考法·夹逼准则"]);
    const limitSolve = tagged(["考点·数列极限", "题型·解答"]);
    const taylorChoice = tagged(["考点·泰勒公式", "题型·选择"]);

    // 同一维度内是「或」
    expect(match(limitChoice, ["考点·数列极限", "考点·泰勒公式"])).toBe(true);
    expect(match(taylorChoice, ["考点·数列极限", "考点·泰勒公式"])).toBe(true);
    // 不同维度之间是「且」
    expect(match(limitChoice, ["考点·数列极限", "题型·选择"])).toBe(true);
    expect(match(limitSolve, ["考点·数列极限", "题型·选择"])).toBe(false);
    expect(match(taylorChoice, ["考点·数列极限", "题型·选择"])).toBe(false);
    expect(match(limitChoice, ["考点·数列极限", "题型·选择", "考法·夹逼准则"])).toBe(true);
    expect(match(limitChoice, ["题型·选择", "考法·单调有界准则"])).toBe(false);
    // 没有前缀的标签自成一组，仍是「或」
    const plain = tagged(["极限"]);
    expect(match(plain, ["极限", "矩阵"])).toBe(true);
    expect(match(plain, ["矩阵"])).toBe(false);
    expect(match(plain, ["极限", "题型·选择"])).toBe(false);
    expect(match(plain, [])).toBe(true);
  });

  it("does not read LaTeX modules after a structured filter rejects the item", () => {
    const candidate = item("lazy", "chapter-a", ["极限"], "must");
    makeTexUnreadable(candidate);

    expect(
      matchesQuestionFilters(candidate, {
        ...emptyFilters(),
        chapterFilters: ["chapter-b"],
        search: "不会执行的全文搜索"
      }, chapterById, books)
    ).toBe(false);
  });

  it("matches normalized search terms across metadata, source, and LaTeX modules", () => {
    const candidate = item("search", "chapter-a", ["极限"], "must", "approved", "book-a");
    candidate.modules.solution.tex = "Use L'Hôpital";

    expect(matchesQuestionFilters(candidate, {
      ...emptyFilters(),
      search: "  L'HÔPITAL  "
    }, chapterById, books)).toBe(true);
    expect(matchesQuestionFilters(candidate, {
      ...emptyFilters(),
      search: "第一章"
    }, chapterById, books)).toBe(true);
    expect(matchesQuestionFilters(candidate, {
      ...emptyFilters(),
      search: "A书 search"
    }, chapterById, books)).toBe(true);
  });
});

function matchingIds(filters: QuestionFilters): string[] {
  return items
    .filter((candidate) =>
      matchesQuestionFilters(candidate, filters, chapterById, books)
    )
    .map((candidate) => candidate.id);
}

function emptyFilters(): QuestionFilters {
  return {
    chapterFilters: [],
    tagFilters: [],
    bookFilters: [],
    reviewPriorityFilters: [],
    reviewStatusFilters: [],
    search: ""
  };
}

function item(
  id: string,
  chapterId: string | null,
  tags: string[],
  reviewPriority: ReviewPriority | null,
  reviewStatus: ReviewStatus = "approved",
  bookId: string | null = null
): QuestionItem {
  return {
    id,
    source: { bookId, label: id },
    chapterId,
    chapterOrder: 1,
    tags,
    reviewPriority,
    reviewStatus,
    solutionSource: "user",
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

function book(id: string, title: string): BookRecord {
  return {
    id,
    title,
    filePath: null,
    fileHash: null,
    answerBookPath: null,
    answerBookHash: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function makeTexUnreadable(candidate: QuestionItem): void {
  Object.values(candidate.modules).forEach((module) => {
    Object.defineProperty(module, "tex", {
      get() {
        throw new Error("LaTeX 正文不应被读取");
      }
    });
  });
}
