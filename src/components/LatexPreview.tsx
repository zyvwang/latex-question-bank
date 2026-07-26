import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { QuestionAsset } from "../../shared/types.js";
import { ensureMathJax, splitLatexImages } from "../utils/preview.js";
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
  const parts = useMemo(() => splitLatexImages(tex, assets), [assets, tex]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    return bindWheelScroller(root, () => root);
  }, []);

  useEffect(() => {
    let cancelled = false;
    ensureMathJax()
      .then(() => {
        if (!cancelled && ref.current && window.MathJax?.typesetPromise) {
          return window.MathJax.typesetPromise([ref.current]);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tex]);

  return (
    <div
      className={`${styles.previewPane} ${compact ? styles.compact : ""}`}
      data-latex-preview
      ref={ref}
    >
      {parts.length === 0 ? (
        <span className={styles.emptyPreview}>空</span>
      ) : (
        parts.map((part, index) =>
          part.type === "image" ? (
            <figure className={styles.previewImage} key={`${part.src}-${index}`}>
              <img src={part.src} alt={part.alt} />
            </figure>
          ) : (
            <div className={styles.latexText} key={index}>
              {part.text}
            </div>
          )
        )
      )}
      {/(\\begin\{tikzpicture}|\\begin\{axis})/.test(tex) && (
        <div className={styles.tikzNotice}>
          <AlertTriangle size={14} />
          TikZ/pgfplots 以真实编译为准
        </div>
      )}
    </div>
  );
}
