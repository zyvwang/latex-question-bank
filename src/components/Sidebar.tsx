import { Plus } from "lucide-react";
import {
  useQuestions,
  useSelection,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import { SidebarQuestionNavigation } from "./SidebarQuestionNavigation.js";
import { SidebarWorkspacePanel } from "./SidebarWorkspacePanel.js";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  const questions = useQuestions();
  const selection = useSelection();
  const ui = useWorkspaceUi();
  return (
    <aside className={styles.sidebar} aria-label="题库导航">
      <header className={styles.brandBar}>
        <div className={styles.brandIdentity}>
          <img src="/brand/icon-64.png" width="36" height="36" alt="" />
          <div>
            <h1>LaTeX 题库</h1>
            <p>
              {questions.orderedItems.length} 题 · 已选 {selection.selectedIds.size}
            </p>
          </div>
        </div>
        <button
          className={`${controls.iconButton} ${controls.primary}`}
          onClick={ui.openAddMenu}
          aria-label="打开新增题目菜单"
          title="新增题目"
        >
          <Plus size={18} />
        </button>
      </header>
      <SidebarWorkspacePanel />
      <SidebarQuestionNavigation />
    </aside>
  );
}
