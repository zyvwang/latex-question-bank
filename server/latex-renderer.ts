import type {
  Bank,
  BookRecord,
  Chapter,
  ExportOrderMode,
  LatexSettings,
  QuestionItem
} from "../shared/types.js";
import { orderItemsByChapter } from "../shared/chapter-order.js";
import { questionSourceDisplay } from "../shared/question-source.js";
import { defaultSettings } from "./bank-schema.js";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;
const FOUR_COLUMN_MAX_EM = 10.5;
const TWO_COLUMN_MAX_EM = 21.5;

export function sanitizeFileName(input: string): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .trim()
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || `export-${new Date().toISOString().slice(0, 10)}`;
}

export function selectedItems(
  bank: Bank,
  ids: string[],
  options: { orderMode?: ExportOrderMode; randomSeed?: string } = {}
): QuestionItem[] {
  const idSet = new Set(ids);
  const items = bank.items.filter((item) => idSet.has(item.id));
  return orderItemsForExport(
    items,
    options.orderMode ?? "normal",
    options.randomSeed ?? "",
    bank.chapters
  );
}

export function orderItemsForExport(
  items: QuestionItem[],
  orderMode: ExportOrderMode,
  randomSeed: string,
  chapters: Chapter[] = []
): QuestionItem[] {
  const orderedItems = orderItemsByChapter(items, chapters);
  if (orderMode !== "random") return orderedItems;
  return shuffleWithSeed(orderedItems, randomSeed);
}

export function buildQuestionOnlyLatex(
  items: QuestionItem[],
  settings = defaultSettings,
  _books: BookRecord[] = []
): string {
  const body = items
    .map((item, index) => renderQuestionOnlyItem(item, index + 1, settings))
    .join("\n\n");
  return wrapDocument(body, settings, "questions");
}

export function buildFullLatex(
  items: QuestionItem[],
  settings = defaultSettings,
  _books: BookRecord[] = []
): string {
  const body = items
    .map((item, index) => renderFullItem(item, index + 1, settings))
    .join("\n\n");
  return wrapDocument(body, settings, "full");
}

export function buildSourcesMarkdown(
  items: QuestionItem[],
  books: BookRecord[] = []
): string {
  const rows = items.map((item, index) => {
    const source = item.source
      ? escapeMarkdownTableCell(questionSourceDisplay(item, books))
      : "—";
    return `| ${index + 1} | ${source || "—"} |`;
  });
  return [
    "# 题号与来源对照表",
    "",
    "| 题号 | 来源 |",
    "| --- | --- |",
    ...rows,
    ""
  ].join("\n");
}

function shuffleWithSeed<T>(items: T[], seed: string): T[] {
  const shuffled = [...items];
  const random = mulberry32(fnv1a32(seed));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapDocument(
  body: string,
  settings: LatexSettings,
  kind: "questions" | "full"
): string {
  const preamble = [basePreamble(), settings.preamble.trim()].filter(Boolean).join("\n\n");
  const title = kind === "questions" ? "题目汇总" : "题目解析备注汇总";
  return `${preamble}

\\begin{document}
\\begin{center}
{\\large\\bfseries ${title}}
\\end{center}
\\vspace{0.3em}

${body || "\\begin{center}\\small 暂无选中题目\\end{center}"}

\\end{document}
`;
}

function basePreamble(): string {
  return String.raw`\documentclass[UTF8,zihao=5]{ctexart}
\usepackage[a4paper,margin=1.8cm]{geometry}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{mathtools}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{pgfplots}
\usepackage{extarrows}
\usepackage{listings}
\usepackage{hyperref}
\pgfplotsset{compat=1.18}
\graphicspath{{./assets/}}
\hypersetup{colorlinks=true,linkcolor=black,urlcolor=blue}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.2em}
\linespread{1.08}
\AtBeginDocument{%
  \setlength{\abovedisplayskip}{0.45em plus 0.15em minus 0.15em}%
  \setlength{\belowdisplayskip}{0.45em plus 0.15em minus 0.15em}%
  \setlength{\abovedisplayshortskip}{0.2em plus 0.15em}%
  \setlength{\belowdisplayshortskip}{0.3em plus 0.15em minus 0.15em}%
}`;
}

function resolveSpacing(
  spacing: LatexSettings["spacing"]
): LatexSettings["spacing"] {
  // 旧版默认间距为 1.0em / 0.45em，在无独立 \subsection* 标题时仍偏稀疏；
  // 未被用户改动过的旧默认值直接按新版紧凑默认值渲染。
  if (spacing.item === "1.0em" && spacing.module === "0.45em") {
    return {
      item: defaultSettings.spacing.item,
      module: defaultSettings.spacing.module
    };
  }
  return spacing;
}

function renderQuestionOnlyItem(
  item: QuestionItem,
  number: number,
  settings: LatexSettings
): string {
  const spacing = resolveSpacing(settings.spacing);
  const questionTex = formatQuestionTex(item.modules.question.tex);
  return String.raw`\noindent\textbf{${number}.}\hspace{0.4em}${questionTex}
\par\vspace{${spacing.item}}`;
}

function renderFullItem(
  item: QuestionItem,
  number: number,
  settings: LatexSettings
): string {
  const spacing = resolveSpacing(settings.spacing);
  const questionTex = formatQuestionTex(item.modules.question.tex);
  const solutionTex = stripDocumentCommands(item.modules.solution.tex);
  const noteTex = stripDocumentCommands(item.modules.note.tex);

  const blocks = [
    String.raw`\noindent\textbf{${number}.}\hspace{0.4em}${questionTex}`
  ];
  if (solutionTex) {
    blocks.push(
      String.raw`\par\vspace{${spacing.module}}
\noindent\textbf{【解析】}${solutionTex}`
    );
  }
  if (noteTex) {
    blocks.push(
      String.raw`\par\vspace{${spacing.module}}
\noindent\textbf{【备注】}${noteTex}`
    );
  }
  blocks.push(String.raw`\par\vspace{${spacing.item}}`);
  return blocks.join("\n");
}

function formatQuestionTex(input: string): string {
  return formatCompactChoices(stripDocumentCommands(input));
}

function formatCompactChoices(input: string): string {
  const lines = input.split(/\r?\n/);
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const matched = matchChoiceBlock(lines, index);
    if (!matched) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    output.push(renderChoiceBlock(matched.options));
    index = matched.nextIndex;
  }

  return output.join("\n");
}

function matchChoiceBlock(
  lines: string[],
  startIndex: number
): { options: string[]; nextIndex: number } | null {
  const options: string[] = [];
  let cursor = startIndex;

  for (let letterIndex = 0; letterIndex < OPTION_LETTERS.length; letterIndex += 1) {
    const expectedLetter = OPTION_LETTERS[letterIndex];
    if (letterIndex > 0) {
      while (cursor < lines.length && lines[cursor].trim() === "") {
        cursor += 1;
      }
    }
    if (cursor >= lines.length) return null;
    const parsed = parseOptionLine(lines[cursor], expectedLetter);
    if (!parsed) return null;
    options.push(parsed);
    cursor += 1;
  }

  return { options, nextIndex: cursor };
}

function parseOptionLine(
  line: string,
  expectedLetter: (typeof OPTION_LETTERS)[number]
): string | null {
  if (/\\(?:begin|end)\s*\{/.test(line)) return null;
  const match = /^\s*(?:([A-D])\s*[.．、]|[(（]\s*([A-D])\s*[)）])\s*(.+?)\s*(?:\\\\)?\s*$/.exec(
    line
  );
  if (!match) return null;
  const letter = match[1] ?? match[2];
  const body = match[3]?.trim();
  if (letter !== expectedLetter || !body) return null;
  const prefix = match[1] ? `${expectedLetter}.` : `(${expectedLetter})`;
  return `${prefix} ${body}`;
}

function renderChoiceBlock(options: string[]): string {
  const maxWidth = Math.max(...options.map(estimateLatexVisualEm));
  if (maxWidth <= FOUR_COLUMN_MAX_EM) {
    return `\\par\\noindent${options
      .map((option) => `\\parbox[t]{0.235\\linewidth}{${option}}`)
      .join("\\hfill")}`;
  }
  if (maxWidth <= TWO_COLUMN_MAX_EM) {
    return [
      `\\par\\noindent\\parbox[t]{0.485\\linewidth}{${options[0]}}\\hfill\\parbox[t]{0.485\\linewidth}{${options[1]}}`,
      `\\par\\vspace{0.15em}\\noindent\\parbox[t]{0.485\\linewidth}{${options[2]}}\\hfill\\parbox[t]{0.485\\linewidth}{${options[3]}}`
    ].join("\n");
  }
  return options.map((option) => `\\par\\noindent ${option}`).join("\n");
}

function estimateLatexVisualEm(input: string): number {
  let s = input.replace(
    /\\(?:left|right|big|Big|bigg|Bigg|displaystyle|textstyle|scriptstyle|limits|nolimits|mathrm|mathbf|mathit|mathbb|mathcal|text|textbf|textit|textrm)\b/g,
    ""
  );
  for (let pass = 0; pass < 3; pass += 1) {
    s = s.replace(
      /\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      (_match, num: string, den: string) =>
        num.length >= den.length ? `(${num})` : `(${den})`
    );
    s = s.replace(/\\sqrt\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, "√($1)");
  }
  s = s
    .replace(/\\qquad\b/g, "    ")
    .replace(/\\quad\b/g, "  ")
    .replace(/\\(?:,|;|!|:|\s)/g, " ")
    .replace(/\\(?:int|oint|iint|sum|prod|lim)\b/g, "MM")
    .replace(
      /\\(?:sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|ln|log|exp|max|min|sup|inf|det|dim|rank)\b/g,
      "mmm"
    )
    .replace(
      /\\(?:to|rightarrow|leftarrow|Rightarrow|Leftarrow|iff|Leftrightarrow|mapsto|infty|partial|nabla|forall|exists|in|notin|subset|subseteq|cup|cap|cdot|cdots|ldots|dots|times|div|pm|mp|le|leq|ge|geq|ne|neq|approx|equiv|sim|simeq|propto)\b/g,
      "M"
    )
    .replace(/\\[a-zA-Z]+/g, "M")
    .replace(/[$^{}_\\]/g, "");

  let width = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20) {
      width += 0.3;
    } else if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3000 && code <= 0x303f)
    ) {
      width += 1.0;
    } else {
      width += 0.55;
    }
  }
  return width;
}

function stripDocumentCommands(input: string): string {
  return input
    .replace(/\\documentclass(?:\[[^\]]*])?\{[^}]+}/g, "")
    .replace(/\\begin\{document}/g, "")
    .replace(/\\end\{document}/g, "")
    .trim();
}

function escapeMarkdownTableCell(input: string): string {
  return input
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}
