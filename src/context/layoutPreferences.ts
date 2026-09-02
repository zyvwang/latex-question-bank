import { createContext, useContext } from "react";
import type { UiLayoutPreferences } from "../../shared/ui-layout-preferences.js";

export interface LayoutPreferencesContextValue {
  preferences: UiLayoutPreferences;
  updatePreferences: (patch: Partial<UiLayoutPreferences>) => void;
}

export const LayoutPreferencesContext =
  createContext<LayoutPreferencesContextValue | null>(null);

export function useLayoutPreferences(): LayoutPreferencesContextValue {
  const value = useContext(LayoutPreferencesContext);
  if (!value) throw new Error("LayoutPreferencesProvider is missing.");
  return value;
}
