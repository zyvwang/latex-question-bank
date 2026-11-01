import { memo } from "react";
import type { KeyboardEvent } from "react";
import { questionSourceDisplay } from "../../shared/question-source.js";
import type { BookRecord } from "../../shared/types.js";
import {
  DISTRIBUTION_STATUSES,
  describeDistributionItem,
  distributionCellId,
  distributionStatus,
  distributionStatusLabel,
  type DistributionGroup,
  type DistributionStatus
} from "../reviewDistribution.js";
import { DistributionBar, StatusSwatch } from "./DistributionSummary.js";
import styles from "./Distribution.module.css";
import patternStyles from "./ReviewPattern.module.css";

type PreviewSource = "focus" | "hover";

const CELL_PATTERN: Record<DistributionStatus, string> = {
  must: "",
  recheck: patternStyles.diagonal,
  skip: patternStyles.dots,
  unset: ""
};

export function DistributionGrid({
  groups,
  books,
  highlight,
  focusedId,
  previewedId,
  onFocusedIdChange,
  onPreviewStart,
  onPreviewEnd,
  onOpenItem,
  onNavigate
}: {
  groups: DistributionGroup[];
  books: BookRecord[];
  highlight: DistributionStatus | null;
  focusedId: string | null;
  previewedId: string | null;
  onFocusedIdChange: (id: string) => void;
  onPreviewStart: (id: string, source: PreviewSource) => void;
  onPreviewEnd: (source: PreviewSource) => void;
  onOpenItem: (id: string) => void;
  onNavigate: (id: string, key: string) => boolean;
}) {
  return (
    // 高亮只改容器属性，由 CSS 让其余格子变淡，避免上千个格子随之重渲染。
    <div className={styles.grid} data-highlight={highlight ?? undefined}>
      {groups.map((group) => (
        <section className={styles.chapterRow} key={group.id} aria-label={group.name}>
          <header className={styles.rowLabel}>
            {group.numeral && <strong>{group.numeral}</strong>}
            <h2>{group.name}</h2>
            <span>共 {group.items.length} 道</span>
          </header>
          <div className={styles.rowBody}>
            <div className={styles.rowStats}>
              <DistributionBar counts={group.counts} compact />
              <ul>
                {DISTRIBUTION_STATUSES.map((status) => (
                  <li key={status}>
                    <StatusSwatch status={status} />
                    {distributionStatusLabel(status)} {group.counts[status]}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.cells}>
              {group.items.map((item) => {
                const status = distributionStatus(item.reviewPriority);
                const source = questionSourceDisplay(item, books);
                return (
                  <DistributionCell
                    key={item.id}
                    itemId={item.id}
                    chapterOrder={item.chapterOrder}
                    status={status}
                    title={source}
                    description={describeDistributionItem({
                      chapterName: group.name,
                      chapterOrder: item.chapterOrder,
                      sourceText: item.source ? source : null,
                      status
                    })}
                    focused={focusedId === item.id}
                    previewed={previewedId === item.id}
                    onFocusedIdChange={onFocusedIdChange}
                    onPreviewStart={onPreviewStart}
                    onPreviewEnd={onPreviewEnd}
                    onOpenItem={onOpenItem}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** props 只收标量和稳定回调：题库每次变更都换引用，传 item 或 group 会让 memo 恒失效。 */
const DistributionCell = memo(function DistributionCell({
  itemId,
  chapterOrder,
  status,
  title,
  description,
  focused,
  previewed,
  onFocusedIdChange,
  onPreviewStart,
  onPreviewEnd,
  onOpenItem,
  onNavigate
}: {
  itemId: string;
  chapterOrder: number;
  status: DistributionStatus;
  title: string;
  description: string;
  focused: boolean;
  previewed: boolean;
  onFocusedIdChange: (id: string) => void;
  onPreviewStart: (id: string, source: PreviewSource) => void;
  onPreviewEnd: (source: PreviewSource) => void;
  onOpenItem: (id: string) => void;
  onNavigate: (id: string, key: string) => boolean;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenItem(itemId);
      return;
    }
    if (onNavigate(itemId, event.key)) event.preventDefault();
  }
  return (
    <button
      type="button"
      id={distributionCellId(itemId)}
      className={styles.cell}
      data-status={status}
      data-previewed={previewed || undefined}
      tabIndex={focused ? 0 : -1}
      aria-label={description}
      title={title}
      onFocus={() => {
        onFocusedIdChange(itemId);
        onPreviewStart(itemId, "focus");
      }}
      onBlur={() => onPreviewEnd("focus")}
      onMouseEnter={() => onPreviewStart(itemId, "hover")}
      onMouseLeave={() => onPreviewEnd("hover")}
      onClick={() => onOpenItem(itemId)}
      onKeyDown={handleKeyDown}
    >
      <span className={`${styles.cellFace} ${CELL_PATTERN[status]}`}>{chapterOrder}</span>
    </button>
  );
});
