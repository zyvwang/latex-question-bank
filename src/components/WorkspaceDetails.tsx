import { useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useQuestions } from "../context/questionBankContexts.js";
import styles from "./WorkspaceView.module.css";
import { SourceField } from "./QuestionSourceField.js";
import { ChapterField } from "./QuestionChapterField.js";
import { LabelsField } from "./QuestionLabelsField.js";
import { ReviewPriorityField } from "./QuestionReviewPriorityField.js";
import { ReviewStatusField } from "./QuestionReviewStatusField.js";
import { ContextRow } from "./QuestionContextRow.js";

export function WorkspaceDetails({ actions }: { actions: ReactNode }) {
  const questions = useQuestions();
  const [open, setOpen] = useState(true);
  const item = questions.activeItem;
  if (!item) return null;
  const Icon = open ? PanelRightClose : PanelRightOpen;
  return (
    <section
      className={`${styles.metadataPanel} ${open ? "" : styles.metadataClosed}`}
      aria-label="题目元数据"
    >
      <header className={styles.metadataHead}>
        {open && <h2>题目信息</h2>}
        <button
          type="button"
          aria-label={open ? "收起题目信息" : "展开题目信息"}
          title={open ? "收起题目信息" : "展开题目信息"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon size={17} />
        </button>
      </header>
      {/* 收起时保留节点：来源字段的草稿要继续走失焦提交，不能随卸载丢失。 */}
      <div className={styles.metadataBody} hidden={!open}>
        <ReviewPriorityField />
        <SourceField key={item.id} />
        <ChapterField />
        <LabelsField />
        <ReviewStatusField />
        <ContextRow />
        {actions}
      </div>
    </section>
  );
}

