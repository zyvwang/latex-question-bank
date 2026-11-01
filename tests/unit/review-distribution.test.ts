import { describe, expect, it } from "vitest";
import type { Chapter, QuestionItem, ReviewPriority } from "../../shared/types.js";
import { UNSET_PRIORITY_FILTER } from "../../src/questionFilters.js";
import {
  DISTRIBUTION_STATUSES,
  buildDistributionGroups,
  countByPriority,
  distributionStatusFilter,
  distributionStatusLabel,
  percentOf
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
});
