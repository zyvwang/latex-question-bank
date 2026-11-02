import { useCallback, useState } from "react";

export type AppView = "editor" | "review" | "distribution" | "papers" | "settings";

export type ReviewTab = "originals" | "versions";

export function useAppView() {
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [reviewTab, setReviewTab] = useState<ReviewTab>("originals");
  // An object so that asking for the same family twice still reopens it.
  const [variantFocus, setVariantFocus] = useState<{ familyId: string } | null>(null);
  const [distributionExpanded, setDistributionExpanded] = useState<string[]>([]);
  const [distributionScrollTop, setDistributionScrollTop] = useState(0);

  const resetAppView = useCallback((nextActiveView: AppView = "editor") => {
    setActiveView(nextActiveView);
    setReviewTab("originals");
    setVariantFocus(null);
    setDistributionExpanded([]);
    setDistributionScrollTop(0);
  }, []);

  const toggleDistributionChapter = useCallback((id: string) => {
    setDistributionExpanded((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }, []);

  const focusVariantFamily = useCallback((familyId: string) => {
    setVariantFocus({ familyId });
    setActiveView("papers");
  }, []);

  return {
    activeView,
    setActiveView,
    reviewTab,
    setReviewTab,
    variantFocus,
    focusVariantFamily,
    distributionExpanded,
    toggleDistributionChapter,
    distributionScrollTop,
    setDistributionScrollTop,
    resetAppView
  };
}
