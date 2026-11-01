export type TextRunStyle = "bold" | "italic" | "underline" | "code";
export interface TextRun {
  text: string;
  style?: TextRunStyle;
}
export interface TranslatedText {
  text: string;
  /** 只有含强调命令时才存在；公式留在 text 里交给 MathJax。 */
  runs?: TextRun[];
  unsupported: string[];
}
export type TextBlock =
  | { type: "text"; raw: string }
  | { type: "placeholder"; name: string };

const EM = " ";
const MATH_ENVIRONMENTS = new Set([
  "equation", "align", "alignat", "aligned", "gather", "gathered", "multline", "flalign",
  "eqnarray", "split", "cases", "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix",
  "Vmatrix", "smallmatrix", "array", "subequations"
]);
// 这些环境只影响页面版式，去掉定界符后内容照常预览。
const LAYOUT_ENVIRONMENTS = new Set(["center", "flushleft", "flushright", "figure", "table", "quote", "enumerate", "itemize"]);
const DROPPED = new Set([
  "noindent", "indent", "centering", "raggedright", "raggedleft", "newpage", "clearpage",
  "pagebreak", "nopagebreak", "tiny", "scriptsize", "footnotesize", "small", "normalsize",
  "large", "Large", "LARGE", "huge", "Huge", "bfseries", "itshape", "rmfamily", "sffamily",
  "ttfamily", "normalfont", "protect", "relax", "nobreak", "allowbreak"
]);
const LINE_BREAKS = new Set(["newline", "linebreak", "par", "smallskip", "medskip", "bigskip"]);
const SPACES: Record<string, string> = { hfill: EM.repeat(2), hfil: EM.repeat(2), quad: EM, qquad: EM.repeat(2), enspace: " " };
const STYLES: Record<string, TextRunStyle> = { textbf: "bold", textit: "italic", emph: "italic", textsl: "italic", underline: "underline", uline: "underline", texttt: "code" };
const WITH_DROPPED_ARGUMENT = new Set(["label", "vspace", "hspace", "setlength"]);
const UNWRAPPED = new Set(["textrm", "textsf", "textup", "text", "mbox", "caption"]);

function isMathEnvironment(name: string): boolean {
  return MATH_ENVIRONMENTS.has(name.replace(/\*$/, ""));
}

/** 按顶层环境切开文本：不能预览的环境（如 tikzpicture）变成占位，其余留给后续翻译。 */
export function splitUnsupportedEnvironments(tex: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const pattern = /\\begin\{([A-Za-z]+\*?)}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tex))) {
    const name = match[1]!;
    if (isMathEnvironment(name) || LAYOUT_ENVIRONMENTS.has(name)) continue;
    if (isInsideMath(tex, match.index)) continue;
    const close = `\\end{${name}}`;
    const end = tex.indexOf(close, pattern.lastIndex);
    if (end < 0) continue;
    if (match.index > last) blocks.push({ type: "text", raw: tex.slice(last, match.index) });
    blocks.push({ type: "placeholder", name });
    last = end + close.length;
    pattern.lastIndex = last;
  }
  if (last < tex.length) blocks.push({ type: "text", raw: tex.slice(last) });
  return blocks;
}

function isInsideMath(tex: string, index: number): boolean {
  return findMathRanges(tex).some(([start, end]) => index > start && index < end);
}

function findMathRanges(tex: string): Array<[number, number, boolean]> {
  const ranges: Array<[number, number, boolean]> = [];
  let index = 0;
  while (index < tex.length) {
    let close: string | null = null;
    let open = 0;
    let display = false;
    if (tex.startsWith("\\[", index)) { close = "\\]"; open = 2; display = true; }
    else if (tex.startsWith("\\(", index)) { close = "\\)"; open = 2; }
    else if (tex.startsWith("$$", index)) { close = "$$"; open = 2; display = true; }
    else if (tex[index] === "$") { close = "$"; open = 1; }
    else if (tex[index] === "\\") {
      const env = /^\\begin\{([A-Za-z]+\*?)}/.exec(tex.slice(index));
      if (env && isMathEnvironment(env[1]!)) {
        close = `\\end{${env[1]}}`;
        open = env[0].length;
        display = true;
      } else {
        index = skipCommandArgument(tex, index);
        continue;
      }
    }
    if (!close) { index += 1; continue; }
    const end = findClose(tex, close, index + open);
    // 没写完的公式不算公式，留给 MathJax 按原样处理。
    if (end < 0) { index += open; continue; }
    ranges.push([index, end + close.length, display]);
    index = end + close.length;
  }
  return ranges;
}

// 强调命令的参数里可以有公式，那些公式归递归翻译处理，这里不能把命令拦腰切开。
function skipCommandArgument(tex: string, index: number): number {
  const command = /^\\([A-Za-z]+)\s*\{/.exec(tex.slice(index));
  if (!command || !(STYLES[command[1]!] || UNWRAPPED.has(command[1]!))) return index + 2;
  const close = readBraced(tex, index + command[0].length - 1);
  return close > 0 ? close + 1 : index + 2;
}

function findClose(tex: string, close: string, from: number): number {
  let index = from;
  while (index < tex.length) {
    if (tex.startsWith(close, index)) return index;
    index += tex[index] === "\\" ? 2 : 1;
  }
  return -1;
}

function stripComments(tex: string): string {
  return tex.replace(/(^|[^\\])%.*$/gm, "$1");
}

const PARAGRAPH = "\uE000";
const CJK = "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}，。；：！？、（）《》“”]";
const CJK_LINE_JOIN = new RegExp(`(${CJK})[ \\t]*\\n[ \\t]*(?=${CJK})`, "gu");

function collapseLines(text: string): string {
  return text
    .replace(/[ \t]*\n[ \t]*\n\s*/g, PARAGRAPH)
    .replace(CJK_LINE_JOIN, "$1")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replaceAll(PARAGRAPH, "\n");
}

function readBraced(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "\\") { index += 1; continue; }
    if (text[index] === "{") depth += 1;
    if (text[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

interface Output {
  runs: TextRun[];
  unsupported: Set<string>;
  lists: Array<{ ordered: boolean; count: number }>;
}

function push(out: Output, text: string, style?: TextRunStyle) {
  if (!text) return;
  const last = out.runs.at(-1);
  if (last && text.startsWith("\n")) last.text = last.text.replace(/[ \t]+$/, "");
  if (last && last.style === style) last.text += text;
  else out.runs.push(style ? { text, style } : { text });
}

function translateSegment(segment: string, out: Output, style?: TextRunStyle): void {
  let index = 0;
  while (index < segment.length) {
    const char = segment[index]!;
    if (char === "~") { push(out, " ", style); index += 1; continue; }
    if (char === "-" && segment.startsWith("---", index)) { push(out, "—", style); index += 3; continue; }
    if (char === "-" && segment.startsWith("--", index)) { push(out, "–", style); index += 2; continue; }
    if (char !== "\\") { push(out, char, style); index += 1; continue; }

    const next = segment[index + 1] ?? "";
    if (next === "\\") {
      index += 2;
      if (segment[index] === "*") index += 1;
      const length = /^\s*\[[^\]]*]/.exec(segment.slice(index));
      if (length) index += length[0].length;
      push(out, "\n", style);
      continue;
    }
    if (next === ",") { push(out, " ", style); index += 2; continue; }
    if (next === " ") { push(out, " ", style); index += 2; continue; }
    if ("%&#_{}".includes(next) && next) { push(out, next, style); index += 2; continue; }
    if (next === "$") { push(out, "\\$", style); index += 2; continue; }

    const command = /^\\([A-Za-z@]+)(\*?)/.exec(segment.slice(index));
    if (!command) { push(out, char, style); index += 1; continue; }
    const name = command[1]!;
    const after = index + command[0].length;
    const open = after + (/^\s*/.exec(segment.slice(after))?.[0].length ?? 0);
    const hasArgument = segment[open] === "{";
    const close = hasArgument ? readBraced(segment, open) : -1;
    const skipSpace = () => { while (segment[index] === " ") index += 1; };

    if (name === "begin" || name === "end") {
      const env = /^\{([A-Za-z]+\*?)}/.exec(segment.slice(after));
      if (env) {
        index = after + env[0].length;
        if (env[1] === "enumerate" || env[1] === "itemize") {
          if (name === "begin") {
            out.lists.push({ ordered: env[1] === "enumerate", count: 0 });
            const options = /^\s*\[[^\]]*]/.exec(segment.slice(index));
            if (options) index += options[0].length;
          } else {
            out.lists.pop();
            push(out, "\n", style);
          }
        }
        skipSpace();
        continue;
      }
    } else if (name === "item") {
      index = after;
      const label = /^\s*\[([^\]]*)]/.exec(segment.slice(index));
      if (label) index += label[0].length;
      skipSpace();
      const list = out.lists.at(-1);
      const marker = label ? label[1]! : list?.ordered ? `(${(list.count += 1)})` : "•";
      const lead = out.runs.length && !out.runs.at(-1)!.text.endsWith("\n") ? "\n" : "";
      push(out, `${lead}${EM.repeat(Math.max(out.lists.length - 1, 0))}${marker} `, style);
      continue;
    } else if (DROPPED.has(name)) {
      index = after;
      skipSpace();
      continue;
    } else if (LINE_BREAKS.has(name)) {
      index = after;
      skipSpace();
      push(out, "\n", style);
      continue;
    } else if (SPACES[name]) {
      index = after;
      skipSpace();
      push(out, SPACES[name]!, style);
      continue;
    } else if (close > 0 && WITH_DROPPED_ARGUMENT.has(name)) {
      index = close + 1;
      if (name === "hspace") push(out, EM, style);
      if (name === "vspace") push(out, "\n", style);
      skipSpace();
      continue;
    } else if (close > 0 && STYLES[name]) {
      translateMixed(segment.slice(open + 1, close), out, STYLES[name]);
      index = close + 1;
      continue;
    } else if (close > 0 && UNWRAPPED.has(name)) {
      translateMixed(segment.slice(open + 1, close), out, style);
      index = close + 1;
      continue;
    }
    out.unsupported.add(`\\${name}`);
    push(out, command[0], style);
    index = after;
  }
}

function translateMixed(tex: string, out: Output, style?: TextRunStyle): void {
  const ranges = findMathRanges(tex);
  let last = 0;
  for (const [start, end, display] of ranges) {
    let before = tex.slice(last, start);
    if (display) before = before.replace(/\s+$/, "");
    translateSegment(collapseLines(before), out, style);
    push(out, tex.slice(start, end), style);
    last = end;
    if (display) while (/\s/.test(tex[last] ?? "")) last += 1;
  }
  translateSegment(collapseLines(tex.slice(last)), out, style);
}

export function translateLatexText(raw: string): TranslatedText {
  const out: Output = { runs: [], unsupported: new Set(), lists: [] };
  translateMixed(stripComments(raw), out);
  const runs = trimRuns(out.runs);
  const text = runs.map((run) => run.text).join("");
  return {
    text,
    ...(runs.some((run) => run.style) ? { runs } : {}),
    unsupported: [...out.unsupported]
  };
}

function trimRuns(runs: TextRun[]): TextRun[] {
  const next = runs.map((run) => ({ ...run }));
  while (next.length && !(next[0]!.text = next[0]!.text.replace(/^\s+/, ""))) next.shift();
  while (next.length && !(next.at(-1)!.text = next.at(-1)!.text.replace(/\s+$/, ""))) next.pop();
  return next;
}
