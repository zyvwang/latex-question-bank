import {
  DISTRIBUTION_STATUSES,
  distributionStatusLabel,
  percentOf,
  type DistributionCounts,
  type DistributionStatus
} from "../reviewDistribution.js";
import controls from "../styles/controls.module.css";
import styles from "./Distribution.module.css";
import patternStyles from "./ReviewPattern.module.css";

const STATUS_PATTERN: Record<DistributionStatus, string> = {
  must: patternStyles.solid,
  recheck: patternStyles.diagonal,
  skip: patternStyles.dots,
  unset: ""
};

export function StatusSwatch({ status }: { status: DistributionStatus }) {
  return (
    <i className={styles.swatch} data-status={status} aria-hidden="true" />
  );
}

export function DistributionBar({
  counts,
  label,
  compact = false
}: {
  counts: DistributionCounts;
  /** 省略时条形图对读屏隐藏，用于旁边已有同样数字的章节行。 */
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? styles.miniBar : styles.bar}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {DISTRIBUTION_STATUSES.filter((status) => counts[status] > 0).map((status) => (
        <span
          key={status}
          className={`${styles.barSegment} ${STATUS_PATTERN[status]}`}
          data-status={status}
          style={{ flexGrow: counts[status] }}
        />
      ))}
    </div>
  );
}

export function DistributionSummary({
  counts,
  total,
  highlight,
  onHighlightChange,
  onShowInEditor
}: {
  counts: DistributionCounts;
  total: number;
  highlight: DistributionStatus | null;
  onHighlightChange: (status: DistributionStatus | null) => void;
  onShowInEditor: (status: DistributionStatus) => void;
}) {
  const marked = total - counts.unset;
  const barLabel = DISTRIBUTION_STATUSES.map(
    (status) =>
      `${distributionStatusLabel(status)} ${counts[status]} 道，占 ${percentOf(counts[status], total)}%`
  ).join("；");
  return (
    <header className={styles.summary}>
      <div className={styles.titleRow}>
        <h1>复习分布</h1>
        <p>
          共 {total} 道 · 已标记 {marked} 道（{percentOf(marked, total)}%）
        </p>
      </div>
      <div className={styles.statusRow}>
        <div className={styles.statusGroup} role="group" aria-label="按状态突出显示">
          {DISTRIBUTION_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={styles.statusButton}
              aria-pressed={highlight === status}
              onClick={() => onHighlightChange(highlight === status ? null : status)}
            >
              <span className={styles.statusName}>
                <StatusSwatch status={status} />
                {distributionStatusLabel(status)}
              </span>
              <span className={styles.statusValue}>
                <strong>{counts[status]}</strong>
                <small>{percentOf(counts[status], total)}%</small>
              </span>
            </button>
          ))}
        </div>
        {highlight && counts[highlight] > 0 && (
          <button
            type="button"
            className={controls.secondaryAction}
            onClick={() => onShowInEditor(highlight)}
          >
            在编辑页查看 {counts[highlight]} 道
          </button>
        )}
      </div>
      <DistributionBar counts={counts} label={barLabel} />
    </header>
  );
}
