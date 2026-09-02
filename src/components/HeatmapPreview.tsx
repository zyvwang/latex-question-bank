import type { KeyboardEvent } from "react";
import { PanelRightClose } from "lucide-react";
import type { Bank, ModuleKind, QuestionItem } from "../../shared/types.js";
import { MODULE_KINDS, moduleLabels } from "../constants.js";
import type { HeatmapGroup } from "../heatmap.js";
import { LatexPreview } from "./LatexPreview.js";
import styles from "./Heatmap.module.css";

export function HeatmapPreview({
  bank,
  item,
  group,
  module,
  onModuleChange,
  onCollapse
}: {
  bank: Bank;
  item: QuestionItem | null;
  group: HeatmapGroup | null;
  module: ModuleKind;
  onModuleChange: (module: ModuleKind) => void;
  onCollapse: () => void;
}) {
  if (!item || !group) {
    return (
      <aside className={styles.preview} id="heatmap-preview" aria-label="题目预览">
        <button
          className={styles.previewCollapseButton}
          type="button"
          onClick={onCollapse}
          aria-label="收起热力图题目预览"
          title="收起题目预览"
        >
          <PanelRightClose size={18} />
        </button>
        <p className={styles.emptyPreview}>当前题库还没有可预览的题目。</p>
      </aside>
    );
  }
  const mastery =
    bank.masteryOptions.find((option) => option.id === item.masteryOptionId)?.name ??
    "未设置";
  const errors = item.errorReasonOptionIds
    .map((id) => bank.errorReasonOptions.find((option) => option.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    kind: ModuleKind
  ) {
    const index = MODULE_KINDS.indexOf(kind);
    const nextIndex =
      event.key === "ArrowRight" ? (index + 1) % MODULE_KINDS.length
        : event.key === "ArrowLeft" ? (index - 1 + MODULE_KINDS.length) % MODULE_KINDS.length
          : event.key === "Home" ? 0
            : event.key === "End" ? MODULE_KINDS.length - 1
              : -1;
    if (nextIndex === -1) return;
    event.preventDefault();
    const next = MODULE_KINDS[nextIndex];
    onModuleChange(next);
    document.getElementById(`heatmap-preview-tab-${next}`)?.focus();
  }

  return (
    <aside className={styles.preview} id="heatmap-preview" aria-label="题目预览">
      <header className={styles.previewHeader}>
        <div>
          <span>{group.numeral ? `${group.numeral}、${group.name}` : group.name}</span>
          <h2>{item.sourceNumber?.trim() || `章内第 ${item.chapterOrder} 题`}</h2>
        </div>
        <button
          className={styles.previewCollapseButton}
          type="button"
          onClick={onCollapse}
          aria-label="收起热力图题目预览"
          title="收起题目预览"
        >
          <PanelRightClose size={18} />
        </button>
        <p>第 {item.chapterOrder} 题 · {mastery} · {errors.length ? errors.join(" / ") : "错误原因未设置"}</p>
      </header>
      <div className={styles.previewTabs} role="tablist" aria-label="预览模块">
        {MODULE_KINDS.map((kind) => (
          <button
            id={`heatmap-preview-tab-${kind}`}
            key={kind}
            role="tab"
            aria-selected={module === kind}
            aria-controls="heatmap-preview-panel"
            tabIndex={module === kind ? 0 : -1}
            className={module === kind ? styles.activePreviewTab : ""}
            onClick={() => onModuleChange(kind)}
            onKeyDown={(event) => handleTabKey(event, kind)}
          >
            {moduleLabels[kind]}
          </button>
        ))}
      </div>
      <div
        className={styles.previewPanel}
        id="heatmap-preview-panel"
        role="tabpanel"
        aria-labelledby={`heatmap-preview-tab-${module}`}
      >
        <LatexPreview
          tex={item.modules[module].tex}
          assets={item.assets}
          compact
        />
      </div>
    </aside>
  );
}
