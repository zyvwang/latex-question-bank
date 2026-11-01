import { useQuestions, useSelection } from "../context/questionBankContexts.js";
import { TagEditor } from "./TagEditor.js";
import styles from "./WorkspaceView.module.css";

export function LabelsField() {
  const questions = useQuestions();
  const selection = useSelection();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <div className={`${styles.tagsField} ${styles.tagsGroup}`} role="group" aria-label="考点与题型">
      <label>
        <span>考点</span>
        <TagEditor
          tags={item.topics}
          suggestions={selection.topics}
          noun="考点"
          listId="workspace-topic-suggestions"
          placeholder="极限, 泰勒公式"
          onChange={(topics) => questions.updateItem(item.id, { topics })}
        />
      </label>
      <label>
        <span>题型</span>
        <TagEditor
          tags={item.questionTypes}
          suggestions={selection.questionTypes}
          noun="题型"
          listId="workspace-type-suggestions"
          placeholder="选择, 解答"
          onChange={(questionTypes) => questions.updateItem(item.id, { questionTypes })}
        />
      </label>
    </div>
  );
}

