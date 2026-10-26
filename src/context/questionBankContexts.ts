import { createContext, useContext } from "react";
import type {
  AppViewContextValue,
  BankSettingsContextValue,
  CompileExportContextValue,
  LifecycleContextValue,
  QuestionContextValue,
  SelectionContextValue,
  WorkspaceContextValue,
  WorkspaceUiContextValue
} from "./questionBankContextTypes.js";

export const LifecycleContext = createContext<LifecycleContextValue | null>(null);
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export const QuestionContext = createContext<QuestionContextValue | null>(null);
export const SelectionContext = createContext<SelectionContextValue | null>(null);
export const CompileExportContext = createContext<CompileExportContextValue | null>(null);
export const WorkspaceUiContext = createContext<WorkspaceUiContextValue | null>(null);
export const AppViewContext = createContext<AppViewContextValue | null>(null);
export const BankSettingsContext = createContext<BankSettingsContextValue | null>(null);

export const useLifecycle = () => useRequiredContext(LifecycleContext, "LifecycleContext");
export const useWorkspace = () => useRequiredContext(WorkspaceContext, "WorkspaceContext");
export const useQuestions = () => useRequiredContext(QuestionContext, "QuestionContext");
export const useSelection = () => useRequiredContext(SelectionContext, "SelectionContext");
export const useCompileExport = () =>
  useRequiredContext(CompileExportContext, "CompileExportContext");
export const useWorkspaceUi = () =>
  useRequiredContext(WorkspaceUiContext, "WorkspaceUiContext");
export const useAppView = () =>
  useRequiredContext(AppViewContext, "AppViewContext");
export const useBankSettings = () =>
  useRequiredContext(BankSettingsContext, "BankSettingsContext");

function useRequiredContext<T>(context: React.Context<T | null>, name: string): T {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used within QuestionBankProvider.`);
  return value;
}
