export interface UiLayoutPreferences {
  questionSidebarWidth: number;
  questionSidebarCollapsed: boolean;
  moduleEditorPercent: number;
  heatmapPreviewWidth: number;
  heatmapPreviewCollapsed: boolean;
}

export const UI_LAYOUT_LIMITS = {
  questionSidebarWidth: { min: 240, max: 360 },
  moduleEditorPercent: { min: 35, max: 65 },
  heatmapPreviewWidth: { min: 380, max: 520 }
} as const;

export const DEFAULT_UI_LAYOUT_PREFERENCES: UiLayoutPreferences = {
  questionSidebarWidth: 288,
  questionSidebarCollapsed: false,
  moduleEditorPercent: 55,
  heatmapPreviewWidth: 420,
  heatmapPreviewCollapsed: false
};

export function normalizeUiLayoutPreferences(input: unknown): UiLayoutPreferences {
  const candidate = isRecord(input) ? input : {};
  return {
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
    ),
    heatmapPreviewWidth: clampNumber(
      candidate.heatmapPreviewWidth,
      UI_LAYOUT_LIMITS.heatmapPreviewWidth,
      DEFAULT_UI_LAYOUT_PREFERENCES.heatmapPreviewWidth
    ),
    heatmapPreviewCollapsed: booleanOrDefault(
      candidate.heatmapPreviewCollapsed,
      DEFAULT_UI_LAYOUT_PREFERENCES.heatmapPreviewCollapsed
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
