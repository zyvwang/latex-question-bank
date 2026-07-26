import { describe, expect, it } from "vitest";
import { migrateLegacyBank } from "../../shared/bank-migration.js";
import type { LegacyBank, LegacyQuestionItem } from "../../shared/types.js";
import { validateBankPayload } from "../../shared/validation.js";
import { createSampleBank } from "../../server/bank-schema.js";

describe("v1 to v2 bank migration", () => {
  it("is deterministic, discards stars, and derives chapter-local order", () => {
    const legacy = createLegacyBank();
    const first = migrateLegacyBank(legacy);
    const second = migrateLegacyBank(legacy);

    expect(second).toEqual(first);
    expect(first.version).toBe(2);
    expect(first.chapters.map(({ name, order }) => ({ name, order }))).toEqual([
      { name: "第一章", order: 1 },
      { name: "第二章", order: 2 }
    ]);
    expect(first.items.map((item) => ({
      id: item.id,
      chapterId: item.chapterId,
      chapterOrder: item.chapterOrder,
      masteryOptionId: item.masteryOptionId,
      errorReasonOptionIds: item.errorReasonOptionIds
    }))).toEqual([
      {
        id: "first-a",
        chapterId: first.chapters[0].id,
        chapterOrder: 1,
        masteryOptionId: null,
        errorReasonOptionIds: []
      },
      {
        id: "uncategorized",
        chapterId: null,
        chapterOrder: 1,
        masteryOptionId: null,
        errorReasonOptionIds: []
      },
      {
        id: "second",
        chapterId: first.chapters[1].id,
        chapterOrder: 1,
        masteryOptionId: null,
        errorReasonOptionIds: []
      },
      {
        id: "first-b",
        chapterId: first.chapters[0].id,
        chapterOrder: 2,
        masteryOptionId: null,
        errorReasonOptionIds: []
      }
    ]);
    expect(first.masteryHistory).toEqual([]);
  });

  it("merges normalized legacy chapter names and permits old duplicate source numbers", () => {
    const legacy = createLegacyBank();
    legacy.items.push(
      createLegacyItem("first-case", 5, "第一章", "1")
    );
    legacy.items.push(
      createLegacyItem("first-normalized", 6, "  第一章  ", "1")
    );

    const result = validateBankPayload(legacy);
    expect(result.ok).toBe(true);
    expect(result.value?.chapters).toHaveLength(2);
    expect(
      result.value?.items.filter(
        (item) => item.chapterId === result.value?.chapters[0].id
      )
    ).toHaveLength(4);
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
  sourceNumber: string
): LegacyQuestionItem {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    order,
    sourceNumber,
    chapter,
    tags: ["legacy"],
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
