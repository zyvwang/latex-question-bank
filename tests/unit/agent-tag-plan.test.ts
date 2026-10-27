import { describe, expect, it } from "vitest";
import {
  MAX_TAG_ENTRIES,
  type AgentTagManifest
} from "../../shared/agent-tags.js";
import type { Bank, QuestionItem } from "../../shared/types.js";
import { ValidationError } from "../../shared/validation-primitives.js";
import { createSampleBank } from "../../server/bank-schema.js";
import {
  buildTagJournal,
  planTagChanges,
  planTagRestore
} from "../../server/agent-tag-plan.js";

const now = "2026-10-27T00:00:00.000Z";

function bankWithTopics(topics: Record<string, string[]>): Bank {
  const sample = createSampleBank();
  return {
    ...sample,
    items: sample.items.map((item) => ({ ...item, topics: topics[item.id] ?? item.topics }))
  };
}

// 默认整理考点；测试题型时显式传 field。
function plan(
  bank: Bank,
  manifest: Omit<AgentTagManifest, "schemaVersion" | "field"> & {
    field?: AgentTagManifest["field"];
  }
) {
  return planTagChanges({
    current: bank,
    manifest: { schemaVersion: 1, field: "topics", ...manifest },
    now
  });
}

function item(bank: Bank, id: string): QuestionItem {
  const found = bank.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing item ${id}`);
  return found;
}

describe("planTagChanges (per-item)", () => {
  it("adds and removes topics without touching question types or review fields", () => {
    const current = createSampleBank();
    const result = plan(current, {
      changes: [
        { id: "sample-limit", add: ["函数极限"], remove: ["等价无穷小"] }
      ]
    });
    const changed = item(result.bank, "sample-limit");
    expect(changed.topics).toEqual(["极限", "函数极限"]);
    expect(changed.questionTypes).toBe(item(current, "sample-limit").questionTypes);
    expect(changed.updatedAt).toBe(now);
    expect(changed).toMatchObject({
      reviewStatus: "approved",
      reviewPriority: "recheck",
      importBatchId: null,
      importedAt: null,
      modules: item(current, "sample-limit").modules
    });
    expect(result.bank.imports).toBe(current.imports);
    expect(item(result.bank, "sample-linear-algebra")).toBe(
      item(current, "sample-linear-algebra")
    );
    expect(result.changes).toEqual([
      {
        id: "sample-limit",
        source: "示例题库 示例 1",
        before: ["极限", "等价无穷小"],
        after: ["极限", "函数极限"]
      }
    ]);
    expect(result.counts).toEqual({
      changed: 1,
      unchanged: 0,
      added: 1,
      removed: 1
    });
    expect(result.warnings).toEqual([]);
  });

  it("does not mutate the bank it was given", () => {
    const current = createSampleBank();
    const snapshot = structuredClone(current);
    plan(current, { changes: [{ id: "sample-limit", add: ["新"] }] });
    expect(current).toEqual(snapshot);
  });

  it("treats already-present adds and absent removes as unchanged", () => {
    const current = createSampleBank();
    const result = plan(current, {
      changes: [
        { id: "sample-limit", add: ["极限"], remove: ["不存在"] },
        { id: "sample-linear-algebra", add: ["矩阵"] }
      ]
    });
    expect(result.bank.items).toEqual(current.items);
    expect(result.changes).toEqual([]);
    expect(result.counts).toEqual({
      changed: 0,
      unchanged: 2,
      added: 0,
      removed: 0
    });
  });

  it("matches tags ignoring case and full-width forms but keeps untouched spellings", () => {
    const current = bankWithTopics({ "sample-limit": ["Taylor", "ＡＢ", "保留"] });
    const result = plan(current, {
      changes: [{ id: "sample-limit", remove: ["taylor", "AB"], add: ["保留"] }]
    });
    expect(item(result.bank, "sample-limit").topics).toEqual(["保留"]);
    expect(result.counts).toMatchObject({ changed: 1, added: 0, removed: 2 });
  });

  it("can leave a question with no tags", () => {
    const result = plan(createSampleBank(), {
      changes: [{ id: "sample-limit", remove: ["极限", "等价无穷小"] }]
    });
    expect(item(result.bank, "sample-limit").topics).toEqual([]);
  });

  it("rejects the whole change set when a question does not exist", () => {
    expect(() =>
      plan(createSampleBank(), {
        changes: [
          { id: "sample-limit", add: ["新"] },
          { id: "missing", add: ["新"] }
        ]
      })
    ).toThrow(ValidationError);
  });
});

describe("planTagChanges (global)", () => {
  const shared = bankWithTopics({
    "sample-limit": ["极限", "等价无穷小"],
    "sample-linear-algebra": ["矩阵", "极限", "函数极限"]
  });

  it("renames a tag and merges it into an existing target on the same question", () => {
    const result = plan(shared, {
      renames: [{ from: "极限", to: "函数极限" }]
    });
    expect(item(result.bank, "sample-limit").topics).toEqual([
      "函数极限",
      "等价无穷小"
    ]);
    expect(item(result.bank, "sample-linear-algebra").topics).toEqual([
      "矩阵",
      "函数极限"
    ]);
    expect(result.counts).toEqual({
      changed: 2,
      unchanged: 0,
      added: 1,
      removed: 2
    });
    expect(result.warnings).toEqual([]);
  });

  it("deletes a tag everywhere and leaves unrelated questions alone", () => {
    const result = plan(shared, { deletions: ["矩阵"] });
    expect(result.changes.map((change) => change.id)).toEqual([
      "sample-linear-algebra"
    ]);
    expect(item(result.bank, "sample-limit")).toBe(item(shared, "sample-limit"));
    expect(item(result.bank, "sample-linear-algebra").topics).toEqual([
      "极限",
      "函数极限"
    ]);
  });

  it("applies renames and deletions at the same time", () => {
    const result = plan(shared, {
      renames: [{ from: "等价无穷小", to: "无穷小比较" }],
      deletions: ["矩阵"]
    });
    expect(item(result.bank, "sample-limit").topics).toEqual([
      "极限",
      "无穷小比较"
    ]);
    expect(item(result.bank, "sample-linear-algebra").topics).toEqual([
      "极限",
      "函数极限"
    ]);
  });

  it("warns about tags that no question uses instead of failing", () => {
    const result = plan(shared, {
      renames: [{ from: "不存在", to: "x" }],
      deletions: ["也不存在"]
    });
    expect(result.changes).toEqual([]);
    expect(result.bank.items).toEqual(shared.items);
    expect(result.warnings).toEqual([
      { code: "TAG_NOT_FOUND", message: "没有题目使用考点「不存在」。" },
      { code: "TAG_NOT_FOUND", message: "没有题目使用考点「也不存在」。" }
    ]);
  });

  it("refuses to change more questions than a journal can hold", () => {
    const template = createSampleBank().items[0];
    const big: Bank = {
      ...createSampleBank(),
      items: Array.from({ length: MAX_TAG_ENTRIES + 1 }, (_value, index) => ({
        ...template,
        id: `q${index}`,
        source: null,
        topics: ["批量"]
      }))
    };
    expect(() => plan(big, { deletions: ["批量"] })).toThrow(/最多修改/);
  });
});

describe("planTagChanges (question types)", () => {
  it("changes only questionTypes and reports type warnings", () => {
    const current = createSampleBank();
    const result = plan(current, {
      field: "questionTypes",
      changes: [{ id: "sample-limit", add: ["证明"], remove: ["解答"] }]
    });
    const changed = item(result.bank, "sample-limit");
    expect(changed.questionTypes).toEqual(["证明"]);
    expect(changed.topics).toBe(item(current, "sample-limit").topics);
    expect(result.changes[0]).toMatchObject({ before: ["解答"], after: ["证明"] });

    // 考点里的同名值不受题型整理影响，也不算「有题在用」。
    const global = plan(current, { field: "questionTypes", deletions: ["极限"] });
    expect(global.changes).toEqual([]);
    expect(global.warnings).toEqual([
      { code: "TAG_NOT_FOUND", message: "没有题目使用题型「极限」。" }
    ]);
  });

  it("restores only the journal's field", () => {
    const current = createSampleBank();
    const result = plan(current, { field: "questionTypes", renames: [{ from: "填空", to: "选择" }] });
    const journal = buildTagJournal({
      field: "questionTypes",
      workspacePath: "/tmp/bank",
      note: undefined,
      now,
      changes: result.changes
    });
    const edited: Bank = {
      ...result.bank,
      items: result.bank.items.map((candidate) => ({
        ...candidate,
        topics: [...candidate.topics, "后加考点"]
      }))
    };
    const restore = planTagRestore({ current: edited, journal, now });
    expect(restore.conflicts).toEqual([]);
    const restored = item(restore.bank, "sample-linear-algebra");
    expect(restored.questionTypes).toEqual(["填空"]);
    expect(restored.topics).toEqual(["矩阵", "行列式", "后加考点"]);
  });
});

describe("planTagRestore", () => {
  function applied() {
    const before = createSampleBank();
    const result = plan(before, {
      changes: [
        { id: "sample-limit", add: ["函数极限"], remove: ["等价无穷小"] },
        { id: "sample-linear-algebra", add: ["矩阵运算"] }
      ]
    });
    const journal = buildTagJournal({
      field: "topics",
      workspacePath: "/tmp/bank",
      note: "归类",
      now,
      changes: result.changes
    });
    return { before, after: result.bank, journal };
  }

  it("builds a journal from the changed questions only", () => {
    const { journal } = applied();
    expect(journal).toEqual({
      schemaVersion: 1,
      field: "topics",
      workspacePath: "/tmp/bank",
      createdAt: now,
      note: "归类",
      entries: [
        {
          id: "sample-limit",
          before: ["极限", "等价无穷小"],
          after: ["极限", "函数极限"]
        },
        {
          id: "sample-linear-algebra",
          before: ["矩阵", "行列式"],
          after: ["矩阵", "行列式", "矩阵运算"]
        }
      ]
    });
    expect(
      buildTagJournal({ field: "topics", workspacePath: "/x", note: undefined, now, changes: [] })
        .note
    ).toBeNull();
  });

  it("restores the exact previous tags and keeps review state", () => {
    const { before, after, journal } = applied();
    const restore = planTagRestore({
      current: after,
      journal,
      now: "2026-10-28T00:00:00.000Z"
    });
    expect(restore.conflicts).toEqual([]);
    expect(restore.unchanged).toBe(0);
    expect(restore.restored.map((change) => change.id)).toEqual([
      "sample-limit",
      "sample-linear-algebra"
    ]);
    for (const original of before.items) {
      const restored = item(restore.bank, original.id);
      expect(restored.topics).toEqual(original.topics);
      expect(restored.reviewStatus).toBe(original.reviewStatus);
      expect(restored.updatedAt).toBe("2026-10-28T00:00:00.000Z");
    }
  });

  it("skips questions whose tags changed after the journal was written", () => {
    const { after, journal } = applied();
    const edited: Bank = {
      ...after,
      items: after.items.map((candidate) =>
        candidate.id === "sample-limit"
          ? { ...candidate, topics: [...candidate.topics, "用户后加"] }
          : candidate
      )
    };
    const restore = planTagRestore({ current: edited, journal, now });
    expect(restore.restored.map((change) => change.id)).toEqual([
      "sample-linear-algebra"
    ]);
    expect(restore.conflicts).toEqual([
      { id: "sample-limit", source: "示例题库 示例 1", reason: "changed" }
    ]);
    expect(item(restore.bank, "sample-limit").topics).toEqual([
      "极限",
      "函数极限",
      "用户后加"
    ]);
  });

  it("reports deleted questions and tolerates re-running an undo", () => {
    const { after, journal } = applied();
    const withoutOne: Bank = {
      ...after,
      items: after.items.filter((candidate) => candidate.id !== "sample-limit")
    };
    const first = planTagRestore({ current: withoutOne, journal, now });
    expect(first.conflicts).toEqual([
      { id: "sample-limit", source: "sample-limit", reason: "missing" }
    ]);
    expect(first.restored).toHaveLength(1);

    const second = planTagRestore({ current: first.bank, journal, now });
    expect(second.restored).toEqual([]);
    expect(second.unchanged).toBe(1);
    expect(second.bank.items).toEqual(first.bank.items);
  });
});
