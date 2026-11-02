import { PapersScreen } from "./components/PapersScreen.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { AppNavigation } from "./components/AppNavigation.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { Overlays } from "./components/Overlays.js";
import { RecoveryScreen } from "./components/RecoveryScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { EditorLayout } from "./components/EditorLayout.js";
import { ReviewScreen } from "./components/ReviewScreen.js";
import { DistributionScreen } from "./components/DistributionScreen.js";
import { ExternalBankBanner } from "./components/ExternalBankBanner.js";
import { QuestionBankProvider } from "./context/QuestionBankProvider.js";
import { LayoutPreferencesProvider } from "./context/LayoutPreferencesContext.js";
import { SkinProvider } from "./context/SkinProvider.js";
import { useBeforeCloseFlush } from "./hooks/useBeforeCloseFlush.js";
import {
  useLifecycle,
  useAppView,
  useQuestions,
  useWorkspace
} from "./context/questionBankContexts.js";
import controls from "./styles/controls.module.css";
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
        <div inert={lifecycle.isSavingConflictAs || workspace.isChangingWorkspace || workspace.isWorkspaceUncertain || undefined} style={{ display: "contents" }}>
          <AppNavigation />
          {appView.activeView === "editor" ? (
            <EditorLayout />
          ) : appView.activeView === "review" ? (
            <ReviewScreen />
          ) : appView.activeView === "distribution" ? (
            <DistributionScreen />
          ) : appView.activeView === "papers" ? null : (
            <SettingsScreen />
          )}
          <PapersScreen key={workspace.appInfo.currentWorkspacePath} workspace={workspace.appInfo.currentWorkspacePath} visible={appView.activeView === "papers"} variantFocus={appView.variantFocus} />
        </div>
        {workspace.isWorkspaceUncertain && (
          <div role="alert" className={styles.workspaceRecovery}>
            <p>工作区操作结果尚未确认。核对完成前暂停编辑，保留当前内容。</p>
            <button className={controls.secondaryAction} disabled={workspace.isChangingWorkspace}
              onClick={() => void workspace.openWorkspace()}>核对工作区状态</button>
          </div>
        )}
        <Overlays />
        <CommandPalette />
        <ExternalBankBanner />
      </main>
    </>
  );
}

export default function App() {
  // 边界包在 Provider 外面:updateBank 的 updater 在 Provider 的 render 阶段执行。
  return (
    <AppErrorBoundary>
      <LayoutPreferencesProvider>
        <SkinProvider>
          <QuestionBankProvider>
            <AppContent />
          </QuestionBankProvider>
        </SkinProvider>
      </LayoutPreferencesProvider>
    </AppErrorBoundary>
  );
}
