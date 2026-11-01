import { REVIEW_PRIORITY_ORDER, reviewPriorityLabel } from "../../shared/review-fields.js";
import type { ReviewPriority } from "../../shared/types.js";
import { useQuestions } from "../context/questionBankContexts.js";
import styles from "./WorkspaceView.module.css";

export function ReviewPriorityField() {
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item) return null;
  const options: Array<ReviewPriority | null> = [...REVIEW_PRIORITY_ORDER, null];
  return (
    <div className={styles.reviewField} role="group" aria-label="复习优先级">
      <span>复习优先级</span>
      <div className={styles.priorityOptions}>
        {options.map((value) => (
          <button
            key={value ?? "unset"}
            type="button"
            className={`${styles.priorityOption} ${
              value ? styles[`priority_${value}`] : styles.priority_unset
            }`}
            aria-pressed={item.reviewPriority === value}
            onClick={() =>
              questions.updateItem(item.id, { reviewPriority: value })
            }
          >
            <i aria-hidden="true" />
            {reviewPriorityLabel(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

