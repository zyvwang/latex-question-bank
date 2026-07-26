import { useCallback, useState } from "react";
import type { HeatmapMode } from "../heatmap.js";

export type AppView = "editor" | "heatmap" | "settings";

export function useAppView() {
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>("mastery");
  const [heatmapFocusedId, setHeatmapFocusedId] = useState<string | null>(null);
  const [heatmapScrollTop, setHeatmapScrollTop] = useState(0);

  const resetAppView = useCallback((nextActiveView: AppView = "editor") => {
    setActiveView(nextActiveView);
    setHeatmapMode("mastery");
    setHeatmapFocusedId(null);
    setHeatmapScrollTop(0);
  }, []);

  return {
    activeView,
    setActiveView,
    heatmapMode,
    setHeatmapMode,
    heatmapFocusedId,
    setHeatmapFocusedId,
    heatmapScrollTop,
    setHeatmapScrollTop,
    resetAppView
  };
}
