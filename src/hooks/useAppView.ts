import { useCallback, useState } from "react";
import type { DistributionStatus } from "../reviewDistribution.js";

export type AppView = "editor" | "review" | "distribution" | "settings";

export function useAppView() {
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [distributionHighlight, setDistributionHighlight] =
    useState<DistributionStatus | null>(null);
  const [distributionFocusedId, setDistributionFocusedId] =
    useState<string | null>(null);
  const [distributionScrollTop, setDistributionScrollTop] = useState(0);

  const resetAppView = useCallback((nextActiveView: AppView = "editor") => {
    setActiveView(nextActiveView);
    setDistributionHighlight(null);
    setDistributionFocusedId(null);
    setDistributionScrollTop(0);
  }, []);

  return {
    activeView,
    setActiveView,
    distributionHighlight,
    setDistributionHighlight,
    distributionFocusedId,
    setDistributionFocusedId,
    distributionScrollTop,
    setDistributionScrollTop,
    resetAppView
  };
}
