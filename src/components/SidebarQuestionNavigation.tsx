import {
  AlertCircle,
  CheckSquare,
  FolderOpen,
  Gauge,
  GripVertical,
  ListChecks,
  ListFilter,
  Search,
  Square,
  Tags
} from "lucide-react";
import {
  useQuestions,
  useReview,
  useSelection,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import {
  UNCATEGORIZED_FILTER,
  UNSET_REVIEW_FILTER
} from "../questionFilters.js";
import { UNSET_REVIEW_COLOR } from "../../shared/review-options.js";
import metadataStyles from "./MetadataTokens.module.css";
import { ReviewStateMarks } from "./ReviewStateMarks.js";
import styles from "./Sidebar.module.css";

interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

export function SidebarQuestionNavigation() {
  return (
    <>
      <FilterPanel />
      <QuestionList />
    </>
  );
}

function FilterPanel() {
  const questions = useQuestions();
  const review = useReview();
  const selection = useSelection();
  const allVisibleSelected =
    selection.listItems.length > 0 &&
    selection.listItems.every((item) => selection.selectedIds.has(item.id));
  const showingSelected = selection.listMode === "selected";

  return (
    <section className={styles.filterStack} aria-label="题目筛选">
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
            <MultiSelectFilter
              icon={<Tags size={15} />}
              label="标签"
              allLabel="全部标签"
              selected={selection.tagFilters}
              onChange={selection.setTagFilters}
              options={selection.tags.map((tag) => ({ value: tag, label: tag }))}
            />
            <MultiSelectFilter
              icon={<Gauge size={15} />}
              label="掌握程度"
              allLabel="全部掌握"
              selected={selection.masteryFilters}
              onChange={selection.setMasteryFilters}
              options={[
                { value: UNSET_REVIEW_FILTER, label: "未设置", color: UNSET_REVIEW_COLOR },
                ...review.masteryOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                  color: option.color
                }))
              ]}
            />
            <MultiSelectFilter
              icon={<AlertCircle size={15} />}
              label="错误原因"
              allLabel="全部错因"
              selected={selection.errorReasonFilters}
              onChange={selection.setErrorReasonFilters}
              options={[
                { value: UNSET_REVIEW_FILTER, label: "未设置", color: UNSET_REVIEW_COLOR },
                ...review.errorReasonOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                  color: option.color
                }))
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
}

function MultiSelectFilter({
  icon,
  label,
  allLabel,
  selected,
  onChange,
  options
}: {
  icon: React.ReactNode;
  label: string;
  allLabel: string;
  selected: string[];
  onChange: (value: string[]) => void;
  options: FilterOption[];
}) {
  return (
    <details className={styles.filterMenu}>
      <summary aria-label={`${label}筛选，已选 ${selected.length} 项`}>
        {icon}
        <span>{selected.length ? `${label} ${selected.length}` : allLabel}</span>
      </summary>
      <div className={styles.filterOptions}>
        <div className={styles.filterOptionsHeader}>
          <strong>{label}</strong>
          <button
            onClick={() => onChange([])}
            disabled={selected.length === 0}
          >
            清除
          </button>
        </div>
        {options.length ? (
          options.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() =>
                  onChange(
                    selected.includes(option.value)
                      ? selected.filter((value) => value !== option.value)
                      : [...selected, option.value]
                  )
                }
              />
              {option.color ? (
                <i style={{ backgroundColor: option.color }} aria-hidden="true" />
              ) : null}
              <span>{option.label}</span>
            </label>
          ))
        ) : (
          <p>暂无可用选项</p>
        )}
      </div>
    </details>
  );
}

function QuestionList() {
  const questions = useQuestions();
  const selection = useSelection();
  const ui = useWorkspaceUi();

  if (selection.listItems.length === 0) {
    return (
      <div className={styles.emptyQuestionList} role="status">
        {selection.listMode === "selected"
          ? "没有已选中的题目。"
          : "当前筛选没有匹配题目。"}
      </div>
    );
  }

  return (
    <div className={styles.questionList} aria-label="题目列表">
      {selection.listItems.map((item) => {
        const chapterName = item.chapterId
          ? (questions.bank?.chapters.find((chapter) => chapter.id === item.chapterId)?.name
            ?? "未分类")
          : "未分类";
        const mastery = item.masteryOptionId
          ? (questions.bank?.masteryOptions.find(
            (option) => option.id === item.masteryOptionId
          ) ?? null)
          : null;
        const selectedErrorIds = new Set(item.errorReasonOptionIds);
        const errors = questions.bank?.errorReasonOptions.filter((option) =>
          selectedErrorIds.has(option.id)
        ) ?? [];
        return (
          <div
            key={item.id}
            className={[
              styles.questionListItem,
              questions.activeItem?.id === item.id ? styles.activeQuestion : "",
              ui.draggingId === item.id ? styles.dragging : "",
              ui.dropTarget?.id === item.id
                ? ui.dropTarget.position === "before" ? styles.dropBefore : styles.dropAfter
                : ""
            ].filter(Boolean).join(" ")}
            data-question-id={item.id}
            onContextMenu={(event) => ui.openReorderMenu(event, item.id)}
          >
            <label className={styles.checkHit}>
              <input
                type="checkbox"
                checked={selection.selectedIds.has(item.id)}
                onChange={() => selection.toggleSelected(item.id)}
                aria-label={`选择导出 ${item.sourceNumber || chapterName || "未命名题目"}`}
              />
            </label>
            <span
              className={styles.dragHandle}
              title="拖拽排序"
              onMouseDown={(event) => ui.startMouseDrag(event, item.id)}
              onPointerDown={(event) => ui.startPointerDrag(event, item.id)}
            >
              <GripVertical size={16} />
            </span>
            <button
              id={`question-nav-${item.id}`}
              className={styles.questionMain}
              onClick={() => questions.setActiveId(item.id)}
            >
              <span className={styles.questionIndex}>{questions.numberById.get(item.id)}</span>
              <span className={styles.questionMeta}>
                <strong>{item.sourceNumber || chapterName || "未命名题目"}</strong>
                <ReviewStateMarks mastery={mastery} errors={errors} />
                <span className={metadataStyles.flow}>
                  <span
                    className={`${metadataStyles.token} ${metadataStyles.chapter}`}
                  >
                    {chapterName}
                  </span>
                  {item.tags.map((tag) => (
                    <span
                      className={`${metadataStyles.token} ${metadataStyles.tag}`}
                      key={tag}
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
