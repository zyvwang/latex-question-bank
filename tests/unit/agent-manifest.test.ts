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
        tags: ["洛必达", "函数极限"],
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
    expect(result.value?.questions[0].tags).toEqual(["洛必达", "函数极限"]);
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
            tags: ["待审阅"]
          }
        ]
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
