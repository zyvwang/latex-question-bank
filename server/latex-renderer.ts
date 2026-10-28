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
import { findMacros } from "../shared/latex-macros.js";
import { defaultSettings } from "./bank-schema.js";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

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
  settings = defaultSettings
): string {
  const body = items
    .map((item, index) => renderQuestionOnlyItem(item, index + 1, settings))
    .join("\n\n");
  return wrapDocument(body, settings, "questions");
}

export function buildFullLatex(
  items: QuestionItem[],
  settings = defaultSettings
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
}
${questionMacros()}`;
}

// 保留宏名：\choices、\paren、\blank、\qimg。选项列数由 TeX 实测宽度决定，不在 JS 里估算。
// \paren 用 fill 级的 \hfill，压过 \parfillskip 的 fil 级，段末括号才能贴右。
function questionMacros(): string {
  return String.raw`\newlength{\lqbchoicewidth}
\newlength{\lqbchoicemax}
\newcommand{\lqbmeasurechoice}[1]{%
  \settowidth{\lqbchoicewidth}{#1}%
  \ifdim\lqbchoicewidth>\lqbchoicemax\setlength{\lqbchoicemax}{\lqbchoicewidth}\fi}
\newcommand{\lqbchoicebox}[2]{\parbox[t]{#1\linewidth}{#2}}
\newcommand{\choices}[4]{%
  \par\setlength{\lqbchoicemax}{0pt}%
  \lqbmeasurechoice{A.~#1}\lqbmeasurechoice{B.~#2}%
  \lqbmeasurechoice{C.~#3}\lqbmeasurechoice{D.~#4}%
  \noindent
  \ifdim\lqbchoicemax<0.225\linewidth
    \lqbchoicebox{0.235}{A.~#1}\hfill\lqbchoicebox{0.235}{B.~#2}\hfill
    \lqbchoicebox{0.235}{C.~#3}\hfill\lqbchoicebox{0.235}{D.~#4}%
  \else\ifdim\lqbchoicemax<0.475\linewidth
    \lqbchoicebox{0.485}{A.~#1}\hfill\lqbchoicebox{0.485}{B.~#2}%
    \par\vspace{0.15em}\noindent
    \lqbchoicebox{0.485}{C.~#3}\hfill\lqbchoicebox{0.485}{D.~#4}%
  \else
    A.~#1\par\noindent B.~#2\par\noindent C.~#3\par\noindent D.~#4%
  \fi\fi
  \par}
\newcommand{\paren}{\unskip\nobreak\hfill（\makebox[3em]{}）}
\newcommand{\blank}[1][4em]{\underline{\hspace{#1}}}
\newcommand{\lqbimgwidths}{0.3}
\newcommand{\lqbimgwidthm}{0.45}
\newcommand{\lqbimgwidthl}{0.7}
\newcommand{\qimg}[2][m]{%
  \par\begin{center}%
  \includegraphics[width=\csname lqbimgwidth#1\endcsname\linewidth,height=0.28\textheight,keepaspectratio]{#2}%
  \end{center}}`;
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
  const questionTex = formatQuestionTex(item);
  return String.raw`\noindent\textbf{${number}.}\hspace{0.4em}${questionTex}
\par\vspace{${spacing.item}}`;
}

function renderFullItem(
  item: QuestionItem,
  number: number,
  settings: LatexSettings
): string {
  const spacing = resolveSpacing(settings.spacing);
  const questionTex = formatQuestionTex(item);
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

function formatQuestionTex(item: QuestionItem): string {
  const tex = formatCompactChoices(stripDocumentCommands(item.modules.question.tex));
  return isChoiceQuestion(item) ? ensureChoiceParen(tex) : tex;
}

function isChoiceQuestion(item: QuestionItem): boolean {
  return item.questionTypes.some((type) => type.includes("选择"));
}

// 手写答题括号里常见的是空白或 $\quad$、\qquad、\hspace{…}、~ 这类占位。
const BRACKET_FILLER = String.raw`(?:\s|\u3000|\$|~|\\q?quad(?![A-Za-z])|\\hspace\*?\{[^{}]*\}|\\[ ,;:!])*`;
const EXISTING_PAREN_PATTERN = new RegExp(
  String.raw`\\paren(?![A-Za-z@])|[（(]${BRACKET_FILLER}[）)]`
);

// 只在识别出 \choices 选项块时补括号：表格、enumerate、单行等手写选项无法可靠定位题干末尾，
// 盲目追加到题末会把括号放到选项后面。
export function ensureChoiceParen(tex: string): string {
  if (EXISTING_PAREN_PATTERN.test(tex)) return tex;
  const firstChoices = findMacros(tex, "choices", 4)[0];
  if (!firstChoices) return tex;
  const stem = tex.slice(0, firstChoices.start).trimEnd();
  return `${stem}\\paren\n${tex.slice(firstChoices.start)}`;
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
  return body;
}

function renderChoiceBlock(options: string[]): string {
  return `\\choices${options.map((option) => `{${option}}`).join("")}`;
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
