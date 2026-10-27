import { describe, expect, it } from "vitest";
import {
  groupTagsByDimension,
  replaceTagGroup,
  stripTagPrefix,
  tagDimensionOf
} from "../../src/tagDimensions.js";

describe("tag dimensions", () => {
  it("recognizes the three prefixes and leaves other tags alone", () => {
    expect(tagDimensionOf("考点·数列极限")?.key).toBe("topic");
    expect(tagDimensionOf("考法·夹逼准则")?.key).toBe("method");
    expect(tagDimensionOf("题型·选择")?.key).toBe("type");
    expect(tagDimensionOf("极限")).toBeNull();
    expect(tagDimensionOf("考点数列极限")).toBeNull();
    expect(stripTagPrefix("考点·数列极限")).toBe("数列极限");
    expect(stripTagPrefix("极限")).toBe("极限");
  });

  it("groups tags by dimension, keeping order", () => {
    expect(
      groupTagsByDimension(["考点·甲", "题型·选择", "杂项", "考点·乙", "考法·丙"])
    ).toEqual({
      byDimension: { topic: ["考点·甲", "考点·乙"], method: ["考法·丙"], type: ["题型·选择"] },
      other: ["杂项"]
    });
  });

  it("replaces one group without reordering or touching the others", () => {
    const tags = ["考点·甲", "题型·选择", "杂项", "考点·乙"];
    expect(replaceTagGroup(tags, "topic", ["考点·乙", "考点·丙"])).toEqual([
      "题型·选择", "杂项", "考点·乙", "考点·丙"
    ]);
    expect(replaceTagGroup(tags, "topic", [])).toEqual(["题型·选择", "杂项"]);
    expect(replaceTagGroup(tags, null, ["杂项", "新"])).toEqual([
      "考点·甲", "题型·选择", "杂项", "考点·乙", "新"
    ]);
    expect(replaceTagGroup(tags, "type", ["题型·选择"])).toEqual(tags);
  });
});
