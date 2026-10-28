import { findMacros } from "../../shared/latex-macros.js";
import type { QuestionAsset } from "../../shared/types.js";

export type PreviewImageSize = "s" | "m" | "l";

export type LatexPreviewPart =
  | { type: "text"; text: string }
  | { type: "image"; src: string; alt: string; size: PreviewImageSize | null }
  | { type: "choices"; options: string[]; columns: 1 | 2 | 4 };

export function splitLatexImages(
  tex: string,
  assets: QuestionAsset[]
): LatexPreviewPart[] {
  const parts: LatexPreviewPart[] = [];
  const assetByPath = new Map(assets.map((asset) => [asset.relativePath, asset]));
  const pattern = /\\(includegraphics|qimg)(?:\[([^\]]*)])?\{([^}]+)}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tex))) {
    pushTextParts(parts, tex.slice(lastIndex, match.index));
    const imagePath = match[3];
    const asset = assetByPath.get(imagePath);
    parts.push({
      type: "image",
      src: asset ? `/assets/${asset.fileName}` : `/${imagePath}`,
      alt: asset?.originalName ?? imagePath,
      size: match[1] === "qimg" ? parseImageSize(match[2]) : null
    });
    lastIndex = pattern.lastIndex;
  }
  pushTextParts(parts, tex.slice(lastIndex));
  return parts;
}

function parseImageSize(option: string | undefined): PreviewImageSize {
  const value = option?.trim();
  return value === "s" || value === "l" ? value : "m";
}

function pushTextParts(parts: LatexPreviewPart[], raw: string): void {
  const text = raw.replace(/\\begin\{center}|\\end\{center}/g, "");
  let lastIndex = 0;
  for (const choices of findMacros(text, "choices", 4)) {
    pushText(parts, text.slice(lastIndex, choices.start));
    parts.push({
      type: "choices",
      options: choices.args.map((option) => replaceInlineMacros(option.trim())),
      columns: previewChoiceColumns(choices.args)
    });
    lastIndex = choices.end;
  }
  pushText(parts, text.slice(lastIndex));
}

function pushText(parts: LatexPreviewPart[], raw: string): void {
  const text = replaceInlineMacros(raw).trim();
  if (text) parts.push({ type: "text", text });
}

// 预览只做近似：真实列数以 TeX 编译时实测宽度为准。
function previewChoiceColumns(options: string[]): 1 | 2 | 4 {
  const longest = Math.max(...options.map((option) => option.trim().length));
  if (longest <= 14) return 4;
  if (longest <= 32) return 2;
  return 1;
}

function replaceInlineMacros(text: string): string {
  return text
    .replace(/\\paren(?![A-Za-z@])/g, "（\u3000\u3000）")
    .replace(/\\blank(?![A-Za-z@])(?:\[[^\]]*])?/g, "______");
}

let mathJaxPromise: Promise<void> | null = null;

export function ensureMathJax(): Promise<void> {
  if (window.MathJax?.typesetPromise) return Promise.resolve();
  if (mathJaxPromise) return mathJaxPromise;

  window.MathJax = {
    loader: {
      paths: {
        fonts: "/vendor/mathjax-fonts"
      }
    },
    tex: {
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"]
      ],
      displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"]
      ],
      processEscapes: true
    },
    options: {
      skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]
    }
  };

  const loadingPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/mathjax/tex-mml-chtml.js";
    script.async = true;
    script.onload = () => {
      const startupPromise = window.MathJax?.startup?.promise;
      if (startupPromise) {
        startupPromise.then(resolve).catch(reject);
      } else {
        resolve();
      }
    };
    script.onerror = () => reject(new Error("MathJax 加载失败。"));
    document.head.appendChild(script);
  });
  const trackedPromise = loadingPromise.catch((error) => {
    mathJaxPromise = null;
    throw error;
  });
  mathJaxPromise = trackedPromise;

  return trackedPromise;
}
