import { describe, expect, it } from "vitest";
import type { Chapter, QuestionItem, ReviewPriority } from "../../shared/types.js";
import { UNSET_PRIORITY_FILTER } from "../../src/questionFilters.js";
import {
  DISTRIBUTION_STATUSES,
  buildDistributionGroups,
  countByPriority,
  describeDistributionItem,
  distributionStatusFilter,
  distributionStatusLabel,
  nextDistributionItemId,
  percentOf,
  toChineseNumber
} from "../../src/reviewDistribution.js";

function item(
  id: string,
  chapterId: string | null,
  reviewPriority: ReviewPriority | null = null
): QuestionItem {
  return { id, chapterId, reviewPriority } as QuestionItem;
}

const chapters: Chapter[] = [
  { id: "a", name: "极限", order: 1 },
  { id: "empty", name: "空章", order: 2 },
  { id: "b", name: "矩阵", order: 3 }
];

describe("buildDistributionGroups", () => {
  it("keeps chapter order, skips empty chapters, and puts uncategorized last", () => {
    const groups = buildDistributionGroups(
      [item("loose", null), item("b1", "b", "must"), item("a1", "a"), item("a2", "a")],
      chapters
    );
    expect(groups.map((group) => group.name)).toEqual(["极限", "矩阵", "未分类"]);
    expect(groups.map((group) => group.items.map((entry) => entry.id))).toEqual([
      ["a1", "a2"],
      ["b1"],
      ["loose"]
    ]);
  });

  it("numbers chapters by their full position so a skipped chapter keeps its gap", () => {
    const groups = buildDistributionGroups(
      [item("a1", "a"), item("b1", "b"), item("loose", null)],
      chapters
    );
    expect(groups.map((group) => group.numeral)).toEqual(["一", "三", null]);
  });

  it("omits the uncategorized group when every question has a chapter", () => {
    expect(buildDistributionGroups([item("a1", "a")], chapters)).toHaveLength(1);
  });

  it("counts each group separately", () => {
    const [first, second] = buildDistributionGroups(
      [item("a1", "a", "must"), item("a2", "a", "recheck"), item("b1", "b", "skip")],
      chapters
    );
    expect(first.counts).toEqual({ must: 1, recheck: 1, skip: 0, unset: 0 });
    expect(second.counts).toEqual({ must: 0, recheck: 0, skip: 1, unset: 0 });
  });
});

describe("status helpers", () => {
  it("counts all four states, treating null as unset", () => {
    expect(
      countByPriority([
        item("1", "a", "must"),
        item("2", "a", "must"),
        item("3", "a", "recheck"),
        item("4", "a", "skip"),
        item("5", "a")
      ])
    ).toEqual({ must: 2, recheck: 1, skip: 1, unset: 1 });
  });

  it("orders and labels statuses as the page shows them", () => {
    expect(DISTRIBUTION_STATUSES.map(distributionStatusLabel)).toEqual([
      "必须看",
      "再看看",
      "不用看",
      "未标记"
    ]);
  });

  it("maps unset onto the sidebar filter value", () => {
    expect(distributionStatusFilter("unset")).toBe(UNSET_PRIORITY_FILTER);
    expect(distributionStatusFilter("must")).toBe("must");
  });

  it("rounds percentages and never divides by zero", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(0, 0)).toBe(0);
  });

  it("describes a cell without relying on colour", () => {
    expect(
      describeDistributionItem({
        chapterName: "极限",
        chapterOrder: 3,
        sourceText: null,
        status: "unset"
      })
    ).toBe("章节 极限，章内第 3 题，来源 未设置，复习优先级 未标记");
  });
});

describe("nextDistributionItemId", () => {
  const groups = buildDistributionGroups(
    [item("a1", "a"), item("a2", "a"), item("a3", "a"), item("b1", "b")],
    chapters
  );

  it("moves through the whole sequence with left and right and stops at the ends", () => {
    expect(nextDistributionItemId(groups, "a3", "ArrowRight")).toBe("b1");
    expect(nextDistributionItemId(groups, "b1", "ArrowLeft")).toBe("a3");
    expect(nextDistributionItemId(groups, "a1", "ArrowLeft")).toBe("a1");
    expect(nextDistributionItemId(groups, "b1", "ArrowRight")).toBe("b1");
  });

  it("clamps vertical moves to the adjacent chapter's last cell", () => {
    expect(nextDistributionItemId(groups, "a3", "ArrowDown")).toBe("b1");
    expect(nextDistributionItemId(groups, "b1", "ArrowUp")).toBe("a1");
    expect(nextDistributionItemId(groups, "a1", "ArrowUp")).toBe("a1");
    expect(nextDistributionItemId(groups, "b1", "ArrowDown")).toBe("b1");
  });

  it("jumps within the chapter with Home and End", () => {
    expect(nextDistributionItemId(groups, "a2", "Home")).toBe("a1");
    expect(nextDistributionItemId(groups, "a2", "End")).toBe("a3");
  });

  it("stays put for an unknown id", () => {
    expect(nextDistributionItemId(groups, "gone", "ArrowRight")).toBe("gone");
  });
});

describe("toChineseNumber", () => {
  it.each([
    [1, "一"],
    [10, "十"],
    [12, "十二"],
    [20, "二十"],
    [105, "一百零五"]
  ])("formats %i", (value, expected) => {
    expect(toChineseNumber(value)).toBe(expected);
  });

  it("falls back to digits outside the supported range", () => {
    expect(toChineseNumber(0)).toBe("0");
  });
});
