import { useLayoutEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import {
  questionSourceDisplay,
  normalizeSourceLabel
} from "../../shared/question-source.js";
import {
  REVIEW_PRIORITY_LABELS,
  REVIEW_PRIORITY_ORDER,
  REVIEW_STATUS_LABELS
} from "../../shared/review-fields.js";
import type { ReviewPriority } from "../../shared/types.js";
import {
  useAppView,
  useBankSettings,
  useLifecycle,
  useQuestions,
  useSelection
} from "../context/questionBankContexts.js";
import { ChapterCombobox } from "./ChapterCombobox.js";
import { QuestionAssets } from "./QuestionAssets.js";
import { TagEditor } from "./TagEditor.js";
import styles from "./WorkspaceView.module.css";

export function WorkspaceDetails() {
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <section className={styles.metadataPanel} aria-label="题目元数据">
      <div className={styles.metaStrip}>
        <SourceField key={item.id} />
        <label className={styles.chapterField}>
          <span>章节</span>
          <ChapterCombobox />
        </label>
        <TagsField />
      </div>
      <div className={styles.reviewRow}>
        <ReviewPriorityField />
        <ReviewStatusField />
      </div>
      <ContextRow />
    </section>
  );
}

function ContextRow() {
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item || (!item.variantOf && item.assets.length === 0)) return null;
  return (
    <div className={styles.contextRow}>
      <VariantField />
      <QuestionAssets assets={item.assets} itemId={item.id} />
    </div>
  );
}

function VariantField() {
  const questions = useQuestions();
  const selection = useSelection();
  const appView = useAppView();
  const item = questions.activeItem;
  if (!item?.variantOf) return null;
  const original =
    questions.bank?.items.find(
      (candidate) => candidate.id === item.variantOf
    ) ?? null;
  if (!original) {
    return (
      <div className={styles.contextField} aria-label="变式原题">
        <span>变式原题</span>
        <strong className={styles.variantMissing}>原题已删除</strong>
      </div>
    );
  }
  const display = questionSourceDisplay(
    original,
    questions.bank?.books ?? []
  );
  const originalId = original.id;
  const originalIsPending = original.reviewStatus === "pending";

  function openOriginal() {
    questions.setActiveId(originalId);
    const originalVisibleInReview =
      originalIsPending &&
      selection.filteredItems.some(
        (candidate) => candidate.id === originalId
      );
    if (appView.activeView === "review" && !originalVisibleInReview) {
      appView.setActiveView("editor");
    }
  }

  return (
    <div className={styles.contextField} aria-label="变式原题">
      <span>变式原题</span>
      <button
        type="button"
        className={styles.variantLink}
        onClick={openOriginal}
        title={`跳转到 ${display}`}
      >
        <Link2 size={14} />
        {display}
      </button>
    </div>
  );
}

function SourceField() {
  const questions = useQuestions();
  const settings = useBankSettings();
  const lifecycle = useLifecycle();
  const item = questions.activeItem;
  const [bookId, setBookId] = useState(item?.source?.bookId ?? "");
  const [label, setLabel] = useState(item?.source?.label ?? "");
  const bookIdRef = useRef(item?.source?.bookId ?? "");
  const labelRef = useRef(item?.source?.label ?? "");
  const committedRef = useRef({
    bookId: item?.source?.bookId ?? "",
    label: item?.source?.label ?? ""
  });
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    const nextBookId = item?.source?.bookId ?? "";
    const nextLabel = item?.source?.label ?? "";
    setBookId(nextBookId);
    setLabel(nextLabel);
    bookIdRef.current = nextBookId;
    labelRef.current = nextLabel;
    committedRef.current = { bookId: nextBookId, label: nextLabel };
  }, [item?.id, item?.source?.bookId, item?.source?.label]);

  if (!item) return null;
  const currentItem = item;

  function commit(
    nextBookId = bookIdRef.current,
    nextLabel = labelRef.current
  ) {
    const resolvedBookId = nextBookId || null;
    const resolvedLabel = normalizeSourceLabel(nextLabel);
    if (resolvedBookId && !resolvedLabel) {
      lifecycle.setNotice({
        type: "error",
        text: "选择了书目时请填写题号。"
      });
      return;
    }
    const nextSource =
      resolvedBookId || resolvedLabel
        ? { bookId: resolvedBookId, label: resolvedLabel }
        : null;
    if (questions.commitSource(currentItem.id, nextSource)) {
      committedRef.current = {
        bookId: nextBookId,
        label: resolvedLabel
      };
    } else {
      bookIdRef.current = committedRef.current.bookId;
      labelRef.current = committedRef.current.label;
      setBookId(committedRef.current.bookId);
      setLabel(committedRef.current.label);
    }
  }

  function createBook() {
    const title = window.prompt("新建书目名称");
    if (!title?.trim()) return;
    const nextBookId = settings.createBook(title);
    if (!nextBookId) return;
    bookIdRef.current = nextBookId;
    setBookId(nextBookId);
    if (labelRef.current.trim()) commit(nextBookId, labelRef.current);
    else labelInputRef.current?.focus();
  }

  return (
    <div className={styles.sourceField}>
      <span>来源</span>
      <select
        aria-label="来源书目"
        value={bookId}
        onChange={(event) => {
          const nextBookId = event.target.value;
          bookIdRef.current = nextBookId;
          setBookId(nextBookId);
          if (labelRef.current.trim()) commit(nextBookId, labelRef.current);
        }}
      >
        <option value="">未关联书目</option>
        {settings.books.map((book) => (
          <option key={book.id} value={book.id}>
            {book.title}
          </option>
        ))}
      </select>
      <input
        ref={labelInputRef}
        value={label}
        onChange={(event) => {
          labelRef.current = event.target.value;
          setLabel(event.target.value);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="题号"
        aria-label="来源题号"
      />
      <button
        type="button"
        className={styles.createBookButton}
        onClick={createBook}
        title="新建书目"
      >
        新建
      </button>
    </div>
  );
}

function TagsField() {
  const questions = useQuestions();
  const selection = useSelection();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <label className={styles.tagsField}>
      <span>标签</span>
      <TagEditor
        tags={item.tags}
        suggestions={selection.tags}
        onChange={(tags) => questions.updateItem(item.id, { tags })}
      />
    </label>
  );
}

function ReviewPriorityField() {
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item) return null;
  const options: Array<ReviewPriority | null> = [null, ...REVIEW_PRIORITY_ORDER];
  return (
    <div className={styles.reviewField} role="group" aria-label="复习优先级">
      <span>复习优先级</span>
      <div className={styles.priorityOptions}>
        {options.map((value) => (
          <button
            key={value ?? "unset"}
            type="button"
            className={`${styles.priorityOption} ${
              value ? styles[`priority_${value}`] : styles.priority_unset
            }`}
            aria-pressed={item.reviewPriority === value}
            onClick={() =>
              questions.updateItem(item.id, { reviewPriority: value })
            }
          >
            <i aria-hidden="true" />
            {value ? REVIEW_PRIORITY_LABELS[value] : "未标记"}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewStatusField() {
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
