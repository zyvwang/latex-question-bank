import { describe, expect, it } from "vitest";
import { splitUnsupportedEnvironments, translateLatexText } from "../../src/utils/latexText.js";

const text = (tex: string) => translateLatexText(tex).text;

describe("translateLatexText", () => {
  it("removes layout commands and keeps content", () => {
    expect(text("\\noindent (I) 连续；\\hfill (II) 间断")).toBe("(I) 连续；  (II) 间断");
    expect(translateLatexText("\\noindent 题").unsupported).toEqual([]);
  });

  it("treats single newlines as spaces and blank lines as paragraphs", () => {
    expect(text("Line one\nline two\n\nnext")).toBe("Line one line two\nnext");
    expect(text("中文换行\n接着写")).toBe("中文换行接着写");
  });

  it("converts explicit line breaks outside math only", () => {
    expect(text("甲\\\\乙\\newline 丙")).toBe("甲\n乙\n丙");
    const cases = "$\\begin{cases} a \\\\ b \\end{cases}$";
    expect(text(cases)).toBe(cases);
  });

  it("leaves every kind of math untouched", () => {
    for (const math of ["$a\\quad b$", "\\(a\\quad b\\)", "\\[a\\quad b\\]", "$$a\\quad b$$", "\\begin{align*}a&=b\\\\c&=d\\end{align*}"]) {
      expect(text(math)).toBe(math);
    }
  });

  it("removes the gap around display math", () => {
    expect(text("设\n\n\\[x\\]\n\n则")).toBe("设\\[x\\]则");
  });

  it("keeps escaped characters literal and does not treat them as math", () => {
    expect(text("100\\% 与 \\& 与 \\_")).toBe("100% 与 & 与 _");
    expect(text("价格 \\$5 和 \\$6")).toBe("价格 \\$5 和 \\$6");
  });

  it("strips comments but keeps escaped percent signs", () => {
    expect(text("保留 % 注释\n50\\%")).toBe("保留 50%");
  });

  it("produces styled runs that can hold math", () => {
    expect(translateLatexText("看\\textbf{重点 $x$}和\\emph{斜}").runs).toEqual([
      { text: "看" },
      { text: "重点 $x$", style: "bold" },
      { text: "和" },
      { text: "斜", style: "italic" }
    ]);
  });

  it("numbers enumerate items and bullets itemize items", () => {
    expect(text("\\begin{enumerate}\\item 甲\n\\item $x$\\end{enumerate}")).toBe("(1) 甲\n(2) $x$");
    expect(text("\\begin{itemize}[leftmargin=1em]\\item 甲\\end{itemize}")).toBe("• 甲");
    expect(text("\\begin{enumerate}\\item[(a)] 甲\\end{enumerate}")).toBe("(a) 甲");
  });

  it("drops arguments of spacing commands and unwraps text wrappers", () => {
    expect(text("甲\\vspace{1em}乙\\label{x}\\mbox{丙}")).toBe("甲\n乙丙");
  });

  it("reports unknown commands and keeps them visible", () => {
    const result = translateLatexText("甲\\foo{乙}");
    expect(result.unsupported).toEqual(["\\foo"]);
    expect(result.text).toContain("\\foo");
  });

  it("does not throw on half-typed content", () => {
    for (const tex of ["\\textbf{", "$x", "\\begin{enumerate}\\item", "\\", "\\hspace{"]) {
      expect(() => translateLatexText(tex)).not.toThrow();
    }
  });
});

describe("splitUnsupportedEnvironments", () => {
  it("turns tikzpicture into a placeholder and keeps surrounding text", () => {
    expect(splitUnsupportedEnvironments("前\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}后")).toEqual([
      { type: "text", raw: "前" },
      { type: "placeholder", name: "tikzpicture" },
      { type: "text", raw: "后" }
    ]);
  });

  it("keeps math, layout, and unfinished environments as text", () => {
    for (const tex of ["\\begin{cases}a\\end{cases}", "\\begin{center}a\\end{center}", "\\begin{tikzpicture}"]) {
      expect(splitUnsupportedEnvironments(tex)).toEqual([{ type: "text", raw: tex }]);
    }
  });
});
