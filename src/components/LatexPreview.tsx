import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { QuestionAsset } from "../../shared/types.js";
import {
  disposeMathJaxRoot,
  scheduleMathJaxTypeset
} from "../utils/mathjax.js";
import {
  splitLatexImages,
  type LatexPreviewPart
} from "../utils/preview.js";
import { bindWheelScroller } from "../utils/wheel.js";
import styles from "./LatexPreview.module.css";

export function LatexPreview({
  tex,
  assets,
  compact = false
}: {
  tex: string;
  assets: QuestionAsset[];
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasRenderedRef = useRef(false);
  const parts = useMemo(() => splitLatexImages(tex, assets), [assets, tex]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    return bindWheelScroller(root, () => root);
  }, []);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return undefined;
    const isInitialRender = !hasRenderedRef.current;
    if (isInitialRender) {
      renderPreviewParts(root, parts);
      hasRenderedRef.current = true;
    }
    return scheduleMathJaxTypeset(
      root,
      () => {
        renderPreviewParts(root, parts);
        hasRenderedRef.current = true;
      },
      isInitialRender ? 0 : 120
    );
  }, [parts]);

  useLayoutEffect(() => {
    const root = contentRef.current;
    return () => {
      if (root) disposeMathJaxRoot(root);
    };
  }, []);

  return (
    <div
      className={`${styles.previewPane} ${compact ? styles.compact : ""}`}
      data-latex-preview
      ref={ref}
    >
      <div className={styles.previewContent} ref={contentRef} />
      {/(\\begin\{tikzpicture}|\\begin\{axis})/.test(tex) && (
        <div className={styles.tikzNotice}>
          <AlertTriangle size={14} />
          TikZ/pgfplots 以真实编译为准
        </div>
      )}
    </div>
  );
}

function renderPreviewParts(root: HTMLElement, parts: LatexPreviewPart[]): void {
  const fragment = document.createDocumentFragment();
  if (parts.length === 0) {
    const empty = document.createElement("span");
    empty.className = styles.emptyPreview;
    empty.textContent = "空";
    fragment.appendChild(empty);
  } else {
    parts.forEach((part) => {
      if (part.type === "image") {
        const figure = document.createElement("figure");
        figure.className = styles.previewImage;
        const image = document.createElement("img");
        image.src = part.src;
        image.alt = part.alt;
        figure.appendChild(image);
        fragment.appendChild(figure);
        return;
      }
      const text = document.createElement("div");
      text.className = styles.latexText;
      text.textContent = part.text;
      fragment.appendChild(text);
    });
  }
  root.replaceChildren(fragment);
}
