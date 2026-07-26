import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useReview } from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./SettingsScreen.module.css";

export function ChapterSettings() {
  const review = useReview();
  const [newName, setNewName] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function createChapter() {
    if (review.createChapter(newName)) setNewName("");
  }

  return (
    <section className={styles.section} aria-labelledby="chapter-settings-title">
      <header>
        <div>
          <h2 id="chapter-settings-title">章节</h2>
          <p>正式章节按此顺序显示和导出；未分类始终位于最后。</p>
        </div>
        <div className={styles.createRow}>
          <input
            aria-label="新章节名称"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createChapter();
            }}
            placeholder="新章节名称"
          />
          <button
            className={controls.secondaryAction}
            onClick={createChapter}
            disabled={!newName.trim()}
          >
            <Plus size={16} />新建
          </button>
        </div>
      </header>
      <div className={styles.rows}>
        {review.chapters.map((chapter, index) => (
          <ChapterRow
            key={chapter.id}
            chapter={chapter}
            index={index}
            total={review.chapters.length}
            draggedId={draggedId}
            setDraggedId={setDraggedId}
          />
        ))}
        <div className={`${styles.row} ${styles.systemRow}`}>
          <span className={styles.orderNumber}>—</span>
          <strong>未分类</strong>
          <small>固定在最后，不创建章节实体</small>
        </div>
      </div>
    </section>
  );
}

function ChapterRow({
  chapter,
  index,
  total,
  draggedId,
  setDraggedId
}: {
  chapter: ReturnType<typeof useReview>["chapters"][number];
  index: number;
  total: number;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
}) {
  const review = useReview();
  const [draft, setDraft] = useState(chapter.name);

  useEffect(() => setDraft(chapter.name), [chapter.name]);

  function commit() {
    if (!review.renameChapter(chapter.id, draft)) setDraft(chapter.name);
  }

  return (
    <div
      className={`${styles.row} ${draggedId === chapter.id ? styles.dragging : ""}`}
      draggable
      onDragStart={() => setDraggedId(chapter.id)}
      onDragEnd={() => setDraggedId(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => {
        if (!draggedId || draggedId === chapter.id) return;
        const to = review.chapters.findIndex((candidate) => candidate.id === chapter.id);
        review.moveChapterToIndex(draggedId, to);
        setDraggedId(null);
      }}
    >
      <span className={styles.dragHandle} title="拖拽排序"><GripVertical size={16} /></span>
      <span className={styles.orderNumber}>{index + 1}</span>
      <input
        aria-label={`章节名称 ${chapter.name}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(chapter.name);
            event.currentTarget.blur();
          }
        }}
      />
      <div className={styles.rowActions}>
        <button
          className={controls.iconButton}
          onClick={() => review.moveChapter(chapter.id, -1)}
          disabled={index === 0}
          aria-label={`上移章节 ${chapter.name}`}
        ><ArrowUp size={16} /></button>
        <button
          className={controls.iconButton}
          onClick={() => review.moveChapter(chapter.id, 1)}
          disabled={index === total - 1}
          aria-label={`下移章节 ${chapter.name}`}
        ><ArrowDown size={16} /></button>
        <button
          className={`${controls.iconButton} ${controls.danger}`}
          onClick={() => review.deleteChapter(chapter.id)}
          aria-label={`删除章节 ${chapter.name}`}
        ><Trash2 size={16} /></button>
      </div>
    </div>
  );
}
