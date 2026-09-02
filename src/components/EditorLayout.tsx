import { useRef, type CSSProperties } from "react";
import {
  UI_LAYOUT_LIMITS
} from "../../shared/ui-layout-preferences.js";
import { useLayoutPreferences } from "../context/layoutPreferences.js";
import { PaneResizeHandle } from "./PaneResizeHandle.js";
import { Sidebar } from "./Sidebar.js";
import { WorkspaceView } from "./WorkspaceView.js";
import styles from "./EditorLayout.module.css";

export function EditorLayout() {
  const { preferences, updatePreferences } = useLayoutPreferences();
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const collapsed = preferences.questionSidebarCollapsed;

  function previewWidth(value: number) {
    layoutRef.current?.style.setProperty("--question-sidebar-width", `${value}px`);
  }

  return (
    <div
      ref={layoutRef}
      className={`${styles.layout} ${collapsed ? styles.collapsed : ""}`}
      style={{
        "--question-sidebar-width": `${preferences.questionSidebarWidth}px`
      } as CSSProperties}
    >
      <Sidebar
        collapsed={collapsed}
        onCollapsedChange={(nextCollapsed) =>
          updatePreferences({ questionSidebarCollapsed: nextCollapsed })
        }
      />
      {!collapsed && (
        <PaneResizeHandle
          value={preferences.questionSidebarWidth}
          min={UI_LAYOUT_LIMITS.questionSidebarWidth.min}
          max={UI_LAYOUT_LIMITS.questionSidebarWidth.max}
          step={8}
          label="调整题目侧栏宽度"
          controls="question-sidebar main-workspace"
          valueText={(value) => `${Math.round(value)} 像素`}
          onPreview={previewWidth}
          onCommit={(questionSidebarWidth) =>
            updatePreferences({ questionSidebarWidth })
          }
        />
      )}
      <WorkspaceView />
    </div>
  );
}
