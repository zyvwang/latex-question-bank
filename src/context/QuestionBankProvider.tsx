import type { PropsWithChildren } from "react";
import { useQuestionBankModel } from "../hooks/useQuestionBankModel.js";
import {
  AppViewContext,
  CompileExportContext,
  LifecycleContext,
  QuestionContext,
  ReviewContext,
  SelectionContext,
  WorkspaceContext,
  WorkspaceUiContext
} from "./questionBankContexts.js";

export function QuestionBankProvider({ children }: PropsWithChildren) {
  const value = useQuestionBankModel();
  return (
    <LifecycleContext.Provider value={value.lifecycle}>
      <WorkspaceContext.Provider value={value.workspace}>
        <QuestionContext.Provider value={value.questions}>
          <SelectionContext.Provider value={value.selection}>
            <CompileExportContext.Provider value={value.compileExport}>
              <WorkspaceUiContext.Provider value={value.workspaceUi}>
                <AppViewContext.Provider value={value.appView}>
                  <ReviewContext.Provider value={value.review}>
                    {children}
                  </ReviewContext.Provider>
                </AppViewContext.Provider>
              </WorkspaceUiContext.Provider>
            </CompileExportContext.Provider>
          </SelectionContext.Provider>
        </QuestionContext.Provider>
      </WorkspaceContext.Provider>
    </LifecycleContext.Provider>
  );
}
