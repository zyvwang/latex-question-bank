import { useEffect, useMemo, useState } from "react";
import { History, RotateCcw, Trash2 } from "lucide-react";
import type {
  MasteryHistoryEntry,
  MasteryHistoryItemState,
  ReviewOption
} from "../../shared/types.js";
import { useQuestions, useReview } from "../context/questionBankContexts.js";
import { sortMasteryHistoryNewestFirst } from "../review-history.js";
import controls from "../styles/controls.module.css";
import settings from "./SettingsScreen.module.css";
import styles from "./MasteryHistorySettings.module.css";

export function MasteryHistorySettings() {
  const questions = useQuestions();
  const review = useReview();
  const entries = useMemo(
    () => sortMasteryHistoryNewestFirst(review.masteryHistory),
    [review.masteryHistory]
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    entries[0]?.id ?? null
  );
  const selected =
    entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;

  useEffect(() => {
    if (selected?.id !== selectedId) setSelectedId(selected?.id ?? null);
  }, [selected?.id, selectedId]);

  return (
    <section
      className={settings.section}
      aria-labelledby="history-settings-title"
    >
      <header>
        <div>
          <h2 id="history-settings-title">掌握历史</h2>
          <p>
            每个本地日期保留当天最终状态，最多五份。这里的记录不等同于磁盘恢复快照。
          </p>
        </div>
        <strong className={styles.capacity}>
          <History size={16} aria-hidden="true" />
          {entries.length} / 5
        </strong>
      </header>
      {selected ? (
        <div className={styles.historyLayout}>
          <nav className={styles.historyList} aria-label="掌握历史记录">
            {entries.map((entry) => (
              <button
                key={entry.id}
                className={entry.id === selected.id ? styles.selectedEntry : ""}
                aria-pressed={entry.id === selected.id}
                onClick={() => setSelectedId(entry.id)}
              >
                <strong>{entry.name}</strong>
                <span>{entry.localDate}</span>
                <small>{Object.keys(entry.itemStates).length} 道题</small>
              </button>
            ))}
          </nav>
          <HistoryDetail
            entry={selected}
            currentItems={questions.bank?.items ?? []}
          />
        </div>
      ) : (
        <div className={styles.emptyHistory}>
          <History size={20} aria-hidden="true" />
          <div>
            <strong>尚无掌握历史</strong>
            <p>第一次修改题目的掌握程度、错误原因或选项定义时，会创建当天记录。</p>
          </div>
        </div>
      )}
    </section>
  );
}

function HistoryDetail({
  entry,
  currentItems
}: {
  entry: MasteryHistoryEntry;
  currentItems: NonNullable<ReturnType<typeof useQuestions>["bank"]>["items"];
}) {
  const review = useReview();
  const [name, setName] = useState(entry.name);
  useEffect(() => setName(entry.name), [entry.name]);

  function commitName() {
    if (!review.renameHistory(entry.id, name)) setName(entry.name);
  }

  return (
    <article className={styles.historyDetail}>
      <header>
        <div>
          <label htmlFor={`history-name-${entry.id}`}>历史名称</label>
          <input
            id={`history-name-${entry.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setName(entry.name);
                event.currentTarget.blur();
              }
            }}
          />
          <p>
            本地日期 {entry.localDate}，最后更新{" "}
            {formatLocalTimestamp(entry.updatedAt)}
          </p>
        </div>
        <div className={styles.historyActions}>
          <button
            className={controls.secondaryAction}
            onClick={() => review.restoreHistory(entry.id)}
          >
            <RotateCcw size={16} aria-hidden="true" />
            恢复
          </button>
          <button
            className={`${controls.secondaryAction} ${styles.deleteAction}`}
            onClick={() => review.deleteHistory(entry.id)}
          >
            <Trash2 size={16} aria-hidden="true" />
            删除
          </button>
        </div>
      </header>
      <div className={styles.definitionGroups}>
        <HistoryOptionLegend label="掌握程度" options={entry.masteryOptions} />
        <HistoryOptionLegend label="错误原因" options={entry.errorReasonOptions} />
      </div>
      <div className={styles.stateTable} role="table" aria-label="历史题目状态">
        <div className={styles.stateHeader} role="row">
          <span role="columnheader">题目</span>
          <span role="columnheader">掌握程度</span>
          <span role="columnheader">错误原因</span>
        </div>
        {Object.entries(entry.itemStates).map(([itemId, state]) => {
          const item = currentItems.find((candidate) => candidate.id === itemId);
          return (
            <HistoryStateRow
              key={itemId}
              itemLabel={
                item?.sourceNumber?.trim() ||
                (item ? `章内第 ${item.chapterOrder} 题` : `已删除题目 ${itemId}`)
              }
              state={state}
              entry={entry}
            />
          );
        })}
      </div>
    </article>
  );
}

function HistoryOptionLegend({
  label,
  options
}: {
  label: string;
  options: ReviewOption[];
}) {
  return (
    <section aria-label={`${label}定义`}>
      <strong>{label}</strong>
      <div>
        {options.map((option) => (
          <span key={option.id}>
            <i style={{ backgroundColor: option.color }} aria-hidden="true" />
            {option.name}
          </span>
        ))}
      </div>
    </section>
  );
}

function HistoryStateRow({
  itemLabel,
  state,
  entry
}: {
  itemLabel: string;
  state: MasteryHistoryItemState;
  entry: MasteryHistoryEntry;
}) {
  const mastery =
    entry.masteryOptions.find((option) => option.id === state.masteryOptionId)
      ?.name ?? "未设置";
  const errors = state.errorReasonOptionIds
    .map(
      (id) =>
        entry.errorReasonOptions.find((option) => option.id === id)?.name
    )
    .filter((name): name is string => Boolean(name));
  return (
    <div className={styles.stateRow} role="row">
      <strong role="cell">{itemLabel}</strong>
      <span role="cell">{mastery}</span>
      <span role="cell">{errors.length ? errors.join("、") : "未设置"}</span>
    </div>
  );
}

function formatLocalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
