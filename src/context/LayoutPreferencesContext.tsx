import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import {
  DEFAULT_UI_LAYOUT_PREFERENCES,
  normalizeUiLayoutPreferences,
  type UiLayoutPreferences
} from "../../shared/ui-layout-preferences.js";
import { LayoutPreferencesContext } from "./layoutPreferences.js";

const STORAGE_KEY = "latex-question-bank.ui-layout.v1";

export function LayoutPreferencesProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState<UiLayoutPreferences>(
    DEFAULT_UI_LAYOUT_PREFERENCES
  );
  const preferencesRef = useRef(preferences);
  const hydratedRef = useRef(false);
  const updatedBeforeHydrationRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const pendingPersistRef = useRef<Promise<void> | null>(null);
  const dirtyRef = useRef(false);
  const [persistError, setPersistError] = useState<string | null>(null);

  const clearTimer = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, []);

  const retryPersist = useCallback((): Promise<void> => {
    clearTimer();
    if (pendingPersistRef.current) return pendingPersistRef.current;
    if (!dirtyRef.current) return Promise.resolve();
    const operation = (async () => {
      while (dirtyRef.current) {
        const next = preferencesRef.current;
        try {
          if (window.lqb?.saveUiLayoutPreferences) {
            await window.lqb.saveUiLayoutPreferences(next);
          } else {
            if (!window.localStorage) throw new Error("Local storage unavailable");
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          }
          // An adjustment during the write must be saved before close can succeed.
          dirtyRef.current = preferencesRef.current !== next;
          setPersistError(null);
        } catch {
          const message = "界面布局未保存，请重试。";
          setPersistError(message);
          throw new Error(message);
        }
      }
    })();
    const tracked = operation.finally(() => { pendingPersistRef.current = null; });
    pendingPersistRef.current = tracked;
    return tracked;
  }, [clearTimer]);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      let next: UiLayoutPreferences = DEFAULT_UI_LAYOUT_PREFERENCES;
      try {
        next = window.lqb?.readUiLayoutPreferences
          ? normalizeUiLayoutPreferences(await window.lqb.readUiLayoutPreferences())
          : readBrowserPreferences();
      } catch (error) {
        console.warn("无法读取界面布局偏好。", error);
      }
      if (cancelled) return;
      if (!updatedBeforeHydrationRef.current) {
        preferencesRef.current = next;
        setPreferences(next);
      }
      hydratedRef.current = true;
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) return undefined;
    clearTimer();
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void retryPersist().catch(() => undefined);
    }, 180);
    return clearTimer;
  }, [clearTimer, retryPersist, preferences]);

  useEffect(() => {
    if (!window.lqb?.saveUiLayoutPreferences) return undefined;
    return window.lqb.onBeforeClose(retryPersist);
  }, [retryPersist]);

  const updatePreferences = useCallback((patch: Partial<UiLayoutPreferences>) => {
    if (!hydratedRef.current) updatedBeforeHydrationRef.current = true;
    hydratedRef.current = true;
    const next = normalizeUiLayoutPreferences({ ...preferencesRef.current, ...patch });
    preferencesRef.current = next;
    dirtyRef.current = true;
    setPreferences(next);
  }, []);

  return (
    <LayoutPreferencesContext.Provider value={{ preferences, updatePreferences, persistError, retryPersist }}>
      {children}
    </LayoutPreferencesContext.Provider>
  );
}

function readBrowserPreferences(): UiLayoutPreferences {
  try {
    if (!window.localStorage) return DEFAULT_UI_LAYOUT_PREFERENCES;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw
      ? normalizeUiLayoutPreferences(JSON.parse(raw))
      : DEFAULT_UI_LAYOUT_PREFERENCES;
  } catch (error) {
    console.warn("无法读取界面布局偏好。", error);
    return DEFAULT_UI_LAYOUT_PREFERENCES;
  }
}
