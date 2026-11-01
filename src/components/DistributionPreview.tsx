import { questionSourceDisplay } from "../../shared/question-source.js";
import { reviewPriorityLabel } from "../../shared/review-fields.js";
import type { BookRecord, QuestionItem } from "../../shared/types.js";
import {
  distributionStatus,
  type DistributionGroup
} from "../reviewDistribution.js";
import controls from "../styles/controls.module.css";
import { StatusSwatch } from "./DistributionSummary.js";
import { LatexPreview } from "./LatexPreview.js";
import styles from "./Distribution.module.css";

export function DistributionPreview({
  item,
  group,
  books,
  onOpenItem
}: {
  item: QuestionItem | null;
  group: DistributionGroup | null;
  books: BookRecord[];
  onOpenItem: (id: string) => void;
}) {
  if (!item || !group) return null;
  return (
    <aside className={styles.preview} aria-label="题目预览">
      <header className={styles.previewHeader}>
        <span>
          {group.numeral ? `${group.numeral}、${group.name}` : group.name} · 第 {item.chapterOrder} 题
        </span>
        <h2>{questionSourceDisplay(item, books)}</h2>
        <p>
          <StatusSwatch status={distributionStatus(item.reviewPriority)} />
          {reviewPriorityLabel(item.reviewPriority)}
        </p>
      </header>
      <div className={styles.previewBody}>
        <LatexPreview tex={item.modules.question.tex} assets={item.assets} compact />
      </div>
      <footer className={styles.previewFooter}>
        <button
          type="button"
          className={controls.secondaryAction}
          onClick={() => onOpenItem(item.id)}
        >
          在编辑器打开
        </button>
      </footer>
    </aside>
  );
}
