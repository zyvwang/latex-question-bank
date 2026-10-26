import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { BookRecord } from "../../shared/types.js";
import {
  useBankSettings,
  useQuestions
} from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./SettingsScreen.module.css";

export function BooksSettings() {
  const settings = useBankSettings();
  const questions = useQuestions();
  const [newTitle, setNewTitle] = useState("");

  function createBook() {
    if (settings.createBook(newTitle)) setNewTitle("");
  }

  return (
    <section className={styles.section} aria-labelledby="books-settings-title">
      <header>
        <div>
          <h2 id="books-settings-title">书目</h2>
          <p>书目用于来源题号和 Agent 导入；路径与哈希只是元数据，应用不会读取 PDF。</p>
        </div>
        <div className={styles.createRow}>
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createBook();
            }}
            placeholder="新书目名称"
            aria-label="新书目名称"
          />
          <button
            className={controls.primaryAction}
            onClick={createBook}
            disabled={!newTitle.trim()}
          >
            新建书目
          </button>
        </div>
      </header>
      {settings.books.length === 0 ? (
        <p className={styles.emptyState}>
          尚无书目。可以在上方新建，或由 Agent 导入时自动创建。
        </p>
      ) : (
        <div className={styles.rows}>
          {settings.books.map((book) => (
            <BookRow
              key={book.id}
              book={book}
              itemCount={
                questions.bank?.items.filter(
                  (item) => item.source?.bookId === book.id
                ).length ?? 0
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BookRow({ book, itemCount }: { book: BookRecord; itemCount: number }) {
  const settings = useBankSettings();
  const [title, setTitle] = useState(book.title);
  const [filePath, setFilePath] = useState(book.filePath ?? "");
  const [answerBookPath, setAnswerBookPath] = useState(
    book.answerBookPath ?? ""
  );

  useEffect(() => setTitle(book.title), [book.id, book.title]);
  useEffect(() => setFilePath(book.filePath ?? ""), [book.id, book.filePath]);
  useEffect(
    () => setAnswerBookPath(book.answerBookPath ?? ""),
    [book.id, book.answerBookPath]
  );

  function commitTitle() {
    if (!settings.renameBook(book.id, title)) setTitle(book.title);
  }

  function commitPaths() {
    settings.setBookPaths(book.id, { filePath, answerBookPath });
  }

  return (
    <div className={`${styles.row} ${styles.bookRow}`}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        aria-label={`书目名称 ${book.title}`}
      />
      <input
        value={filePath}
        onChange={(event) => setFilePath(event.target.value)}
        onBlur={commitPaths}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="PDF 路径"
        aria-label={`${book.title} 的 PDF 路径`}
      />
      <input
        value={answerBookPath}
        onChange={(event) => setAnswerBookPath(event.target.value)}
        onBlur={commitPaths}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="答案册路径"
        aria-label={`${book.title} 的答案册路径`}
      />
      <span className={styles.bookCount}>{itemCount} 题</span>
      <small className={styles.hashState}>
        {book.fileHash || book.answerBookHash ? "哈希已记录" : "无哈希"}
      </small>
      <button
        className={`${controls.iconButton} ${controls.danger}`}
        onClick={() => settings.deleteBook(book.id)}
        disabled={itemCount > 0}
        title={
          itemCount > 0
            ? `仍有 ${itemCount} 道题引用，无法删除`
            : "删除书目"
        }
        aria-label={`删除书目 ${book.title}`}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
