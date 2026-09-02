import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import {
  useQuestions,
  useSelection,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import { SidebarQuestionNavigation } from "./SidebarQuestionNavigation.js";
import styles from "./Sidebar.module.css";

export function Sidebar({
  collapsed,
  onCollapsedChange
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const questions = useQuestions();
  const selection = useSelection();
  const ui = useWorkspaceUi();
  if (collapsed) {
    return (
      <aside
        className={`${styles.sidebar} ${styles.collapsedSidebar}`}
        id="question-sidebar"
        aria-label="题库导航"
      >
        <button
          className={styles.collapseButton}
          type="button"
          onClick={() => onCollapsedChange(false)}
          aria-label="展开题目侧栏"
          title="展开题目侧栏"
        >
          <PanelLeftOpen size={18} />
        </button>
      </aside>
    );
  }
  return (
    <aside className={styles.sidebar} id="question-sidebar" aria-label="题库导航">
      <header className={styles.brandBar}>
        <div className={styles.brandIdentity}>
          <div>
            <h2>题目</h2>
            <p>
              {questions.orderedItems.length} 题 · 已选 {selection.selectedIds.size}
            </p>
          </div>
        </div>
        <div className={styles.brandActions}>
          <button
            className={styles.collapseButton}
            type="button"
            onClick={() => onCollapsedChange(true)}
            aria-label="收起题目侧栏"
            title="收起题目侧栏"
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            className={`${controls.iconButton} ${controls.primary}`}
            onClick={ui.openAddMenu}
            aria-label="打开新增题目菜单"
            title="新增题目"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>
      <SidebarQuestionNavigation />
    </aside>
  );
}
