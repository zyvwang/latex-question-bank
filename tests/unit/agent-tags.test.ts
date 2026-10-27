import { describe, expect, it } from "vitest";
import {
  MAX_TAG_ENTRIES,
  validateAgentTagJournal,
  validateAgentTagManifest
} from "../../shared/agent-tags.js";

function manifestError(value: unknown): string | undefined {
  const result = validateAgentTagManifest(value);
  expect(result.ok).toBe(false);
  return result.error;
}

describe("agent tag manifest validation", () => {
  it("accepts per-item changes and normalizes tags that will be created", () => {
    const result = validateAgentTagManifest({
      schemaVersion: 1,
      field: "topics",
      note: "  考点归类 v1  ",
      changes: [
        {
          id: " q1 ",
          add: [" 考点·极限 ", "ＡＢ", "ab"],
          remove: ["旧标签", " 旧标签 "]
        },
        { id: "q2", remove: ["x"] }
      ]
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      schemaVersion: 1,
      field: "topics",
      note: "考点归类 v1",
      changes: [
        { id: "q1", add: ["考点·极限", "AB"], remove: ["旧标签"] },
        { id: "q2", remove: ["x"] }
      ]
    });
  });

  it("accepts global renames and deletions", () => {
    const result = validateAgentTagManifest({
      schemaVersion: 1,
      field: "topics",
      renames: [
        { from: "数列极限", to: "考点·数列极限" },
        { from: "函数极限", to: "考点·函数极限" }
      ],
      deletions: ["辨析"]
    });
    expect(result.ok).toBe(true);
    expect(result.value?.renames).toHaveLength(2);
    expect(result.value?.deletions).toEqual(["辨析"]);
  });

  it("does not require selectors to be valid new tags", () => {
    // 题库里已有的怪标签（含控制字符）仍然要能被移除和删除。
    const result = validateAgentTagManifest({
      schemaVersion: 1,
      field: "topics",
      changes: [{ id: "q1", remove: ["旧\t标签"] }]
    });
    expect(result.ok).toBe(true);
    expect(
      validateAgentTagManifest({ schemaVersion: 1, field: "topics", deletions: ["旧\t标签"] }).ok
    ).toBe(true);
  });

  it("rejects wrong shapes and versions", () => {
    expect(manifestError(null)).toContain("必须是对象");
    expect(manifestError({ schemaVersion: 2, changes: [] })).toContain(
      "schemaVersion"
    );
    expect(manifestError({ schemaVersion: 1, field: "topics" })).toContain("必须包含");
    expect(manifestError({ schemaVersion: 1, field: "topics", changes: [] })).toContain("必须包含");
    expect(manifestError({ schemaVersion: 1, field: "topics", changes: "x" })).toContain(
      "changes 必须是数组"
    );
    expect(manifestError({ schemaVersion: 1, field: "topics", note: 3, changes: [] })).toContain(
      "note"
    );
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        note: "x".repeat(201),
        deletions: ["a"]
      })
    ).toContain("note");
  });

  it("requires a known field", () => {
    expect(manifestError({ schemaVersion: 1, deletions: ["a"] })).toContain("field");
    expect(
      manifestError({ schemaVersion: 1, field: "tags", deletions: ["a"] })
    ).toContain("field");
    expect(
      validateAgentTagManifest({ schemaVersion: 1, field: "questionTypes", deletions: ["a"] })
        .value?.field
    ).toBe("questionTypes");
  });

  it("rejects unknown fields instead of silently ignoring typos", () => {
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        changes: [{ id: "q1", add: ["a"], removes: ["b"] }]
      })
    ).toContain("removes");
    expect(
      manifestError({ schemaVersion: 1, field: "topics", change: [], deletions: ["a"] })
    ).toContain("change");
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        renames: [{ from: "a", to: "b", note: "x" }]
      })
    ).toContain("note");
  });

  it("rejects mixing per-item changes with global operations", () => {
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        changes: [{ id: "q1", add: ["a"] }],
        deletions: ["b"]
      })
    ).toContain("不能与");
  });

  it("rejects invalid per-item entries", () => {
    const base = { schemaVersion: 1, field: "topics" };
    expect(manifestError({ ...base, changes: [{ add: ["a"] }] })).toContain(
      "changes[0].id"
    );
    expect(manifestError({ ...base, changes: [{ id: "q1" }] })).toContain(
      "至少需要"
    );
    expect(
      manifestError({
        ...base,
        changes: [
          { id: "q1", add: ["a"] },
          { id: "q1", remove: ["b"] }
        ]
      })
    ).toContain("重复");
    expect(
      manifestError({ ...base, changes: [{ id: "q1", add: ["A"], remove: ["a"] }] })
    ).toContain("不能同时添加和移除");
    expect(
      manifestError({ ...base, changes: [{ id: "q1", add: [" "] }] })
    ).toContain("不能为空");
    expect(
      manifestError({ ...base, changes: [{ id: "q1", add: [3] }] })
    ).toContain("必须是字符串");
    expect(
      manifestError({ ...base, changes: [{ id: "q1", add: ["a\nb"] }] })
    ).toContain("无效字符");
  });

  it("rejects the reserved review tag everywhere", () => {
    for (const manifest of [
      { schemaVersion: 1, field: "topics", changes: [{ id: "q1", add: ["待审阅"] }] },
      { schemaVersion: 1, field: "topics", changes: [{ id: "q1", remove: ["待审阅"] }] },
      { schemaVersion: 1, field: "topics", renames: [{ from: "待审阅", to: "x" }] },
      { schemaVersion: 1, field: "topics", renames: [{ from: "x", to: "待审阅" }] },
      { schemaVersion: 1, field: "topics", deletions: ["待审阅"] }
    ]) {
      expect(manifestError(manifest)).toContain("保留值");
    }
  });

  it("rejects ambiguous global operations", () => {
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        renames: [{ from: "A", to: "a" }]
      })
    ).toContain("相同");
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        renames: [
          { from: "a", to: "b" },
          { from: "A", to: "c" }
        ]
      })
    ).toContain("重复");
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        renames: [
          { from: "a", to: "b" },
          { from: "b", to: "c" }
        ]
      })
    ).toContain("链式改名");
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        renames: [
          { from: "a", to: "b" },
          { from: "b", to: "a" }
        ]
      })
    ).toContain("链式改名");
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        renames: [{ from: "a", to: "b" }],
        deletions: ["a"]
      })
    ).toContain("不能同时被改名和删除");
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        renames: [{ from: "a", to: "b" }],
        deletions: ["B"]
      })
    ).toContain("不能同时被改名和删除");
  });

  it("allows merging several tags into one target", () => {
    const result = validateAgentTagManifest({
      schemaVersion: 1,
      field: "topics",
      renames: [
        { from: "a", to: "c" },
        { from: "b", to: "c" }
      ]
    });
    expect(result.ok).toBe(true);
  });

  it("caps the number of entries", () => {
    const changes = Array.from({ length: MAX_TAG_ENTRIES + 1 }, (_value, index) => ({
      id: `q${index}`,
      add: ["a"]
    }));
    expect(manifestError({ schemaVersion: 1, field: "topics", changes })).toContain("最多");
    expect(
      manifestError({
        schemaVersion: 1,
        field: "topics",
        deletions: Array.from({ length: 201 }, (_value, index) => `t${index}`)
      })
    ).toContain("最多");
  });
});

describe("agent tag journal validation", () => {
  function journal(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      field: "topics",
      workspacePath: "/tmp/bank",
      createdAt: "2026-10-27T00:00:00.000Z",
      note: null,
      entries: [{ id: "q1", before: ["a"], after: ["b"] }],
      ...overrides
    };
  }

  it("accepts a journal and defaults a missing note to null", () => {
    const { note: _note, ...withoutNote } = journal();
    const result = validateAgentTagJournal(withoutNote);
    expect(result.ok).toBe(true);
    expect(result.value?.note).toBeNull();
    expect(result.value?.entries).toEqual([
      { id: "q1", before: ["a"], after: ["b"] }
    ]);
  });

  it("accepts stored tags that a new manifest would refuse", () => {
    const result = validateAgentTagJournal(
      journal({ entries: [{ id: "q1", before: ["旧\t标签"], after: [] }] })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects malformed journals", () => {
    for (const bad of [
      null,
      journal({ schemaVersion: 2 }),
      journal({ field: undefined }),
      journal({ field: "tags" }),
      journal({ workspacePath: " " }),
      journal({ createdAt: 3 }),
      journal({ note: 3 }),
      journal({ entries: [] }),
      journal({ entries: "x" }),
      journal({ entries: [{ id: "q1", before: "a", after: [] }] }),
      journal({ entries: [{ id: "q1", before: [], after: [1] }] }),
      journal({ entries: [{ id: "q1", before: [], after: [], extra: 1 }] }),
      journal({
        entries: [
          { id: "q1", before: [], after: ["a"] },
          { id: "q1", before: ["a"], after: [] }
        ]
      }),
      journal({ entries: [{ id: "q1", before: ["待审阅"], after: [] }] }),
      journal({
        entries: Array.from({ length: MAX_TAG_ENTRIES + 1 }, (_value, index) => ({
          id: `q${index}`,
          before: [],
          after: ["a"]
        }))
      })
    ]) {
      expect(validateAgentTagJournal(bad).ok).toBe(false);
    }
  });
});
