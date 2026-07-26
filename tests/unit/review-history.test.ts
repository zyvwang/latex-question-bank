import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank, QuestionItem } from "../../shared/types.js";
import {
  defaultMasteryHistoryName,
  deleteMasteryHistory,
  localDateKey,
  needsHistoryCapacityDecision,
  oldestMasteryHistoryId,
  recordReviewMutation,
  renameMasteryHistory,
  restoreMasteryHistoryState
} from "../../src/review-history.js";

describe("review history", () => {
  it("creates one local-day snapshot and keeps updating that day's final state", () => {
    const initial = createSampleBank();
    const morning = localDate(2026, 7, 25, 9);
    const evening = localDate(2026, 7, 25, 21);
    const first = recordReviewMutation(
      initial,
      (bank) => updateFirstItem(bank, {
        masteryOptionId: "mastery-hard"
      }),
      mutationOptions(morning, "history-day-1")
    );

    expect(first.masteryHistory).toHaveLength(1);
    expect(first.masteryHistory[0]).toMatchObject({
      id: "history-day-1",
      localDate: "2026-07-25",
      name: "示例题库 · 2026-Jul-25",
      createdAt: morning.toISOString(),
      updatedAt: morning.toISOString()
    });
    expect(first.masteryHistory[0].itemStates[first.items[0].id])
      .toMatchObject({ masteryOptionId: "mastery-hard" });

    const second = recordReviewMutation(
      first,
      (bank) => updateFirstItem(bank, {
        errorReasonOptionIds: ["error-knowledge", "error-method"]
      }),
      mutationOptions(evening, "must-not-create")
    );
    expect(second.masteryHistory).toHaveLength(1);
    expect(second.masteryHistory[0]).toMatchObject({
      id: "history-day-1",
      name: "示例题库 · 2026-Jul-25",
      createdAt: morning.toISOString(),
      updatedAt: evening.toISOString()
    });
    expect(second.masteryHistory[0].itemStates[first.items[0].id]).toEqual({
      masteryOptionId: "mastery-hard",
      errorReasonOptionIds: ["error-knowledge", "error-method"]
    });
  });

  it("requires an explicit deletion before creating a sixth daily snapshot", () => {
    let bank = createSampleBank();
    for (let day = 21; day <= 25; day += 1) {
      bank = recordReviewMutation(
        bank,
        (current) => updateFirstItem(current, {
          masteryOptionId: day % 2 ? "mastery-hard" : "mastery-easy"
        }),
        mutationOptions(localDate(2026, 7, day, 12), `history-${day}`)
      );
    }
    const sixthDay = localDate(2026, 7, 26, 12);
    expect(needsHistoryCapacityDecision(bank, sixthDay)).toBe(true);
    expect(oldestMasteryHistoryId(bank.masteryHistory)).toBe("history-21");
    expect(() =>
      recordReviewMutation(
        bank,
        (current) => current,
        mutationOptions(sixthDay, "history-26")
      )
    ).toThrow("必须选择一份历史删除");

    const next = recordReviewMutation(
      bank,
      (current) => updateFirstItem(current, {
        masteryOptionId: "mastery-challenging"
      }),
      {
        ...mutationOptions(sixthDay, "history-26"),
        deleteHistoryId: "history-21"
      }
    );
    expect(next.masteryHistory).toHaveLength(5);
    expect(next.masteryHistory.map((entry) => entry.localDate)).toEqual([
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26"
    ]);
  });

  it("normalizes unique names and suffixes automatic conflicts", () => {
    const firstDate = localDate(2026, 7, 25, 12);
    const secondDate = localDate(2026, 7, 26, 12);
    let bank = recordReviewMutation(
      createSampleBank(),
      (current) => current,
      mutationOptions(firstDate, "history-first")
    );
    bank = renameMasteryHistory(
      bank,
      "history-first",
      defaultMasteryHistoryName("示例题库", secondDate),
      firstDate
    );
    bank = recordReviewMutation(
      bank,
      (current) => current,
      mutationOptions(secondDate, "history-second")
    );
    expect(bank.masteryHistory[1].name).toBe("示例题库 · 2026-Jul-26 (2)");

    expect(() =>
      renameMasteryHistory(
        bank,
        "history-second",
        "  示例题库 · ２０２６－ＪＵＬ－２６  ",
        secondDate
      )
    ).toThrow("历史名称已存在");
  });

  it("restores existing items, preserves new items, and merges option definitions", () => {
    const snapshotDate = localDate(2026, 7, 24, 12);
    const captured = recordReviewMutation(
      createSampleBank(),
      (current) => current,
      mutationOptions(snapshotDate, "history-snapshot")
    );
    const firstId = captured.items[0].id;
    const removedId = captured.items[1].id;
    const newItem: QuestionItem = {
      ...captured.items[0],
      id: "new-after-history",
      sourceNumber: "新增题",
      chapterId: null,
      chapterOrder: 1,
      masteryOptionId: "mastery-easy",
      errorReasonOptionIds: []
    };
    const changed: Bank = {
      ...captured,
      masteryOptions: [
        {
          ...captured.masteryOptions.find(
            (option) => option.id === "mastery-easy"
          )!,
          name: "当前简单"
        },
        {
          id: "replacement-challenging",
          name: "有难度",
          order: 2,
          color: "#886000",
          pattern: "dots"
        },
        captured.masteryOptions.find((option) => option.id === "mastery-hard")!
      ],
      errorReasonOptions: captured.errorReasonOptions.filter(
        (option) => option.id !== "error-method"
      ),
      items: [
        {
          ...captured.items[0],
          masteryOptionId: null,
          errorReasonOptionIds: []
        },
        newItem
      ]
    };
    const restored = restoreMasteryHistoryState(
      changed,
      "history-snapshot",
      localDate(2026, 7, 26, 12)
    );

    expect(restored.items.find((item) => item.id === firstId)).toMatchObject({
      masteryOptionId: "replacement-challenging",
      errorReasonOptionIds: ["error-method"]
    });
    expect(restored.items.find((item) => item.id === "new-after-history"))
      .toMatchObject({
        masteryOptionId: "mastery-easy",
        errorReasonOptionIds: []
      });
    expect(restored.items.some((item) => item.id === removedId)).toBe(false);
    expect(restored.masteryOptions.find((option) => option.id === "mastery-easy"))
      .toMatchObject({ name: "当前简单" });
    expect(restored.errorReasonOptions.find((option) => option.id === "error-method"))
      .toMatchObject({ name: "方法问题" });
  });

  it("records a restore in today's history and deletes only product history", () => {
    const firstDate = localDate(2026, 7, 24, 12);
    const secondDate = localDate(2026, 7, 25, 12);
    const captured = recordReviewMutation(
      createSampleBank(),
      (current) => current,
      mutationOptions(firstDate, "history-old")
    );
    const changed = updateFirstItem(captured, { masteryOptionId: null });
    const restored = recordReviewMutation(
      changed,
      (current) =>
        restoreMasteryHistoryState(current, "history-old", secondDate),
      mutationOptions(secondDate, "history-restore")
    );

    expect(restored.masteryHistory).toHaveLength(2);
    expect(restored.masteryHistory[1].itemStates[restored.items[0].id])
      .toMatchObject({ masteryOptionId: "mastery-challenging" });
    expect(deleteMasteryHistory(restored, "history-old").masteryHistory)
      .toHaveLength(1);
  });

  it("uses local calendar fields for date keys", () => {
    const date = localDate(2026, 1, 2, 0);
    expect(localDateKey(date)).toBe("2026-01-02");
  });
});

function mutationOptions(now: Date, id: string) {
  return {
    workspaceName: "示例题库",
    now,
    createId: () => id
  };
}

function updateFirstItem(
  bank: Bank,
  patch: Partial<QuestionItem>
): Bank {
  return {
    ...bank,
    items: bank.items.map((item, index) =>
      index === 0 ? { ...item, ...patch } : item
    )
  };
}

function localDate(
  year: number,
  month: number,
  day: number,
  hour: number
): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}
