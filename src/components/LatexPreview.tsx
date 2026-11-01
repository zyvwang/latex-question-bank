import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
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
    </div>
  );
}

const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

const imageSizeClass = {
  s: styles.imageSmall,
  m: styles.imageMedium,
  l: styles.imageLarge
} as const;

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
        figure.className = part.size
          ? `${styles.previewImage} ${imageSizeClass[part.size]}`
          : styles.previewImage;
        const image = document.createElement("img");
        image.src = part.src;
        image.alt = part.alt;
        figure.appendChild(image);
        fragment.appendChild(figure);
        return;
      }
      if (part.type === "choices") {
        const grid = document.createElement("div");
        grid.className = styles.choices;
        grid.dataset.columns = String(part.columns);
        part.options.forEach((option, index) => {
          const cell = document.createElement("div");
          cell.className = styles.latexText;
          cell.textContent = `${CHOICE_LETTERS[index]}. ${option}`;
          grid.appendChild(cell);
        });
        fragment.appendChild(grid);
        return;
      }
      if (part.type === "notice") {
        const notice = document.createElement("p");
        notice.className = styles.previewNotice;
        notice.textContent = part.text;
        fragment.appendChild(notice);
        return;
      }
      const text = document.createElement("div");
      text.className = styles.latexText;
      if (part.runs) {
        part.runs.forEach((run) => {
          const span = document.createElement("span");
          if (run.style) span.dataset.textStyle = run.style;
          span.textContent = run.text;
          text.appendChild(span);
        });
      } else {
        text.textContent = part.text;
      }
      fragment.appendChild(text);
    });
  }
  root.replaceChildren(fragment);
}
