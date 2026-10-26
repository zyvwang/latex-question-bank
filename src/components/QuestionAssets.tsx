import { useEffect, useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";
import type { QuestionAsset } from "../../shared/types.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import styles from "./QuestionAssets.module.css";

export function QuestionAssets({
  assets,
  itemId
}: {
  assets: QuestionAsset[];
  itemId: string;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    setPreviewId(null);
  }, [itemId]);

  if (assets.length === 0) return null;
  const preview = assets.find((asset) => asset.id === previewId) ?? null;

  return (
    <div className={styles.assetsField} aria-label="题目附件">
      <span className={styles.label}>
        <ImageIcon size={14} />
        附件
      </span>
      <div className={styles.thumbnails}>
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className={styles.thumbnailButton}
            onClick={() => setPreviewId(asset.id)}
            title={asset.originalName}
            aria-label={`查看附件 ${asset.originalName}`}
          >
            <img
              src={`/assets/${asset.fileName}`}
              alt=""
              loading="lazy"
            />
          </button>
        ))}
      </div>
      {preview && (
        <AssetPreview asset={preview} onClose={() => setPreviewId(null)} />
      )}
    </div>
  );
}

function AssetPreview({
  asset,
  onClose
}: {
  asset: QuestionAsset;
  onClose: () => void;
}) {
  const dialogRef = useFocusTrap<HTMLElement>();

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-preview-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header>
          <div>
            <h2 id="asset-preview-title">{asset.originalName}</h2>
            <span>
              {asset.mimeType} · {formatBytes(asset.size)} ·{" "}
              {asset.sha256 ? "SHA-256 已记录" : "无内容哈希"}
            </span>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="关闭附件预览"
            data-autofocus
          >
            <X size={18} />
          </button>
        </header>
        <div className={styles.imageFrame}>
          <img
            src={`/assets/${asset.fileName}`}
            alt={asset.originalName}
          />
        </div>
      </section>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
