import {
  BookOpen,
  CheckCircle2,
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
  memo,
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  REVIEW_PRIORITY_LABELS,
  REVIEW_PRIORITY_ORDER,
  REVIEW_STATUS_LABELS
} from "../../shared/review-fields.js";
import { questionSourceDisplay } from "../../shared/question-source.js";
import type { BookRecord, QuestionItem } from "../../shared/types.js";
import type { DropPosition } from "../itemOrder.js";
import {
  useAppView,
  useBankSettings,
  useQuestions,
  useSelection,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import {
  UNCATEGORIZED_FILTER,
  UNSET_BOOK_FILTER,
  UNSET_PRIORITY_FILTER
} from "../questionFilters.js";
import {
  groupTagsByDimension,
  stripTagPrefix,
  TAG_DIMENSIONS,
  tagDimensionOf
} from "../tagDimensions.js";
import metadataStyles from "./MetadataTokens.module.css";
import styles from "./Sidebar.module.css";
import { VirtualQuestionList } from "./VirtualQuestionList.js";
import { useDesktopQuestionList } from "../hooks/useDesktopQuestionList.js";

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
            <TagFilters />
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
                { value: UNSET_PRIORITY_FILTER, label: "未标记" }
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

// 考点/考法/题型各一个下拉，不同下拉之间是「且」；没有前缀的标签仍放在「标签」里。
// 题库里没有用到的维度不显示，没有任何前缀标签时和原来的单个标签下拉完全一样。
function TagFilters() {
  const selection = useSelection();
  const grouped = useMemo(() => groupTagsByDimension(selection.tags), [selection.tags]);
  const dimensions = TAG_DIMENSIONS.filter(
    (dimension) => grouped.byDimension[dimension.key].length > 0
  );
  const showOther = grouped.other.length > 0 || dimensions.length === 0;

  function change(key: string | null, next: string[]) {
    const kept = selection.tagFilters.filter(
      (tag) => (tagDimensionOf(tag)?.key ?? null) !== key
    );
    selection.setTagFilters([...kept, ...next]);
  }

  return (
    <>
      {dimensions.map((dimension) => (
        <MultiSelectFilter
          key={dimension.key}
          icon={<Tags size={15} />}
          label={dimension.label}
          allLabel={`全部${dimension.label}`}
          selected={selection.tagFilters.filter(
            (tag) => tagDimensionOf(tag)?.key === dimension.key
          )}
          onChange={(next) => change(dimension.key, next)}
          options={grouped.byDimension[dimension.key].map((tag) => ({
            value: tag,
            label: stripTagPrefix(tag)
          }))}
        />
      ))}
      {showOther ? (
        <MultiSelectFilter
          icon={<Tags size={15} />}
          label="标签"
          allLabel="全部标签"
          selected={selection.tagFilters.filter((tag) => tagDimensionOf(tag) === null)}
          onChange={(next) => change(null, next)}
          options={grouped.other.map((tag) => ({ value: tag, label: tag }))}
        />
      ) : null}
    </>
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
  const desktop = useDesktopQuestionList();
  const questions = useQuestions();
  const selection = useSelection();
  const ui = useWorkspaceUi();
  const chapterById = useMemo(
    () => new Map(questions.bank?.chapters.map((chapter) => [chapter.id, chapter.name]) ?? []),
    [questions.bank?.chapters]
  );
  const books = useMemo(
    () => questions.bank?.books ?? [],
    [questions.bank?.books]
  );

  const groups = useMemo(() => {
    const result: { chapterId: string | null; items: QuestionItem[] }[] = [];
    for (const item of selection.listItems) {
      const previous = result.at(-1);
      if (previous && previous.chapterId === item.chapterId) {
        previous.items.push(item);
      } else {
        result.push({ chapterId: item.chapterId, items: [item] });
      }
    }
    return result;
  }, [selection.listItems]);

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

const QuestionListRow = memo(function QuestionListRow({
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
  // 行里只列考点和没有前缀的标签；题型缩成角标，考法留到详情区，避免行被标签撑高。
  const grouped = groupTagsByDimension(item.tags);
  const typeTags = grouped.byDimension.type;
  const listedTags = [...grouped.byDimension.topic, ...grouped.other];

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
            {item.reviewPriority ? (
              <span
                className={styles.priorityBadge}
                data-priority={item.reviewPriority}
              >
                {REVIEW_PRIORITY_LABELS[item.reviewPriority]}
              </span>
            ) : null}
            {item.variantOf ? <span className={styles.variantBadge}>变式</span> : null}
            {typeTags.map((tag) => (
              <span className={styles.typeBadge} key={tag} title={tag}>
                {stripTagPrefix(tag)}
              </span>
            ))}
          </span>
          {listedTags.length > 0 ? <span className={metadataStyles.flow}>
            {listedTags.map((tag) => (
              <span
                className={`${metadataStyles.token} ${metadataStyles.tag}`}
                key={tag}
                title={tag}
              >
                {stripTagPrefix(tag)}
              </span>
            ))}
          </span> : null}
        </span>
      </button>
    </div>
  );
});
