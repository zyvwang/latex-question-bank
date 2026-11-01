import { useQuestions } from "../context/questionBankContexts.js";
import { QuestionAssets } from "./QuestionAssets.js";
import { VariantField } from "./QuestionVariantField.js";
import styles from "./WorkspaceView.module.css";

export function ContextRow() {
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

