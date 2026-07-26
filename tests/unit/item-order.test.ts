import { describe, expect, it } from "vitest";
import { restoreDeletedItem } from "../../src/itemOrder.js";
import type { Bank, QuestionItem } from "../../shared/types.js";

const NOW = "2026-02-01T00:00:00.000Z";

function makeItem(overrides: Partial<QuestionItem> = {}): QuestionItem {
  return {
    id: "q-deleted",
    chapterId: "ch-1",
    chapterOrder: 1,
    tags: [],
    masteryOptionId: "m-1",
    errorReasonOptionIds: ["e-1"],
    modules: { question: { tex: "" }, solution: { tex: "" }, note: { tex: "" } },
    assets: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeBank(overrides: Partial<Bank> = {}): Bank {
  return {
    version: 2,
    settings: { preamble: "", pageSize: "a4", spacing: { item: "1em", module: "1em" } },
    chapters: [{ id: "ch-1", name: "章一", order: 1 }],
    masteryOptions: [
      { id: "m-1", name: "易", order: 1, color: "#2F766F", pattern: "solid" }
    ],
    errorReasonOptions: [
      { id: "e-1", name: "计算", order: 1, color: "#A9571C", pattern: "diagonal" }
    ],
    masteryHistory: [],
    items: [],
    ...overrides
  };
}

describe("restoreDeletedItem", () => {
  it("restores an item unchanged when its chapter and options still exist", () => {
    const result = restoreDeletedItem(makeBank(), makeItem(), NOW);
    const restored = result.items.find((item) => item.id === "q-deleted");
    expect(restored?.chapterId).toBe("ch-1");
    expect(restored?.masteryOptionId).toBe("m-1");
    expect(restored?.errorReasonOptionIds).toEqual(["e-1"]);
  });

  it("moves the item to uncategorized when its chapter was deleted", () => {
    const result = restoreDeletedItem(makeBank({ chapters: [] }), makeItem(), NOW);
    const restored = result.items.find((item) => item.id === "q-deleted");
    expect(restored?.chapterId).toBeNull();
    expect(restored?.chapterOrder).toBeGreaterThanOrEqual(1);
  });

  it("clears a mastery reference that no longer exists", () => {
    const result = restoreDeletedItem(makeBank({ masteryOptions: [] }), makeItem(), NOW);
    expect(
      result.items.find((item) => item.id === "q-deleted")?.masteryOptionId
    ).toBeNull();
  });

  it("drops error-reason references that no longer exist", () => {
    const result = restoreDeletedItem(
      makeBank({ errorReasonOptions: [] }),
      makeItem({ errorReasonOptionIds: ["e-1", "e-gone"] }),
      NOW
    );
    expect(
      result.items.find((item) => item.id === "q-deleted")?.errorReasonOptionIds
    ).toEqual([]);
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
        makeItem({ id: "q-1", chapterOrder: 1 }),
        makeItem({ id: "q-3", chapterOrder: 2 })
      ]
    });
    const result = restoreDeletedItem(
      bank,
      makeItem({ id: "q-2", chapterOrder: 2 }),
      NOW
    );
    const chapterItems = result.items
      .filter((item) => item.chapterId === "ch-1")
      .sort((left, right) => left.chapterOrder - right.chapterOrder);
    expect(chapterItems.map((item) => item.id)).toEqual(["q-1", "q-2", "q-3"]);
    expect(chapterItems.map((item) => item.chapterOrder)).toEqual([1, 2, 3]);
  });
});
