import {
  BookOpen, CheckCircle2, CheckSquare, FolderOpen, Gauge,
  ListChecks, ListFilter, Search, Shapes, Square, Tags
} from "lucide-react";
import {
  REVIEW_PRIORITY_LABELS, UNSET_PRIORITY_LABEL,
  REVIEW_PRIORITY_ORDER, REVIEW_STATUS_LABELS
} from "../../shared/review-fields.js";
import {
  useAppView, useBankSettings, useQuestions, useSelection
} from "../context/questionBankContexts.js";
import {
  UNCATEGORIZED_FILTER, UNSET_BOOK_FILTER, UNSET_PRIORITY_FILTER
} from "../questionFilters.js";
import { MultiSelectFilter } from "./MultiSelectFilter.js";
import styles from "./Sidebar.module.css";

export function FilterPanel() {
  const questions = useQuestions();
  const settings = useBankSettings();
  const selection = useSelection();
  const appView = useAppView();
  const reviewMode = appView.activeView === "review";
  const allVisibleSelected =
    selection.listItems.length > 0 &&
    selection.listItems.every((item) => selection.selectedIds.has(item.id));
  const showingSelected = selection.listMode === "selected";

  return (
    <section className={styles.filterStack} aria-label="题目筛选">
      {!reviewMode && (
        <div className={styles.listActions}>
          <button
            className={styles.listModeToggle}
            onClick={() =>
              selection.setListMode(showingSelected ? "current" : "selected")
            }
            aria-label={showingSelected ? "返回当前列表" : "切换到已选中列表"}
            aria-pressed={showingSelected}
          >
            {showingSelected ? <ListChecks size={16} /> : <ListFilter size={16} />}
            <span>{showingSelected ? "已选中列表" : "当前列表"}</span>
            <small>
              {showingSelected
                ? selection.selectedIds.size
                : `${selection.filteredItems.length}/${questions.orderedItems.length}`}
            </small>
          </button>
          <button
            className={styles.bulkSelectButton}
            onClick={selection.toggleAllVisible}
            disabled={selection.listItems.length === 0}
            aria-label={
              allVisibleSelected ? "取消选择当前显示题目" : "选择当前显示题目"
            }
            title={allVisibleSelected ? "取消选择当前显示题目" : "选择当前显示题目"}
          >
            {allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
        </div>
      )}
      {showingSelected ? (
        <p className={styles.pausedFilters}>
          筛选已保留，返回当前列表后继续生效。
        </p>
      ) : (
        <>
          <label className={styles.searchBox}>
            <Search size={16} />
            <input
              value={selection.search}
              onChange={(event) => selection.setSearch(event.target.value)}
              placeholder="搜索"
              aria-label="搜索题目"
            />
          </label>
          <div className={styles.filterRow}>
            <MultiSelectFilter
              icon={<FolderOpen size={15} />}
              label="章节"
              allLabel="全部章节"
              selected={selection.chapterFilters}
              onChange={selection.setChapterFilters}
              options={[
                ...selection.chapters.map((chapter) => ({
                  value: chapter.id,
                  label: chapter.name
                })),
                { value: UNCATEGORIZED_FILTER, label: "未分类" }
              ]}
            />
            <LabelFilters />
            <MultiSelectFilter
              icon={<BookOpen size={15} />}
              label="书目"
              allLabel="全部书目"
              selected={selection.bookFilters}
              onChange={selection.setBookFilters}
              options={[
                ...settings.books.map((book) => ({
                  value: book.id,
                  label: book.title
                })),
                { value: UNSET_BOOK_FILTER, label: "未关联书目" }
              ]}
            />
            <MultiSelectFilter
              icon={<Gauge size={15} />}
              label="复习优先级"
              allLabel="全部优先级"
              selected={selection.reviewPriorityFilters}
              onChange={selection.setReviewPriorityFilters}
              options={[
                ...REVIEW_PRIORITY_ORDER.map((priority) => ({
                  value: priority,
                  label: REVIEW_PRIORITY_LABELS[priority]
                })),
                { value: UNSET_PRIORITY_FILTER, label: UNSET_PRIORITY_LABEL }
              ]}
            />
            {!reviewMode && (
              <MultiSelectFilter
                icon={<CheckCircle2 size={15} />}
                label="审阅状态"
                allLabel="全部状态"
                selected={selection.reviewStatusFilters}
                onChange={selection.setReviewStatusFilters}
                options={[
                  { value: "pending", label: REVIEW_STATUS_LABELS.pending },
                  { value: "approved", label: REVIEW_STATUS_LABELS.approved }
                ]}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}

// 考点、题型各一个下拉，两个下拉之间是「且」。
function LabelFilters() {
  const selection = useSelection();

  return (
    <>
      <MultiSelectFilter
        icon={<Tags size={15} />}
        label="考点"
        allLabel="全部考点"
        selected={selection.topicFilters}
        onChange={selection.setTopicFilters}
        options={selection.topics.map((topic) => ({ value: topic, label: topic }))}
      />
      <MultiSelectFilter
        icon={<Shapes size={15} />}
        label="题型"
        allLabel="全部题型"
        selected={selection.typeFilters}
        onChange={selection.setTypeFilters}
        options={selection.questionTypes.map((type) => ({ value: type, label: type }))}
      />
    </>
  );
}

