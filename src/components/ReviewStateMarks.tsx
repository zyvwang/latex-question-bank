import type { CSSProperties } from "react";
import { UNSET_REVIEW_COLOR } from "../../shared/review-options.js";
import type { ReviewOption } from "../../shared/types.js";
import patternStyles from "./ReviewPattern.module.css";
import styles from "./ReviewStateMarks.module.css";

export function ReviewStateMarks({
  mastery,
  errors
}: {
  mastery: ReviewOption | null;
  errors: ReviewOption[];
}) {
  const masteryOption = mastery ?? unsetOption;
  const errorOptions = errors.length ? errors : [unsetOption];
  const masteryName = mastery?.name ?? "未设置";
  const errorNames = errors.length
    ? errors.map((option) => option.name).join("、")
    : "未设置";

  return (
    <span
      className={styles.marks}
      aria-label={`掌握程度：${masteryName}；错误原因：${errorNames}`}
    >
      <span className={styles.group} aria-hidden="true">
        <ReviewMark option={masteryOption} label={`掌握程度：${masteryName}`} />
      </span>
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.group} aria-hidden="true">
        {errorOptions.map((option) => (
          <ReviewMark
            key={option.id}
            option={option}
            label={`错误原因：${option.name}`}
          />
        ))}
      </span>
    </span>
  );
}

function ReviewMark({
  option,
  label
}: {
  option: ReviewOption;
  label: string;
}) {
  return (
    <i
      className={`${styles.mark} ${patternStyles[option.pattern]}`}
      style={{ "--mark-color": option.color } as CSSProperties}
      title={label}
    />
  );
}

const unsetOption: ReviewOption = {
  id: "review-unset",
  name: "未设置",
  order: 0,
  color: UNSET_REVIEW_COLOR,
  pattern: "dots"
};
