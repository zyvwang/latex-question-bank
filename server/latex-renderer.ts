import type {
  Bank,
  ExportOrderMode,
  LatexSettings,
  QuestionItem
} from "../shared/types.js";
import { defaultSettings } from "./bank-schema.js";

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
  const items = bank.items
    .filter((item) => idSet.has(item.id))
    .sort((a, b) => a.order - b.order);
  return orderItemsForExport(items, options.orderMode ?? "normal", options.randomSeed ?? "");
}

export function orderItemsForExport(
  items: QuestionItem[],
  orderMode: ExportOrderMode,
  randomSeed: string
): QuestionItem[] {
  const orderedItems = [...items].sort((a, b) => a.order - b.order);
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

export function buildFullLatex(items: QuestionItem[], settings = defaultSettings): string {
  const body = items
    .map((item, index) => renderFullItem(item, index + 1, settings))
    .join("\n\n");
  return wrapDocument(body, settings, "full");
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

\\title{${title}}
\\date{}

\\begin{document}
\\maketitle

${body || "\\begin{center}\\small 暂无选中题目\\end{center}"}

\\end{document}
`;
}

function basePreamble(): string {
  return String.raw`\documentclass[UTF8,12pt]{ctexart}
\usepackage[a4paper,margin=2.35cm]{geometry}
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
\setlength{\parindent}{2em}
\setlength{\parskip}{0.35em}
\linespread{1.12}`;
}

function renderQuestionOnlyItem(
  item: QuestionItem,
  number: number,
  settings: LatexSettings
): string {
  const source = item.sourceNumber
    ? `\\hfill {\\small 原编号：${escapeLatexText(item.sourceNumber)}}`
    : "";
  return String.raw`\subsection*{第 ${number} 题 ${source}}
${stripDocumentCommands(item.modules.question.tex)}

\vspace{${settings.spacing.item}}`;
}

function renderFullItem(item: QuestionItem, number: number, settings: LatexSettings): string {
  const source = item.sourceNumber
    ? `\\hfill {\\small 原编号：${escapeLatexText(item.sourceNumber)}}`
    : "";
  return String.raw`\subsection*{第 ${number} 题 ${source}}
\textbf{题目}

${stripDocumentCommands(item.modules.question.tex)}

\vspace{${settings.spacing.module}}
\textbf{解析}

${stripDocumentCommands(item.modules.solution.tex)}

\vspace{${settings.spacing.module}}
\textbf{备注}

${stripDocumentCommands(item.modules.note.tex)}

\vspace{${settings.spacing.item}}`;
}

function stripDocumentCommands(input: string): string {
  return input
    .replace(/\\documentclass(?:\[[^\]]*])?\{[^}]+}/g, "")
    .replace(/\\begin\{document}/g, "")
    .replace(/\\end\{document}/g, "")
    .trim();
}

function escapeLatexText(input: string): string {
  return input
    .replace(/[#$%&_{}]/g, (char) => `\\${char}`)
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}
