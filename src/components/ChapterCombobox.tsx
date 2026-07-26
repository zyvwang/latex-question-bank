import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { normalizeUniqueName } from "../../shared/review-options.js";
import { useQuestions, useReview } from "../context/questionBankContexts.js";
import styles from "./ChapterCombobox.module.css";

export function ChapterCombobox() {
  const questions = useQuestions();
  const review = useReview();
  const item = questions.activeItem;
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [item?.id]);

  if (!item) return null;

  function createOrSelect() {
    const normalized = normalizeUniqueName(draft);
    if (!normalized) return;
    const existing = review.chapters.find(
      (chapter) => normalizeUniqueName(chapter.name) === normalized
    );
    const chapterId = existing?.id ?? review.createChapter(draft);
    if (!chapterId) return;
    if (questions.moveItemToChapter(item!.id, chapterId)) setDraft("");
  }

  return (
    <div className={styles.combobox}>
      <select
        aria-label="选择章节"
        value={item.chapterId ?? ""}
        onChange={(event) =>
          questions.moveItemToChapter(item.id, event.target.value || null)
        }
      >
        <option value="">未分类</option>
        {review.chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.name}
          </option>
        ))}
      </select>
      <input
        aria-label="新章节名称"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            createOrSelect();
          }
        }}
        placeholder="输入并创建章节"
      />
      <button
        type="button"
        onClick={createOrSelect}
        disabled={!draft.trim()}
        aria-label="创建或选择章节"
        title="创建或选择章节"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
