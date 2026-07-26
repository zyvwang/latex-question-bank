import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank, QuestionItem } from "../../shared/types.js";
import {
  buildHeatmapGroups,
  describeHeatmapItem,
  nextHeatmapItemId,
  toChineseNumber
} from "../../src/heatmap.js";

describe("heatmap domain", () => {
  it("builds chapter rows in chapter order and leaves uncategorized last", () => {
    const bank = heatmapBank();
    const groups = buildHeatmapGroups(bank);

    expect(groups.map(({ numeral, name }) => ({ numeral, name }))).toEqual([
      { numeral: "一", name: "极限" },
      { numeral: "二", name: "矩阵" },
      { numeral: null, name: "未分类" }
    ]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["limit-1", "limit-2"],
      ["matrix-1"],
      ["loose-1"]
    ]);
  });

  it("formats chapter numerals without losing interior zeroes", () => {
    expect(
      [1, 10, 11, 20, 101, 1010, 1001, 9999].map(toChineseNumber)
    ).toEqual([
      "一",
      "十",
      "十一",
      "二十",
      "一百零一",
      "一千零一十",
      "一千零一",
      "九千九百九十九"
    ]);
  });

  it("moves horizontally across rows and vertically by chapter-local position", () => {
    const groups = buildHeatmapGroups(heatmapBank());

    expect(nextHeatmapItemId(groups, "limit-2", "ArrowRight")).toBe("matrix-1");
    expect(nextHeatmapItemId(groups, "matrix-1", "ArrowLeft")).toBe("limit-2");
    expect(nextHeatmapItemId(groups, "limit-2", "ArrowDown")).toBe("matrix-1");
    expect(nextHeatmapItemId(groups, "matrix-1", "ArrowDown")).toBe("loose-1");
    expect(nextHeatmapItemId(groups, "matrix-1", "ArrowUp")).toBe("limit-1");
    expect(nextHeatmapItemId(groups, "limit-2", "Home")).toBe("limit-1");
    expect(nextHeatmapItemId(groups, "limit-1", "End")).toBe("limit-2");
  });

  it("describes every review field in the accessible name", () => {
    const bank = heatmapBank();
    const group = buildHeatmapGroups(bank)[0];
    const description = describeHeatmapItem(bank, group, group.items[0]);

    expect(description).toContain("章节 极限");
    expect(description).toContain("章内第 1 题");
    expect(description).toContain("原编号 2026-A");
    expect(description).toContain("掌握程度 待巩固");
    expect(description).toContain("错误原因 计算、方法");
  });
});

function heatmapBank(): Bank {
  const base = createSampleBank();
  const timestamp = "2026-07-26T08:00:00.000Z";
  const item = (
    id: string,
    chapterId: string | null,
    chapterOrder: number,
    sourceNumber: string
  ): QuestionItem => ({
    ...base.items[0],
    id,
    chapterId,
    chapterOrder,
    sourceNumber,
    masteryOptionId: "mastery-review",
    errorReasonOptionIds: ["error-calculation", "error-method"],
    createdAt: timestamp,
    updatedAt: timestamp
  });
  return {
    ...base,
    chapters: [
      { id: "chapter-matrix", name: "矩阵", order: 2 },
      { id: "chapter-limit", name: "极限", order: 1 }
    ],
    masteryOptions: [
      {
        id: "mastery-review",
        name: "待巩固",
        order: 1,
        color: "#9A4C35",
        pattern: "diagonal"
      }
    ],
    errorReasonOptions: [
      {
        id: "error-calculation",
        name: "计算",
        order: 1,
        color: "#A9571C",
        pattern: "diagonal"
      },
      {
        id: "error-method",
        name: "方法",
        order: 2,
        color: "#74558F",
        pattern: "crosshatch"
      }
    ],
    items: [
      item("matrix-1", "chapter-matrix", 1, "2026-M"),
      item("limit-2", "chapter-limit", 2, "2026-B"),
      item("loose-1", null, 1, ""),
      item("limit-1", "chapter-limit", 1, "2026-A")
    ]
  };
}
