import { useLayoutEffect, useRef, useState } from "react";
import {
  useQuestions,
  useReview,
  useSelection
} from "../context/questionBankContexts.js";
import { ChapterCombobox } from "./ChapterCombobox.js";
import { ReviewStateMarks } from "./ReviewStateMarks.js";
import { TagEditor } from "./TagEditor.js";
import styles from "./WorkspaceView.module.css";

export function WorkspaceDetails() {
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <section className={styles.metadataPanel} aria-label="题目元数据">
      <div className={styles.metaStrip}>
        <SourceNumberField key={item.id} />
        <label className={styles.chapterField}>
          <span>章节</span>
          <ChapterCombobox />
        </label>
        <TagsField />
      </div>
      <details className={styles.attributesPanel}>
        <summary>
          <span>题目属性</span>
          <AttributeSummary />
        </summary>
        <ReviewFields />
      </details>
    </section>
  );
}

function AttributeSummary() {
  const questions = useQuestions();
  const review = useReview();
  const item = questions.activeItem;
  if (!item) return null;
  const mastery = item.masteryOptionId
    ? (review.masteryOptions.find((option) => option.id === item.masteryOptionId) ?? null)
    : null;
  const errorIds = new Set(item.errorReasonOptionIds);
  const errors = review.errorReasonOptions.filter((option) => errorIds.has(option.id));
  return (
    <small>
      <ReviewStateMarks mastery={mastery} errors={errors} />
      <span>
        {mastery?.name ?? "掌握未设置"} · {errors.length ? `${errors.length} 个错误原因` : "错误原因未设置"}
      </span>
    </small>
  );
}

function SourceNumberField() {
  const questions = useQuestions();
  const item = questions.activeItem;
  const [draft, setDraft] = useState(item?.sourceNumber ?? "");
  const committedRef = useRef(item?.sourceNumber ?? "");

  useLayoutEffect(() => {
    const nextValue = item?.sourceNumber ?? "";
    setDraft(nextValue);
    committedRef.current = nextValue;
  }, [item?.id, item?.sourceNumber]);

  if (!item) return null;
  const currentItem = item;

  // 输入过程中只维护草稿,不做即时冲突校验:否则合法编号(如同章节已有 1 时输入 12)会
  // 在中途前缀命中冲突而被拒。仅在 blur 或 Enter 时提交,冲突由 commitSourceNumber 处理。
  function commit() {
    if (questions.commitSourceNumber(currentItem.id, draft)) {
      committedRef.current = draft.trim();
    } else {
      setDraft(committedRef.current);
    }
  }

  return (
    <label>
      <span>原编号</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
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

function ReviewFields() {
  const questions = useQuestions();
  const review = useReview();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <div className={styles.reviewFields}>
      <fieldset>
        <legend>掌握程度</legend>
        <label>
          <input
            type="radio"
            name={`mastery-${item.id}`}
            checked={item.masteryOptionId === null}
            onChange={() => questions.updateItem(item.id, { masteryOptionId: null })}
          />
          未设置
        </label>
        {review.masteryOptions.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name={`mastery-${item.id}`}
              checked={item.masteryOptionId === option.id}
              onChange={() =>
                questions.updateItem(item.id, { masteryOptionId: option.id })
              }
            />
            <i style={{ backgroundColor: option.color }} />
            {option.name}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>错误原因</legend>
        <span className={styles.unsetLabel}>
          {item.errorReasonOptionIds.length ? "可多选" : "未设置"}
        </span>
        {review.errorReasonOptions.map((option) => {
          const checked = item.errorReasonOptionIds.includes(option.id);
          return (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  questions.updateItem(item.id, {
                    errorReasonOptionIds: checked
                      ? item.errorReasonOptionIds.filter((id) => id !== option.id)
                      : [...item.errorReasonOptionIds, option.id]
                  })
                }
              />
              <i style={{ backgroundColor: option.color }} />
              {option.name}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
