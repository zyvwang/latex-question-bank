import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import {
  collectLegacyImagePaths,
  planImageNormalize
} from "../../server/agent-image-plan.js";
import type { Bank } from "../../shared/types.js";

const NOW = "2026-10-27T00:00:00.000Z";

function bankWith(question: string, solution = ""): Bank {
  const bank = createSampleBank();
  const [first, ...rest] = bank.items;
  return {
    ...bank,
    items: [
      {
        ...first!,
        modules: {
          ...first!.modules,
          question: { tex: question },
          solution: { tex: solution }
        }
      },
      ...rest
    ]
  };
}

describe("planImageNormalize", () => {
  it("rewrites centered and bare legacy images by pixel size", () => {
    const bank = bankWith(
      "看图。\n\\begin{center}\n\\includegraphics[width=0.75\\linewidth]{assets/wide.png}\n\\end{center}\n后文",
      "如图 \\includegraphics[width=0.75\\linewidth]{assets/small.png}。"
    );
    expect(collectLegacyImagePaths(bank).sort()).toEqual(["assets/small.png", "assets/wide.png"]);

    const plan = planImageNormalize({
      current: bank,
      dimensions: new Map([
        ["assets/wide.png", { width: 1800, height: 600 }],
        ["assets/small.png", { width: 580, height: 600 }]
      ]),
      now: NOW
    });
    const item = plan.bank.items[0]!;
    expect(item.modules.question.tex).toBe("看图。\n\\qimg[l]{assets/wide.png}\n后文");
    expect(item.modules.solution.tex).toBe("如图 \\qimg[s]{assets/small.png}。");
    expect(item.updatedAt).toBe(NOW);
    expect(item.reviewStatus).toBe(bank.items[0]!.reviewStatus);
    expect(plan.counts).toEqual({ items: 1, images: 2, skipped: 0 });
    expect(plan.changes.map((change) => [change.module, change.size])).toEqual([
      ["question", "l"],
      ["solution", "s"]
    ]);
  });

  it("leaves custom widths, other items and unreadable images untouched", () => {
    const bank = bankWith(
      [
        "\\includegraphics[width=0.4\\linewidth]{assets/custom.png}",
        "\\includegraphics[width=0.75\\linewidth]{assets/missing.png}"
      ].join("\n")
    );
    const plan = planImageNormalize({ current: bank, dimensions: new Map(), now: NOW });
    expect(plan.bank.items).toEqual(bank.items);
    expect(plan.changes).toEqual([]);
    expect(plan.warnings).toEqual([
      expect.objectContaining({ path: "assets/missing.png", reason: "unreadable" })
    ]);
    expect(plan.counts).toEqual({ items: 0, images: 0, skipped: 1 });
  });
});
