import { useQuestions } from "../context/questionBankContexts.js";
import styles from "./WorkspaceView.module.css";
import { SourceField } from "./QuestionSourceField.js";
import { ChapterField } from "./QuestionChapterField.js";
import { LabelsField } from "./QuestionLabelsField.js";
import { ReviewPriorityField } from "./QuestionReviewPriorityField.js";
import { ReviewStatusField } from "./QuestionReviewStatusField.js";
import { ContextRow } from "./QuestionContextRow.js";

export function WorkspaceDetails() {
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <section className={styles.metadataPanel} aria-label="题目元数据">
      <div className={styles.metaStrip}>
        <SourceField key={item.id} />
        <ChapterField />
        <LabelsField />
      </div>
      <div className={styles.reviewRow}>
        <ReviewPriorityField />
        <ReviewStatusField />
      </div>
      <ContextRow />
    </section>
  );
}

