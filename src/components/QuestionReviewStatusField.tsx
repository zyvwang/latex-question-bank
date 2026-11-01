import { REVIEW_STATUS_LABELS } from "../../shared/review-fields.js";
import { useQuestions } from "../context/questionBankContexts.js";
import styles from "./WorkspaceView.module.css";

export function ReviewStatusField() {
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <div className={styles.reviewField}>
      <span>审阅状态</span>
      {item.reviewStatus === "pending" ? (
        <>
          <strong className={styles.pendingBadge}>
            {REVIEW_STATUS_LABELS.pending}
          </strong>
          <button
            type="button"
            className={styles.approveButton}
            onClick={() =>
              questions.updateItem(item.id, { reviewStatus: "approved" })
            }
          >
            批准
          </button>
        </>
      ) : (
        <span className={styles.approvedStatus}>
          {REVIEW_STATUS_LABELS.approved}
        </span>
      )}
    </div>
  );
}
