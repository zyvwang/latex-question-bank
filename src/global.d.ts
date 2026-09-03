export {};

import type { UiLayoutPreferences } from "../shared/ui-layout-preferences.js";

declare global {
  interface Window {
    lqb?: {
      platform: string;
      selectWorkspaceDirectory: (title?: string) => Promise<string | null>;
      openPath: (targetPath: string) => Promise<string>;
      revealExportFolder: (exportName: string) => Promise<boolean>;
      openExternal: (targetUrl: string) => Promise<boolean>;
      readUiLayoutPreferences?: () => Promise<UiLayoutPreferences>;
      saveUiLayoutPreferences?: (
        preferences: UiLayoutPreferences
      ) => Promise<UiLayoutPreferences>;
      onBeforeClose: (listener: () => Promise<void>) => () => void;
    };
    MathJax?: {
      loader?: { paths?: Record<string, string> };
      tex?: unknown;
      options?: unknown;
      startup?: { promise?: Promise<void> };
      texReset?: (startNumber?: number) => void;
      typesetClear?: (elements?: HTMLElement[]) => void;
      typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
    };
  }
}
