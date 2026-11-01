import { isSkinId } from "./skins.js";

export interface UiLayoutPreferences {
  skinMode: "system" | "light" | "dark";
  lightSkinId: string;
  darkSkinId: string;
  questionSidebarWidth: number;
  questionSidebarCollapsed: boolean;
  moduleEditorPercent: number;
}

export const UI_LAYOUT_LIMITS = {
  questionSidebarWidth: { min: 240, max: 360 },
  moduleEditorPercent: { min: 35, max: 65 }
} as const;

export const DEFAULT_UI_LAYOUT_PREFERENCES: UiLayoutPreferences = {
  skinMode: "light",
  lightSkinId: "sheet",
  darkSkinId: "darkroom",
  questionSidebarWidth: 288,
  questionSidebarCollapsed: false,
  moduleEditorPercent: 55
};

export function normalizeUiLayoutPreferences(input: unknown): UiLayoutPreferences {
  const candidate = isRecord(input) ? input : {};
  return {
    skinMode: candidate.skinMode === "system" || candidate.skinMode === "dark" ? candidate.skinMode : "light",
    lightSkinId: isSkinId(candidate.lightSkinId) ? candidate.lightSkinId : "sheet",
    darkSkinId: isSkinId(candidate.darkSkinId) ? candidate.darkSkinId : "darkroom",
    questionSidebarWidth: clampNumber(
      candidate.questionSidebarWidth,
      UI_LAYOUT_LIMITS.questionSidebarWidth,
      DEFAULT_UI_LAYOUT_PREFERENCES.questionSidebarWidth
    ),
    questionSidebarCollapsed: booleanOrDefault(
      candidate.questionSidebarCollapsed,
      DEFAULT_UI_LAYOUT_PREFERENCES.questionSidebarCollapsed
    ),
    moduleEditorPercent: clampNumber(
      candidate.moduleEditorPercent,
      UI_LAYOUT_LIMITS.moduleEditorPercent,
      DEFAULT_UI_LAYOUT_PREFERENCES.moduleEditorPercent
    )
  };
}

function clampNumber(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
