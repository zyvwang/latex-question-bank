import { useEffect, useRef } from "react";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { Overlays } from "./components/Overlays.js";
import { RecoveryScreen } from "./components/RecoveryScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { Sidebar } from "./components/Sidebar.js";
import { WorkspaceView } from "./components/WorkspaceView.js";
import { QuestionBankProvider } from "./context/QuestionBankProvider.js";
import {
  useLifecycle,
  useQuestions,
  useWorkspace
} from "./context/questionBankContexts.js";
import styles from "./styles/AppShell.module.css";

function AppContent() {
  const lifecycle = useLifecycle();
  const workspace = useWorkspace();
  const questions = useQuestions();
  const flushRef = useRef(lifecycle.flushPendingChanges);
  flushRef.current = lifecycle.flushPendingChanges;

  useEffect(() => {
    return window.lqb?.onBeforeClose?.(() => flushRef.current());
  }, []);

  if (lifecycle.loadError) return <RecoveryScreen />;
  if (!questions.bank || !workspace.appInfo) return <LoadingScreen />;
  if (workspace.appInfo.setupRequired) return <SetupScreen />;

  return (
    <>
      <a className={styles.skipLink} href="#main-workspace">
        跳到编辑区
      </a>
      <main className={styles.appShell}>
        <Sidebar />
        <WorkspaceView />
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
