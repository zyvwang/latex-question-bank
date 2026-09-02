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
  const pendingPersistRef = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback((next: UiLayoutPreferences) => {
    if (window.lqb?.saveUiLayoutPreferences) {
      pendingPersistRef.current = window.lqb.saveUiLayoutPreferences(next)
        .then(() => undefined)
        .catch((error: unknown) => {
          console.warn("无法保存界面布局偏好。", error);
        });
      return pendingPersistRef.current;
    }
    try {
      if (!window.localStorage) return Promise.resolve();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn("无法保存界面布局偏好。", error);
    }
    pendingPersistRef.current = Promise.resolve();
    return pendingPersistRef.current;
  }, []);

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
    if (!hydratedRef.current) return undefined;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void persist(preferencesRef.current);
    }, 180);
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [persist, preferences]);

  useEffect(() => {
    if (!window.lqb?.saveUiLayoutPreferences) return undefined;
    return window.lqb.onBeforeClose(async () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        await persist(preferencesRef.current);
      }
      await pendingPersistRef.current;
    });
  }, [persist]);

  const updatePreferences = useCallback((patch: Partial<UiLayoutPreferences>) => {
    if (!hydratedRef.current) updatedBeforeHydrationRef.current = true;
    hydratedRef.current = true;
    setPreferences((current) => {
      const next = normalizeUiLayoutPreferences({ ...current, ...patch });
      preferencesRef.current = next;
      return next;
    });
  }, []);

  return (
    <LayoutPreferencesContext.Provider value={{ preferences, updatePreferences }}>
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
