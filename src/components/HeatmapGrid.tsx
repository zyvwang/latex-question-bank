import { memo, useCallback, useMemo } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { UNSET_REVIEW_COLOR } from "../../shared/review-options.js";
import type { Bank, ReviewOption } from "../../shared/types.js";
import { bestTextColor } from "../color-contrast.js";
import {
  describeHeatmapItem,
  nextHeatmapItemId,
  type HeatmapGroup,
  type HeatmapMode,
  type HeatmapNavigationKey
} from "../heatmap.js";
import styles from "./Heatmap.module.css";
import patternStyles from "./ReviewPattern.module.css";

type PreviewSource = "focus" | "hover";

interface HeatmapGridProps {
  bank: Bank;
  groups: HeatmapGroup[];
  mode: HeatmapMode;
  focusedId: string | null;
  previewedId: string | null;
  onFocusedIdChange: (id: string) => void;
  onPreviewStart: (id: string, source: PreviewSource) => void;
  onPreviewEnd: (source: PreviewSource) => void;
  onOpenItem: (id: string) => void;
}

export function HeatmapGrid({
  bank,
  groups,
  mode,
  focusedId,
  previewedId,
  onFocusedIdChange,
  onPreviewStart,
  onPreviewEnd,
  onOpenItem
}: HeatmapGridProps) {
  const masteryById = useMemo(
    () => new Map(bank.masteryOptions.map((option) => [option.id, option])),
    [bank.masteryOptions]
  );
  const errorById = useMemo(
    () => new Map(bank.errorReasonOptions.map((option) => [option.id, option])),
    [bank.errorReasonOptions]
  );
  const errorsByItemId = useMemo(
    () =>
      new Map(
        bank.items.map((item) => [
          item.id,
          item.errorReasonOptionIds
            .map((id) => errorById.get(id))
            .filter((option): option is ReviewOption => Boolean(option))
        ])
      ),
    [bank.items, errorById]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onOpenItem(id);
        return;
      }
      if (!isNavigationKey(event.key)) return;
      event.preventDefault();
      const nextId = nextHeatmapItemId(groups, id, event.key);
      onFocusedIdChange(nextId);
      document.getElementById(`heatmap-cell-${nextId}`)?.focus();
    },
    [groups, onFocusedIdChange, onOpenItem]
  );

  return (
    <section className={styles.grid} aria-label="题目掌握热力图">
      {groups.map((group) => (
        <section className={styles.chapterRow} id={group.id} key={group.id}>
          <header className={styles.rowLabel}>
            <strong aria-hidden={!group.numeral}>{group.numeral ?? ""}</strong>
            <span>{group.name}</span>
          </header>
          {group.items.length ? (
            <div className={styles.cells}>
              {group.items.map((item) => {
                const mastery = item.masteryOptionId
                  ? (masteryById.get(item.masteryOptionId) ?? null)
                  : null;
                const errors = errorsByItemId.get(item.id) ?? emptyErrors;
                return (
                  <HeatmapCell
                    key={item.id}
                    itemId={item.id}
                    chapterOrder={item.chapterOrder}
                    sourceNumber={item.sourceNumber}
                    description={describeHeatmapItem({
                      chapterName: group.name,
                      chapterOrder: item.chapterOrder,
                      sourceNumber: item.sourceNumber,
                      masteryName: mastery?.name,
                      errorReasonNames: errors.map((option) => option.name)
                    })}
                    mode={mode}
                    focused={focusedId === item.id}
                    previewed={previewedId === item.id}
                    mastery={mastery}
                    errors={errors}
                    onFocusedIdChange={onFocusedIdChange}
                    onPreviewStart={onPreviewStart}
                    onPreviewEnd={onPreviewEnd}
                    onOpenItem={onOpenItem}
                    onKeyDown={handleKeyDown}
                  />
                );
              })}
            </div>
          ) : (
            <p className={styles.emptyChapter}>暂无题目</p>
          )}
        </section>
      ))}
    </section>
  );
}

/**
 * props 里刻意不出现 bank 或 group:两者每次题库变更都换引用,传进来会让 memo 恒失效,
 * 而格子数量是 1000 题量级。这里只收已解析好的标量和选项对象。
 */
const HeatmapCell = memo(function HeatmapCell({
  itemId,
  chapterOrder,
  sourceNumber,
  description,
  mode,
  focused,
  previewed,
  mastery,
  errors,
  onFocusedIdChange,
  onPreviewStart,
  onPreviewEnd,
  onOpenItem,
  onKeyDown
}: {
  itemId: string;
  chapterOrder: number;
  sourceNumber?: string;
  description: string;
  mode: HeatmapMode;
  focused: boolean;
  previewed: boolean;
  mastery: ReviewOption | null;
  errors: ReviewOption[];
  onFocusedIdChange: (id: string) => void;
  onPreviewStart: (id: string, source: PreviewSource) => void;
  onPreviewEnd: (source: PreviewSource) => void;
  onOpenItem: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void;
}) {
  const masteryColor = mastery?.color ?? UNSET_REVIEW_COLOR;
  const masteryPattern = mastery?.pattern ?? "dots";
  const visibleErrors = errors.length ? errors.slice(0, 3) : [unsetOption];
  const textBackground =
    mode === "errorReason" ? visibleErrors[0].color : masteryColor;
  const style = {
    "--cell-color": masteryColor,
    "--cell-text": bestTextColor(textBackground)
  } as CSSProperties;
  return (
    <button
      id={`heatmap-cell-${itemId}`}
      data-heatmap-cell={itemId}
      data-heatmap-mode={mode}
      data-error-count={errors.length}
      className={[
        styles.cell,
        mode !== "errorReason" ? patternStyles[masteryPattern] : "",
        previewed ? styles.previewedCell : ""
      ].filter(Boolean).join(" ")}
      style={style}
      tabIndex={focused ? 0 : -1}
      aria-label={description}
      title={sourceNumber?.trim() || `章内第 ${chapterOrder} 题`}
      onFocus={() => {
        onFocusedIdChange(itemId);
        onPreviewStart(itemId, "focus");
      }}
      onBlur={() => onPreviewEnd("focus")}
      onMouseEnter={() => onPreviewStart(itemId, "hover")}
      onMouseLeave={() => onPreviewEnd("hover")}
      onClick={() => onOpenItem(itemId)}
      onKeyDown={(event) => onKeyDown(event, itemId)}
    >
      {mode === "errorReason" && (
        <span
          className={styles.errorStripes}
          data-error-stripes={visibleErrors.length}
          aria-hidden="true"
        >
          {visibleErrors.map((option) => (
            <i
              key={option.id}
              className={patternStyles[option.pattern]}
              style={{ "--stripe-color": option.color } as CSSProperties}
            />
          ))}
        </span>
      )}
      <strong>{chapterOrder}</strong>
      {mode === "combined" && errors.length > 0 && (
        <span
          className={styles.errorMarks}
          data-error-marks={Math.min(errors.length, 3)}
          aria-hidden="true"
        >
          {errors.slice(0, 3).map((option) => (
            <i
              key={option.id}
              className={patternStyles[option.pattern]}
              style={{ "--stripe-color": option.color } as CSSProperties}
            />
          ))}
        </span>
      )}
      {errors.length > 3 && mode !== "mastery" && (
        <small>+{errors.length - 3}</small>
      )}
    </button>
  );
});

const unsetOption: ReviewOption = {
  id: "unset",
  name: "未设置",
  order: 0,
  color: UNSET_REVIEW_COLOR,
  pattern: "dots"
};
const emptyErrors: ReviewOption[] = [];

function isNavigationKey(key: string): key is HeatmapNavigationKey {
  return [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End"
  ].includes(key);
}
