import { createContext, useContext } from "react";
import type { Skin, SkinList } from "../../shared/skins.js";

export interface SkinContextValue {
  skins: Skin[];
  errors: SkinList["errors"];
  activeSkin: Skin;
  chooseSkin: (skin: Skin) => void;
}

export const SkinContext = createContext<SkinContextValue | null>(null);

export function useSkins(): SkinContextValue {
  const value = useContext(SkinContext);
  if (!value) throw new Error("SkinProvider is missing.");
  return value;
}
