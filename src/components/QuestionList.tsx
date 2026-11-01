import type { QuestionItem } from "../../shared/types.js";
import { useQuestionListModel } from "../hooks/useQuestionListModel.js";
import { QuestionListRow } from "./QuestionListRow.js";
import { VirtualQuestionList } from "./VirtualQuestionList.js";
import styles from "./Sidebar.module.css";

export function QuestionList() {
  const { desktop, questions, selection, ui, chapterById, books, groups } = useQuestionListModel();

  if (selection.listItems.length === 0) {
    return (
      <div className={styles.emptyQuestionList} role="status">
        {selection.listMode === "selected"
          ? "没有已选中的题目。"
          : "当前筛选没有匹配题目。"}
      </div>
    );
  }

  const renderRow = (item: QuestionItem) => (
    <QuestionListRow
      key={item.id}
      item={item}
      chapterById={chapterById}
      books={books}
      questionNumber={questions.numberById.get(item.id)}
      active={questions.activeItem?.id === item.id}
      selected={selection.selectedIds.has(item.id)}
      dragging={ui.draggingId === item.id}
      dropPosition={ui.dropTarget?.id === item.id ? ui.dropTarget.position : null}
      onToggleSelected={selection.toggleSelected}
      onActivate={questions.setActiveId}
      onOpenReorderMenu={ui.openReorderMenu}
      onStartMouseDrag={ui.startMouseDrag}
      onStartPointerDrag={ui.startPointerDrag}
    />
  );
  if (desktop) {
    return (
      <VirtualQuestionList
        groups={groups}
        chapterById={chapterById}
        activeId={questions.activeItem?.id ?? null}
        draggingId={ui.draggingId}
        renderRow={renderRow}
      />
    );
  }

  return (
    <div className={styles.questionList} aria-label="题目列表" data-question-count={selection.listItems.length}>
      {groups.map((group) => (
        <section
          className={styles.chapterGroup}
          key={group.chapterId ?? "uncategorized"}
          onFocusCapture={(event) => {
            if (!event.target.matches(":focus-visible")) return;
            const section = event.currentTarget;
            const list = section.parentElement;
            const heading = section.querySelector("h3");
            const row = event.target.closest("[data-question-id]");
            if (!list || !heading || !row) return;
            // Wrapped headings have variable height; reserve their actual height for keyboard focus.
            const offset = row.getBoundingClientRect().top -
              list.getBoundingClientRect().top - heading.getBoundingClientRect().height - 4;
            if (offset < 0) list.scrollTop += offset;
          }}
        >
          <h3 className={styles.chapterHeading}>
            {group.chapterId ? (chapterById.get(group.chapterId) ?? "未分类") : "未分类"}
          </h3>
          {group.items.map(renderRow)}
        </section>
      ))}
    </div>
  );
}

