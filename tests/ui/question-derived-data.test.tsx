import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank, QuestionItem } from "../../shared/types.js";
import type { QuestionFilters } from "../../src/questionFilters.js";
import { useQuestionDerivedData } from "../../src/hooks/useQuestionDerivedData.js";

const emptyFilters: QuestionFilters = {
  chapterFilters: [],
  tagFilters: [],
  masteryFilters: [],
  errorReasonFilters: [],
  search: ""
};

describe("question derived data hot path", () => {
  it("reuses structure-only derived data when only module text changes", () => {
    const bank = bankWithItems(20);
    const { result, rerender } = renderHook(
      ({ currentBank }) => useQuestionDerivedData(
        currentBank,
        currentBank.items[0]?.id ?? null,
        emptyFilters,
        new Set<string>(),
        "current"
      ),
      { initialProps: { currentBank: bank } }
    );
    const firstNumberById = result.current.numberById;
    const firstTags = result.current.tags;
    const firstConflictGroups = result.current.conflictGroups;
    const active = bank.items[0];
    if (!active) throw new Error("测试题库缺少题目");

    rerender({
      currentBank: {
        ...bank,
        items: bank.items.map((item) => item.id === active.id
          ? {
              ...item,
              modules: {
                ...item.modules,
                question: { tex: `${item.modules.question.tex} changed` }
              }
            }
          : item)
      }
    });

    expect(result.current.numberById).toBe(firstNumberById);
    expect(result.current.tags).toBe(firstTags);
    expect(result.current.conflictGroups).toBe(firstConflictGroups);
  });

  it("rebuilds full-text search only for the changed item in a 1000-item bank", () => {
    const reads = { count: 0 };
    const bank = bankWithItems(1000, reads);
    const searchFilters = { ...emptyFilters, search: "question" };
    const { rerender } = renderHook(
      ({ currentBank }) => useQuestionDerivedData(
        currentBank,
        currentBank.items[0]?.id ?? null,
        searchFilters,
        new Set<string>(),
        "current"
      ),
      { initialProps: { currentBank: bank } }
    );
    expect(reads.count).toBe(3000);
    reads.count = 0;
    const active = bank.items[0];
    if (!active) throw new Error("测试题库缺少题目");

    rerender({
      currentBank: {
        ...bank,
        items: bank.items.map((item) => item.id === active.id
          ? countedItem(0, reads, "question 0 changed", active.chapterId)
          : item)
      }
    });

    expect(reads.count).toBe(3);
  });
});

function bankWithItems(count: number, reads?: { count: number }): Bank {
  const base = createSampleBank();
  const chapterId = base.chapters[0]?.id ?? null;
  return {
    ...base,
    items: Array.from({ length: count }, (_, index) =>
      countedItem(index, reads, `question ${index}`, chapterId)
    )
  };
}

function countedItem(
  index: number,
  reads?: { count: number },
  questionTex = `question ${index}`,
  chapterId: string | null = "chapter-limits"
): QuestionItem {
  const tex = (value: string) => {
    const module = { tex: value };
    if (reads) {
      Object.defineProperty(module, "tex", {
        configurable: true,
        get() {
          reads.count += 1;
          return value;
        }
      });
    }
    return module;
  };
  return {
    id: `item-${index}`,
    sourceNumber: `S-${index}`,
    chapterId,
    chapterOrder: index + 1,
    tags: [index % 2 === 0 ? "偶数" : "奇数"],
    masteryOptionId: null,
    errorReasonOptionIds: [],
    modules: {
      question: tex(questionTex),
      solution: tex(`solution ${index}`),
      note: tex(`note ${index}`)
    },
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
