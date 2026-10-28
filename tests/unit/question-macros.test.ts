import { describe, expect, it } from "vitest";
import { findMacros } from "../../shared/latex-macros.js";
import { suggestImageSize } from "../../shared/image-size.js";
import { createSampleBank } from "../../server/bank-schema.js";
import { buildQuestionOnlyLatex, ensureChoiceParen } from "../../server/latex-renderer.js";
import type { QuestionItem } from "../../shared/types.js";

function questionWith(tex: string, questionTypes: string[]): QuestionItem {
  const item = createSampleBank().items[0]!;
  return {
    ...item,
    questionTypes,
    modules: { ...item.modules, question: { tex } }
  };
}

describe("findMacros", () => {
  it("parses nested braces, escaped braces and optional arguments", () => {
    const tex = "前\\choices{$\\frac{1}{2}$}{$\\{x\\}$} {B}\n{C} 后\\qimg[s]{assets/a.png}";
    const [choices] = findMacros(tex, "choices", 4);
    expect(choices?.args).toEqual(["$\\frac{1}{2}$", "$\\{x\\}$", "B", "C"]);
    expect(tex.slice(choices!.end)).toBe(" 后\\qimg[s]{assets/a.png}");
    expect(findMacros(tex, "qimg", 1)).toEqual([
      expect.objectContaining({ optional: "s", args: ["assets/a.png"] })
    ]);
  });

  it("skips longer macro names, escaped backslashes and incomplete input", () => {
    expect(findMacros("\\choicesX{a}{b}{c}{d}", "choices", 4)).toEqual([]);
    expect(findMacros("\\\\choices{a}{b}{c}{d}", "choices", 4)).toEqual([]);
    expect(findMacros("\\choices{a}{b}{c", "choices", 4)).toEqual([]);
    expect(findMacros("\\choices{a}{b}", "choices", 4)).toEqual([]);
  });
});

describe("ensureChoiceParen", () => {
  it("inserts the paren before the first options block", () => {
    expect(ensureChoiceParen("下列正确的是 \n\\choices{a}{b}{c}{d}")).toBe(
      "下列正确的是\\paren\n\\choices{a}{b}{c}{d}"
    );
  });

  it("leaves hand-laid-out options alone when there is no options block", () => {
    for (const tex of [
      "下列正确的是\n",
      "则\n\\begin{tabular}{cc}A. 1 & B. 2\\end{tabular}",
      "则\n\\begin{enumerate}\\item[(A)] 1\\end{enumerate}",
      "则\nA. 1 \\qquad B. 2 \\qquad C. 3 \\qquad D. 4"
    ]) {
      expect(ensureChoiceParen(tex)).toBe(tex);
    }
  });

  it("keeps existing brackets", () => {
    for (const tex of [
      "则\\paren 成立",
      "则（　）成立",
      "则（ ）成立",
      "则( )成立",
      "则（）成立",
      "正确的是（$\\quad$）\n\\choices{a}{b}{c}{d}",
      "正确的是（ $\\quad$ ）\n\\choices{a}{b}{c}{d}",
      "正确的是（\\quad）\n\\choices{a}{b}{c}{d}",
      "范围为 ( $\\qquad$ ).\n\\choices{a}{b}{c}{d}",
      "则（\\hspace{2em}）\n\\choices{a}{b}{c}{d}"
    ]) {
      expect(ensureChoiceParen(tex)).toBe(tex);
    }
  });
});

describe("question macros in exported LaTeX", () => {
  it("adds the paren only to choice questions", () => {
    const choice = buildQuestionOnlyLatex([
      questionWith("下列正确的是\nA. $1$\nB. $2$\nC. $3$\nD. $4$", ["选择"])
    ]);
    expect(choice).toContain("下列正确的是\\paren\n\\choices{$1$}{$2$}{$3$}{$4$}");

    const fill = buildQuestionOnlyLatex([questionWith("极限为 \\blank。", ["填空"])]);
    expect(fill).toContain("极限为 \\blank。");
    expect(fill).not.toContain("\\paren\n");
    expect(fill).toContain("\\newcommand{\\blank}[1][4em]");
    expect(fill).toContain("\\newcommand{\\qimg}[2][m]");
  });
});

describe("suggestImageSize", () => {
  it("picks small for narrow images, large for wide strips, medium otherwise", () => {
    expect(suggestImageSize({ width: 320, height: 240 })).toBe("s");
    expect(suggestImageSize({ width: 620, height: 480 })).toBe("s");
    expect(suggestImageSize({ width: 1600, height: 500 })).toBe("l");
    expect(suggestImageSize({ width: 900, height: 700 })).toBe("m");
    expect(suggestImageSize({ width: 800, height: 1600 })).toBe("m");
  });
});
