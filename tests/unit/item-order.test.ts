import { describe, expect, it } from "vitest";
import { restoreDeletedItem } from "../../src/itemOrder.js";
import type { Bank, QuestionItem } from "../../shared/types.js";

const NOW = "2026-02-01T00:00:00.000Z";

function makeItem(overrides: Partial<QuestionItem> = {}): QuestionItem {
  return {
    id: "q-deleted",
    source: { bookId: "book-1", label: "42" },
    chapterId: "ch-1",
    chapterOrder: 1,
    tags: [],
    reviewPriority: null,
    reviewStatus: "approved",
    solutionSource: "none",
    solutionRef: null,
    variantOf: null,
    importBatchId: null,
    importedAt: null,
    modules: { question: { tex: "" }, solution: { tex: "" }, note: { tex: "" } },
    assets: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeBank(overrides: Partial<Bank> = {}): Bank {
  return {
    version: 3,
    settings: { preamble: "", pageSize: "a4", spacing: { item: "1em", module: "1em" } },
    chapters: [{ id: "ch-1", name: "章一", order: 1 }],
    books: [
      {
        id: "book-1",
        title: "书一",
        filePath: null,
        fileHash: null,
        answerBookPath: null,
        answerBookHash: null,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    imports: [],
    items: [],
    ...overrides
  };
}

describe("restoreDeletedItem", () => {
  it("rejects an undo when another item reused the book and label", () => {
    const deleted = makeItem();
    const bank = makeBank({
      items: [makeItem({ id: "replacement" })]
    });
    expect(() => restoreDeletedItem(bank, deleted, NOW)).toThrow("42");
    expect(bank.items).toHaveLength(1);
  });

  it("allows bookless duplicates and the same label in another book", () => {
    const bookless = makeBank({
      items: [makeItem({ id: "other", source: { bookId: null, label: "42" } })]
    });
    expect(
      restoreDeletedItem(
        bookless,
        makeItem({ source: { bookId: null, label: "42" } }),
        NOW
      ).items
    ).toHaveLength(2);

    const otherBook = makeBank({
      items: [makeItem({ id: "other", source: { bookId: "book-2", label: "42" } })]
    });
    expect(
      restoreDeletedItem(otherBook, makeItem(), NOW).items
    ).toHaveLength(2);
  });

  it("restores an item unchanged when its chapter and book still exist", () => {
    const result = restoreDeletedItem(makeBank(), makeItem(), NOW);
    const restored = result.items.find((item) => item.id === "q-deleted");
    expect(restored?.chapterId).toBe("ch-1");
    expect(restored?.source).toEqual({ bookId: "book-1", label: "42" });
  });

  it("moves the item to uncategorized when its chapter was deleted", () => {
    const result = restoreDeletedItem(makeBank({ chapters: [] }), makeItem(), NOW);
    const restored = result.items.find((item) => item.id === "q-deleted");
    expect(restored?.chapterId).toBeNull();
    expect(restored?.chapterOrder).toBeGreaterThanOrEqual(1);
  });

  it("clears a book reference that no longer exists", () => {
    const result = restoreDeletedItem(makeBank({ books: [] }), makeItem(), NOW);
    expect(
      result.items.find((item) => item.id === "q-deleted")?.source
    ).toEqual({ bookId: null, label: "42" });
  });

  it("is a no-op when the item is already present (double undo)", () => {
    const existing = makeItem();
    const bank = makeBank({ items: [existing] });
    const result = restoreDeletedItem(bank, existing, NOW);
    expect(result).toBe(bank);
    expect(result.items).toHaveLength(1);
  });

  it("reinserts at the original chapter slot and shifts following items", () => {
    const bank = makeBank({
      items: [
        makeItem({
          id: "q-1",
          chapterOrder: 1,
          source: { bookId: "book-1", label: "1" }
        }),
        makeItem({
          id: "q-3",
          chapterOrder: 2,
          source: { bookId: "book-1", label: "3" }
        })
      ]
    });
    const result = restoreDeletedItem(
      bank,
      makeItem({
        id: "q-2",
        chapterOrder: 2,
        source: { bookId: "book-1", label: "2" }
      }),
      NOW
    );
    const chapterItems = result.items
      .filter((item) => item.chapterId === "ch-1")
      .sort((left, right) => left.chapterOrder - right.chapterOrder);
    expect(chapterItems.map((item) => item.id)).toEqual(["q-1", "q-2", "q-3"]);
    expect(chapterItems.map((item) => item.chapterOrder)).toEqual([1, 2, 3]);
  });
});
