import { describe, expect, it } from "vitest";
import {
  validateAgentImportManifest,
  type AgentImportManifest
} from "../../shared/agent-manifest.js";

function validManifest(): AgentImportManifest {
  return {
    schemaVersion: 1,
    batch: { note: "A 书错题", agent: "qoder" },
    books: [{ title: "A 书" }],
    questions: [
      {
        source: { bookTitle: "A 书", label: "例 3.58" },
        chapterName: "函数、极限与连续",
        topics: ["函数极限", "洛必达"],
        questionTypes: ["解答"],
        reviewPriority: "must",
        modules: {
          question: { tex: "求极限 $x$。" },
          solution: { tex: "答案为 $1$。" }
        },
        solutionSource: "answer-book",
        solutionRef: "A答案册 P88",
        assets: []
      }
    ]
  };
}

describe("agent import manifest validation", () => {
  it("accepts a valid manifest and normalizes optional fields", () => {
    const value = validManifest();
    const result = validateAgentImportManifest(value);
    expect(result.ok).toBe(true);
    expect(result.value?.questions[0].source).toEqual({
      bookTitle: "A 书",
      label: "例 3.58"
    });
    expect(result.value?.questions[0].modules.note).toBeUndefined();
    expect(result.value?.questions[0].topics).toEqual(["函数极限", "洛必达"]);
    expect(result.value?.questions[0].questionTypes).toEqual(["解答"]);
  });

  it("accepts assets with relative file paths", () => {
    const value = validManifest();
    value.assets = [
      {
        key: "shot",
        originalName: "shot.png",
        filePath: "images/shot.png"
      }
    ];
    value.questions[0].assets = ["shot"];
    expect(validateAgentImportManifest(value).value?.assets?.[0].filePath).toBe(
      "images/shot.png"
    );
  });

  it("accepts create-bank metadata and normalized chapter names", () => {
    const value: AgentImportManifest = {
      ...validManifest(),
      bank: {
        name: "Ｂ 书",
        path: "/tmp/b-book",
        copySettingsFromCurrent: true
      },
      chapters: [{ name: "第一章" }, { name: "第二章" }]
    };
    const result = validateAgentImportManifest(value);
    expect(result.ok).toBe(true);
    expect(result.value?.bank).toEqual({
      name: "B 书",
      path: "/tmp/b-book",
      copySettingsFromCurrent: true
    });
    expect(result.value?.chapters?.map((chapter) => chapter.name)).toEqual([
      "第一章",
      "第二章"
    ]);
  });

  it("rejects malformed create-bank metadata", () => {
    const cases: unknown[] = [
      { ...validManifest(), bank: { name: "" } },
      {
        ...validManifest(),
        bank: { name: "B 书", copySettingsFromCurrent: "yes" }
      },
      {
        ...validManifest(),
        chapters: [{ name: "第一章" }, { name: " 第一章 " }]
      },
      { ...validManifest(), chapters: ["第一章"] }
    ];
    for (const value of cases) {
      expect(validateAgentImportManifest(value).ok).toBe(false);
    }
  });

  it("rejects invalid schemas and unsafe content", () => {
    const cases: unknown[] = [
      { ...validManifest(), schemaVersion: 2 },
      { ...validManifest(), questions: [] },
      {
        ...validManifest(),
        questions: [
          {
            ...validManifest().questions[0],
            modules: { question: { tex: "题目" }, solution: { tex: "解答" } },
            solutionSource: undefined
          }
        ]
      },
      {
        ...validManifest(),
        questions: [
          {
            ...validManifest().questions[0],
            topics: ["待审阅"]
          }
        ]
      },
      {
        ...validManifest(),
        questions: [
          {
            ...validManifest().questions[0],
            questionTypes: ["待审阅"]
          }
        ]
      },
      {
        ...validManifest(),
        questions: [{ ...validManifest().questions[0], questionTypes: "解答" }]
      },
      {
        // 旧字段 tags 已拆分：直接拒绝，避免 Agent 以为写进去了。
        ...validManifest(),
        questions: [{ ...validManifest().questions[0], tags: ["考点·极限"] }]
      },
      {
        ...validManifest(),
        questions: [
          {
            ...validManifest().questions[0],
            reviewPriority: "urgent"
          }
        ]
      },
      {
        ...validManifest(),
        assets: [
          { key: "same", originalName: "a.png" },
          { key: "same", originalName: "b.png" }
        ]
      },
      {
        ...validManifest(),
        questions: [
          {
            ...validManifest().questions[0],
            assets: ["missing"]
          }
        ]
      },
      {
        ...validManifest(),
        books: [{ title: "A 书", fileHash: "bad" }]
      }
    ];
    for (const value of cases) {
      expect(validateAgentImportManifest(value).ok).toBe(false);
    }
  });
});
