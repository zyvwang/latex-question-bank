import { useEffect, useRef } from "react";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { AppNavigation } from "./components/AppNavigation.js";
import { Overlays } from "./components/Overlays.js";
import { RecoveryScreen } from "./components/RecoveryScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { Sidebar } from "./components/Sidebar.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { HeatmapScreen } from "./components/HeatmapScreen.js";
import { WorkspaceView } from "./components/WorkspaceView.js";
import { QuestionBankProvider } from "./context/QuestionBankProvider.js";
import {
  useLifecycle,
  useAppView,
  useQuestions,
  useWorkspace
} from "./context/questionBankContexts.js";
import styles from "./styles/AppShell.module.css";

function AppContent() {
  const lifecycle = useLifecycle();
  const appView = useAppView();
  const workspace = useWorkspace();
  const questions = useQuestions();
  const flushRef = useRef(lifecycle.flushPendingChanges);
  flushRef.current = lifecycle.flushPendingChanges;

  useEffect(() => {
    return window.lqb?.onBeforeClose?.(() => flushRef.current());
  }, []);

  if (!workspace.appInfo) return <LoadingScreen />;
  if (workspace.appInfo.setupRequired) return <SetupScreen />;
  if (lifecycle.loadError) return <RecoveryScreen />;
  if (!questions.bank) return <LoadingScreen />;

  return (
    <>
      <a className={styles.skipLink} href="#main-workspace">
        跳到主要内容
      </a>
      <main className={styles.appShell}>
        <AppNavigation />
        {appView.activeView === "editor" ? (
          <div className={styles.editorLayout}>
            <Sidebar />
            <WorkspaceView />
          </div>
        ) : appView.activeView === "heatmap" ? (
          <HeatmapScreen />
        ) : (
          <SettingsScreen />
        )}
        <Overlays />
      </main>
    </>
  );
}

export default function App() {
  return (
    <QuestionBankProvider>
      <AppContent />
    </QuestionBankProvider>
  );
}
