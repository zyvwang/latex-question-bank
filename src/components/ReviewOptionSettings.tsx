import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import type { ReviewOption, ReviewPattern } from "../../shared/types.js";
import { UNSET_REVIEW_COLOR } from "../../shared/review-options.js";
import { bestTextColor, hasLowSurfaceContrast } from "../color-contrast.js";
import { useReview } from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./SettingsScreen.module.css";

const patternLabels: Record<ReviewPattern, string> = {
  solid: "纯色",
  dots: "圆点",
  diagonal: "斜线",
  crosshatch: "交叉线"
};

export function ReviewOptionSettings({
  kind
}: {
  kind: "mastery" | "errorReason";
}) {
  const review = useReview();
  const options =
    kind === "mastery" ? review.masteryOptions : review.errorReasonOptions;
  const title = kind === "mastery" ? "掌握程度" : "错误原因";
  const [name, setName] = useState("");
  const [color, setColor] = useState(
    kind === "mastery" ? "#2F766F" : "#A9571C"
  );
  const [pattern, setPattern] = useState<ReviewPattern>("solid");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function createOption() {
    if (review.createReviewOption(kind, { name, color, pattern })) {
      setName("");
    }
  }

  return (
    <section className={styles.section} aria-labelledby={`${kind}-settings-title`}>
      <header>
        <div>
          <h2 id={`${kind}-settings-title`}>{title}</h2>
          <p>
            {kind === "mastery"
              ? "题目单选一个掌握程度。"
              : "题目可同时选择多个错误原因。"}
          </p>
        </div>
        <div className={styles.optionCreateRow}>
          <input
            aria-label={`新建${title}名称`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createOption();
            }}
            placeholder="新选项"
          />
          <input
            aria-label={`新建${title}颜色`}
            className={styles.colorInput}
            value={color}
            onChange={(event) => setColor(event.target.value)}
            maxLength={7}
          />
          <select
            aria-label={`新建${title}图案`}
            value={pattern}
            onChange={(event) => setPattern(event.target.value as ReviewPattern)}
          >
            {Object.entries(patternLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            className={controls.secondaryAction}
            onClick={createOption}
            disabled={!name.trim()}
          >
            <Plus size={16} />新建
          </button>
        </div>
      </header>
      <div className={styles.rows}>
        <div className={`${styles.row} ${styles.systemRow}`}>
          <span
            className={styles.swatch}
            style={{
              backgroundColor: UNSET_REVIEW_COLOR,
              color: bestTextColor(UNSET_REVIEW_COLOR)
            }}
          >—</span>
          <strong>未设置</strong>
          <small>系统状态，不可编辑、排序或删除</small>
        </div>
        {options.map((option, index) => (
          <ReviewOptionRow
            key={option.id}
            kind={kind}
            option={option}
            index={index}
            total={options.length}
            draggedId={draggedId}
            setDraggedId={setDraggedId}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewOptionRow({
  kind,
  option,
  index,
  total,
  draggedId,
  setDraggedId
}: {
  kind: "mastery" | "errorReason";
  option: ReviewOption;
  index: number;
  total: number;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
}) {
  const review = useReview();
  const options =
    kind === "mastery" ? review.masteryOptions : review.errorReasonOptions;
  const [name, setName] = useState(option.name);
  const [color, setColor] = useState(option.color);

  useEffect(() => setName(option.name), [option.name]);
  useEffect(() => setColor(option.color), [option.color]);

  function commitName() {
    if (!review.updateReviewOption(kind, option.id, { name })) {
      setName(option.name);
    }
  }

  function commitColor() {
    if (!review.updateReviewOption(kind, option.id, { color })) {
      setColor(option.color);
    }
  }

  return (
    <div
      className={`${styles.row} ${draggedId === option.id ? styles.dragging : ""}`}
      draggable
      onDragStart={() => setDraggedId(option.id)}
      onDragEnd={() => setDraggedId(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => {
        if (!draggedId || draggedId === option.id) return;
        const targetIndex = options.findIndex((candidate) => candidate.id === option.id);
        review.moveReviewOptionToIndex(kind, draggedId, targetIndex);
        setDraggedId(null);
      }}
    >
      <span className={styles.dragHandle} title="拖拽排序"><GripVertical size={16} /></span>
      <span
        className={styles.swatch}
        style={{ backgroundColor: option.color, color: bestTextColor(option.color) }}
      >{index + 1}</span>
      <input
        aria-label={`选项名称 ${option.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setName(option.name);
            event.currentTarget.blur();
          }
        }}
      />
      <div className={styles.colorField}>
        <input
          aria-label={`${option.name}颜色`}
          value={color}
          onChange={(event) => setColor(event.target.value)}
          onBlur={commitColor}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setColor(option.color);
              event.currentTarget.blur();
            }
          }}
          maxLength={7}
        />
        {hasLowSurfaceContrast(option.color) && (
          <small title="与纸面背景的对比度低">低对比度</small>
        )}
      </div>
      <select
        aria-label={`${option.name}图案`}
        value={option.pattern}
        onChange={(event) =>
          review.updateReviewOption(kind, option.id, {
            pattern: event.target.value as ReviewPattern
          })
        }
      >
        {Object.entries(patternLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <div className={styles.rowActions}>
        <button
          className={controls.iconButton}
          onClick={() => review.moveReviewOption(kind, option.id, -1)}
          disabled={index === 0}
          aria-label={`上移选项 ${option.name}`}
        ><ArrowUp size={16} /></button>
        <button
          className={controls.iconButton}
          onClick={() => review.moveReviewOption(kind, option.id, 1)}
          disabled={index === total - 1}
          aria-label={`下移选项 ${option.name}`}
        ><ArrowDown size={16} /></button>
        <button
          className={`${controls.iconButton} ${controls.danger}`}
          onClick={() => review.deleteReviewOption(kind, option.id)}
          aria-label={`删除选项 ${option.name}`}
        ><Trash2 size={16} /></button>
      </div>
    </div>
  );
}
