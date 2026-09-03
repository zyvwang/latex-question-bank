import type { QuestionAsset } from "../../shared/types.js";

export type LatexPreviewPart =
  | { type: "text"; text: string }
  | { type: "image"; src: string; alt: string };

export function splitLatexImages(
  tex: string,
  assets: QuestionAsset[]
): LatexPreviewPart[] {
  const parts: LatexPreviewPart[] = [];
  const assetByPath = new Map(assets.map((asset) => [asset.relativePath, asset]));
  const pattern = /\\includegraphics(?:\[[^\]]*])?\{([^}]+)}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tex))) {
    const before = tex.slice(lastIndex, match.index).replace(/\\begin\{center}|\\end\{center}/g, "").trim();
    if (before) parts.push({ type: "text", text: before });
    const imagePath = match[1];
    const asset = assetByPath.get(imagePath);
    parts.push({
      type: "image",
      src: asset ? `/assets/${asset.fileName}` : `/${imagePath}`,
      alt: asset?.originalName ?? imagePath
    });
    lastIndex = pattern.lastIndex;
  }
  const rest = tex.slice(lastIndex).replace(/\\begin\{center}|\\end\{center}/g, "").trim();
  if (rest) parts.push({ type: "text", text: rest });
  return parts;
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
