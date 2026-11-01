import { ChapterCombobox } from "./ChapterCombobox.js";
import styles from "./WorkspaceView.module.css";

export function ChapterField() {
  return (
    <label className={styles.chapterField}>
      <span>章节</span>
      <ChapterCombobox />
    </label>
  );
}
