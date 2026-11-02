import controls from '../styles/controls.module.css';
import { useQuestions, useAppView } from "../context/questionBankContexts.js";
import { QuestionAssets } from "./QuestionAssets.js";
import styles from "./WorkspaceView.module.css";

export function ContextRow() {
  const {setActiveView}=useAppView();
  const questions = useQuestions();
  const item = questions.activeItem;
  if (!item) return null;
  return (
    <div className={styles.contextRow}>
      <button className={controls.tertiaryAction} onClick={() => {setActiveView("papers");requestAnimationFrame(() => {const panel=document.getElementById("variant-manager");if (panel instanceof HTMLDetailsElement) {panel.open=true;panel.scrollIntoView({block:"start"});}});}}>管理表达版本</button>
      <QuestionAssets assets={item.assets} itemId={item.id} />
    </div>
  );
}

