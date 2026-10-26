import { useCallback, useState } from "react";

export type AppView = "editor" | "review" | "settings";

export function useAppView() {
  const [activeView, setActiveView] = useState<AppView>("editor");

  const resetAppView = useCallback((nextActiveView: AppView = "editor") => {
    setActiveView(nextActiveView);
  }, []);

  return {
    activeView,
    setActiveView,
    resetAppView
  };
}
