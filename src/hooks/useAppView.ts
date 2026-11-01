import { useCallback, useState } from "react";

export type AppView = "editor" | "review" | "distribution" | "settings";

export function useAppView() {
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [distributionExpanded, setDistributionExpanded] = useState<string[]>([]);
  const [distributionScrollTop, setDistributionScrollTop] = useState(0);

  const resetAppView = useCallback((nextActiveView: AppView = "editor") => {
    setActiveView(nextActiveView);
    setDistributionExpanded([]);
    setDistributionScrollTop(0);
  }, []);

  const toggleDistributionChapter = useCallback((id: string) => {
    setDistributionExpanded((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }, []);

  return {
    activeView,
    setActiveView,
    distributionExpanded,
    toggleDistributionChapter,
    distributionScrollTop,
    setDistributionScrollTop,
    resetAppView
  };
}
