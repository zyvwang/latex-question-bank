import { useSourceFieldDraft } from "../hooks/useSourceFieldDraft.js";
import styles from "./WorkspaceView.module.css";

export function SourceField() {
  const {
    item, books, bookId, label,
    changeBookId, changeLabel, labelInputRef, commit, createBook
  } = useSourceFieldDraft();
  if (!item) return null;

  return (
    <div className={styles.sourceField}>
      <span>来源</span>
      <select
        aria-label="来源书目"
        value={bookId}
        onChange={(event) => changeBookId(event.target.value)}
      >
        <option value="">未关联书目</option>
        {books.map((book) => (
          <option key={book.id} value={book.id}>
            {book.title}
          </option>
        ))}
      </select>
      <input
        ref={labelInputRef}
        value={label}
        onChange={(event) => changeLabel(event.target.value)}
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

