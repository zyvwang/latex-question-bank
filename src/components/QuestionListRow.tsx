import { GripVertical } from "lucide-react";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { REVIEW_PRIORITY_LABELS } from "../../shared/review-fields.js";
import { questionSourceDisplay } from "../../shared/question-source.js";
import type { BookRecord, QuestionItem } from "../../shared/types.js";
import type { DropPosition } from "../itemOrder.js";
import metadataStyles from "./MetadataTokens.module.css";
import styles from "./Sidebar.module.css";

export const QuestionListRow = memo(function QuestionListRow({
  item,
  chapterById,
  books,
  questionNumber,
  active,
  selected,
  dragging,
  dropPosition,
  onToggleSelected,
  onActivate,
  onOpenReorderMenu,
  onStartMouseDrag,
  onStartPointerDrag
}: {
  item: QuestionItem;
  chapterById: Map<string, string>;
  books: BookRecord[];
  questionNumber: number | undefined;
  active: boolean;
  selected: boolean;
  dragging: boolean;
  dropPosition: DropPosition | null;
  onToggleSelected: (id: string) => void;
  onActivate: (id: string) => void;
  onOpenReorderMenu: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
  onStartMouseDrag: (event: ReactMouseEvent<HTMLSpanElement>, id: string) => void;
  onStartPointerDrag: (event: ReactPointerEvent<HTMLSpanElement>, id: string) => void;
}) {
  const chapterName = item.chapterId
    ? (chapterById.get(item.chapterId) ?? "未分类")
    : "未分类";
  const sourceLabel = questionSourceDisplay(item, books);
  // 行里列出考点；题型缩成角标，避免行被撑高。

  return (
    <div
      className={[
        styles.questionListItem,
        active ? styles.activeQuestion : "",
        dragging ? styles.dragging : "",
        dropPosition === "before" ? styles.dropBefore : "",
        dropPosition === "after" ? styles.dropAfter : ""
      ].filter(Boolean).join(" ")}
      data-question-id={item.id}
      onContextMenu={(event) => onOpenReorderMenu(event, item.id)}
    >
      <label className={styles.checkHit}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(item.id)}
          aria-label={`选择导出 ${sourceLabel || chapterName || "未命名题目"}`}
        />
      </label>
      <span
        className={styles.dragHandle}
        title="拖拽排序"
        onMouseDown={(event) => onStartMouseDrag(event, item.id)}
        onPointerDown={(event) => onStartPointerDrag(event, item.id)}
      >
        <GripVertical size={16} />
      </span>
      <button
        id={`question-nav-${item.id}`}
        className={styles.questionMain}
        onClick={() => onActivate(item.id)}
      >
        <span className={styles.questionIndex}>{questionNumber}</span>
        <span className={styles.questionMeta}>
          <strong>{sourceLabel || chapterName || "未命名题目"}</strong>
          <span className={styles.questionBadges}>
            {item.reviewStatus === "pending" ? (
              <span className={styles.pendingBadge}>待审阅</span>
            ) : null}
            {item.variantOf ? <span className={styles.variantBadge}>变式</span> : null}
            {item.questionTypes.map((type) => (
              <span className={styles.typeBadge} key={type} title={type}>
                {type}
              </span>
            ))}
          </span>
          {item.topics.length > 0 ? <span className={metadataStyles.flow}>
            {item.topics.map((topic) => (
              <span
                className={`${metadataStyles.token} ${metadataStyles.tag}`}
                key={topic}
                title={topic}
              >
                {topic}
              </span>
            ))}
          </span> : null}
        </span>
        {item.reviewPriority ? (
          <span
            className={styles.priorityDot}
            data-priority={item.reviewPriority}
            title={REVIEW_PRIORITY_LABELS[item.reviewPriority]}
          >
            <span className={styles.srOnly}>{REVIEW_PRIORITY_LABELS[item.reviewPriority]}</span>
          </span>
        ) : null}
      </button>
    </div>
  );
});
