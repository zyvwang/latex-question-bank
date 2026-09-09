import { LoadingScreen } from "./components/LoadingScreen.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { AppNavigation } from "./components/AppNavigation.js";
import { Overlays } from "./components/Overlays.js";
import { RecoveryScreen } from "./components/RecoveryScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { HeatmapScreen } from "./components/HeatmapScreen.js";
import { EditorLayout } from "./components/EditorLayout.js";
import { QuestionBankProvider } from "./context/QuestionBankProvider.js";
import { LayoutPreferencesProvider } from "./context/LayoutPreferencesContext.js";
import { useBeforeCloseFlush } from "./hooks/useBeforeCloseFlush.js";
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
  useBeforeCloseFlush();

  if (lifecycle.loadError) return <RecoveryScreen />;
  if (!workspace.appInfo) return <LoadingScreen />;
  if (workspace.appInfo.setupRequired) return <SetupScreen />;
  if (!questions.bank) return <LoadingScreen />;

  return (
    <>
      <a className={styles.skipLink} href="#main-workspace">
        跳到主要内容
      </a>
      <main className={styles.appShell}>
        <div inert={lifecycle.isSavingConflictAs || workspace.isChangingWorkspace || undefined} style={{ display: "contents" }}>
          <AppNavigation />
          {appView.activeView === "editor" ? (
            <EditorLayout />
          ) : appView.activeView === "heatmap" ? (
            <HeatmapScreen />
          ) : (
            <SettingsScreen />
          )}
        </div>
        <Overlays />
      </main>
    </>
  );
}

export default function App() {
  // 边界包在 Provider 外面:updateBank 的 updater 在 Provider 的 render 阶段执行。
  return (
    <AppErrorBoundary>
      <LayoutPreferencesProvider>
        <QuestionBankProvider>
          <AppContent />
        </QuestionBankProvider>
      </LayoutPreferencesProvider>
    </AppErrorBoundary>
  );
}
