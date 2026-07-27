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
  restoreMasteryHistoryState,
  type ReviewMutationResult
} from "../../src/review-history.js";

describe("review history", () => {
  it("creates one local-day snapshot and keeps updating that day's final state", () => {
    const initial = createSampleBank();
    const morning = localDate(2026, 7, 25, 9);
    const evening = localDate(2026, 7, 25, 21);
    const first = expectOk(recordReviewMutation(
      initial,
      (bank) => updateFirstItem(bank, {
        masteryOptionId: "mastery-hard"
      }),
      mutationOptions(morning, "history-day-1")
    ));

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

    const second = expectOk(recordReviewMutation(
      first,
      (bank) => updateFirstItem(bank, {
        errorReasonOptionIds: ["error-knowledge", "error-method"]
      }),
      mutationOptions(evening, "must-not-create")
    ));
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

  it("reuses the stored state object for questions whose review state did not change", () => {
    const morning = localDate(2026, 7, 25, 9);
    const evening = localDate(2026, 7, 25, 21);
    const first = expectOk(recordReviewMutation(
      createSampleBank(),
      (bank) => updateFirstItem(bank, { masteryOptionId: "mastery-hard" }),
      mutationOptions(morning, "history-day-1")
    ));
    const untouchedId = first.items[1].id;
    const storedBefore = first.masteryHistory[0].itemStates[untouchedId];

    const second = expectOk(recordReviewMutation(
      first,
      (bank) => updateFirstItem(bank, { masteryOptionId: "mastery-easy" }),
      mutationOptions(evening, "must-not-create")
    ));

    // 行为契约,不是实现细节:整天下来只有零星几道题真的换状态。全量重建会给
    // 1000 题的库在每次点击时分配 ~2N 个对象,所以未变动的必须按引用复用。
    expect(second.masteryHistory[0].itemStates[untouchedId]).toBe(storedBefore);
    expect(second.masteryHistory[0].itemStates[first.items[0].id]).toMatchObject({
      masteryOptionId: "mastery-easy"
    });
  });

  it("reuses stored states when every question object is replaced but no review state changes", () => {
    const morning = localDate(2026, 7, 25, 9);
    const evening = localDate(2026, 7, 25, 21);
    const first = expectOk(recordReviewMutation(
      createSampleBank(),
      (bank) => updateFirstItem(bank, { masteryOptionId: "mastery-hard" }),
      mutationOptions(morning, "history-day-1")
    ));
    const storedBefore = { ...first.masteryHistory[0].itemStates };

    // deleteReviewOption 的形状:map 全部 items 换掉每个引用,但只有引用了被删
    // 选项的题真的变了。复用判断因此不能退化成对 QuestionItem 的引用比较。
    const second = expectOk(recordReviewMutation(
      first,
      (bank) => ({
        ...bank,
        items: bank.items.map((item) => ({
          ...item,
          updatedAt: evening.toISOString()
        }))
      }),
      mutationOptions(evening, "must-not-create")
    ));

    for (const item of second.items) {
      expect(second.masteryHistory[0].itemStates[item.id]).toBe(storedBefore[item.id]);
    }
  });

  it("tracks questions added and removed after the day's snapshot exists", () => {
    const morning = localDate(2026, 7, 25, 9);
    const noon = localDate(2026, 7, 25, 12);
    const evening = localDate(2026, 7, 25, 21);
    const first = expectOk(recordReviewMutation(
      createSampleBank(),
      (bank) => updateFirstItem(bank, { masteryOptionId: "mastery-hard" }),
      mutationOptions(morning, "history-day-1")
    ));
    const removedId = first.items[0].id;

    const withAdded = expectOk(recordReviewMutation(
      first,
      (bank) => ({
        ...bank,
        items: [...bank.items, addedItem(bank.items[0], "added-item")]
      }),
      mutationOptions(noon, "must-not-create")
    ));
    expect(withAdded.masteryHistory[0].itemStates["added-item"]).toEqual({
      masteryOptionId: "mastery-easy",
      errorReasonOptionIds: []
    });

    const withRemoved = expectOk(recordReviewMutation(
      withAdded,
      (bank) => ({
        ...bank,
        items: bank.items.filter((item) => item.id !== removedId)
      }),
      mutationOptions(evening, "must-not-create")
    ));
    expect(withRemoved.masteryHistory[0].itemStates).not.toHaveProperty(removedId);
    expect(Object.keys(withRemoved.masteryHistory[0].itemStates)).toHaveLength(
      withRemoved.items.length
    );
  });

  it("requires an explicit deletion before creating a sixth daily snapshot", () => {
    let bank = createSampleBank();
    for (let day = 21; day <= 25; day += 1) {
      bank = expectOk(recordReviewMutation(
        bank,
        (current) => updateFirstItem(current, {
          masteryOptionId: day % 2 ? "mastery-hard" : "mastery-easy"
        }),
        mutationOptions(localDate(2026, 7, day, 12), `history-${day}`)
      ));
    }
    const sixthDay = localDate(2026, 7, 26, 12);
    expect(needsHistoryCapacityDecision(bank, sixthDay)).toBe(true);
    expect(oldestMasteryHistoryId(bank.masteryHistory)).toBe("history-21");
    // 校验失败必须以 Result 返回:抛异常会在 setBank 的 updater 里炸开整棵树。
    expect(
      recordReviewMutation(
        bank,
        (current) => current,
        mutationOptions(sixthDay, "history-26")
      )
    ).toEqual({
      ok: false,
      error: expect.stringContaining("必须选择一份历史删除")
    });

    const next = expectOk(recordReviewMutation(
      bank,
      (current) => updateFirstItem(current, {
        masteryOptionId: "mastery-challenging"
      }),
      {
        ...mutationOptions(sixthDay, "history-26"),
        deleteHistoryId: "history-21"
      }
    ));
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
    let bank = expectOk(recordReviewMutation(
      createSampleBank(),
      (current) => current,
      mutationOptions(firstDate, "history-first")
    ));
    bank = expectOk(renameMasteryHistory(
      bank,
      "history-first",
      defaultMasteryHistoryName("示例题库", secondDate),
      firstDate
    ));
    bank = expectOk(recordReviewMutation(
      bank,
      (current) => current,
      mutationOptions(secondDate, "history-second")
    ));
    expect(bank.masteryHistory[1].name).toBe("示例题库 · 2026-Jul-26 (2)");

    expect(
      renameMasteryHistory(
        bank,
        "history-second",
        "  示例题库 · ２０２６－ＪＵＬ－２６  ",
        secondDate
      )
    ).toEqual({ ok: false, error: expect.stringContaining("历史名称已存在") });
    expect(renameMasteryHistory(bank, "history-second", "   ", secondDate))
      .toEqual({ ok: false, error: expect.stringContaining("不能为空") });
  });

  it("reports a missing history instead of throwing", () => {
    expect(restoreMasteryHistoryState(
      createSampleBank(),
      "does-not-exist",
      localDate(2026, 7, 26, 12)
    )).toEqual({ ok: false, error: expect.stringContaining("掌握历史不存在") });
  });

  it("restores existing items, preserves new items, and merges option definitions", () => {
    const snapshotDate = localDate(2026, 7, 24, 12);
    const captured = expectOk(recordReviewMutation(
      createSampleBank(),
      (current) => current,
      mutationOptions(snapshotDate, "history-snapshot")
    ));
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
    const restored = expectOk(restoreMasteryHistoryState(
      changed,
      "history-snapshot",
      localDate(2026, 7, 26, 12)
    ));

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
    const captured = expectOk(recordReviewMutation(
      createSampleBank(),
      (current) => current,
      mutationOptions(firstDate, "history-old")
    ));
    const changed = updateFirstItem(captured, { masteryOptionId: null });
    const restored = expectOk(recordReviewMutation(
      changed,
      (current) =>
        expectOk(restoreMasteryHistoryState(current, "history-old", secondDate)),
      mutationOptions(secondDate, "history-restore")
    ));

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

function expectOk(result: ReviewMutationResult): Bank {
  if (!result.ok) {
    throw new Error(`预期变更成功，实际失败：${result.error}`);
  }
  return result.bank;
}

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

function addedItem(template: QuestionItem, id: string): QuestionItem {
  return {
    ...template,
    id,
    sourceNumber: "",
    chapterOrder: template.chapterOrder + 1,
    masteryOptionId: "mastery-easy",
    errorReasonOptionIds: []
  };
}
