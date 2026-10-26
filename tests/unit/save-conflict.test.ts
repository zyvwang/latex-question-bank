import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import { summarizeBankConflict } from "../../src/save-conflict.js";

describe("save conflict summary", () => {
  it("classifies item and top-level differences without merging them", () => {
    const diskBank = createSampleBank();
    const localBank = {
      ...diskBank,
      settings: {
        ...diskBank.settings,
        preamble: `${diskBank.settings.preamble}\n% local`
      },
      chapters: diskBank.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, name: "本地章节名" } : chapter
      ),
      items: [
        {
          ...diskBank.items[0],
          modules: {
            ...diskBank.items[0].modules,
            note: { tex: "本地备注" }
          }
        },
        {
          ...diskBank.items[1],
          id: "local-only",
          source: { bookId: null, label: "local-only" }
        }
      ]
    };
    const diskWithExtra = {
      ...diskBank,
      items: [
        diskBank.items[0],
        {
          ...diskBank.items[1],
          id: "disk-only",
          source: { bookId: null, label: "disk-only" }
        }
      ]
    };

    expect(summarizeBankConflict(localBank, diskWithExtra)).toEqual({
      localOnlyItems: 1,
      diskOnlyItems: 1,
      changedItems: 1,
      settingsChanged: true,
      chaptersChanged: true,
      booksChanged: false,
      importsChanged: false
    });
  });
});
