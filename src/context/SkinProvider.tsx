import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { BUILTIN_SKINS } from "../../shared/builtin-skins.js";
import { SKIN_TOKEN_NAMES, type Skin, type SkinList } from "../../shared/skins.js";
import { fetchSkins } from "../api/client.js";
import { useLayoutPreferences } from "./layoutPreferences.js";
import { SkinContext } from "./skins.js";

const BUILTIN_LIST: SkinList = { skins: [...BUILTIN_SKINS], errors: [] };
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function SkinProvider({ children }: PropsWithChildren) {
  const { preferences, updatePreferences } = useLayoutPreferences();
  const { skinMode, lightSkinId, darkSkinId } = preferences;
  const [list, setList] = useState<SkinList>(BUILTIN_LIST);
  const [systemDark, setSystemDark] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
  );

  const reload = useCallback(() => {
    // 读取失败时内置皮肤仍然可用，界面不能因此进入错误状态。
    void fetchSkins().then(setList).catch(() => undefined);
  }, []);

  useEffect(() => {
    reload();
    if (typeof EventSource === "undefined") return undefined;
    const source = new EventSource("/api/events");
    source.addEventListener("skins-changed", reload);
    return () => source.close();
  }, [reload]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const wantsDark = skinMode === "dark" || (skinMode === "system" && systemDark);
  const activeSkin = useMemo(
    () => resolveSkin(list.skins, wantsDark ? darkSkinId : lightSkinId, wantsDark),
    [darkSkinId, lightSkinId, list.skins, wantsDark]
  );

  useLayoutEffect(() => applySkin(activeSkin), [activeSkin]);

  const chooseSkin = useCallback((skin: Skin) => {
    updatePreferences(skin.mode === "dark" ? { darkSkinId: skin.id } : { lightSkinId: skin.id });
  }, [updatePreferences]);

  const value = useMemo(
    () => ({ skins: list.skins, errors: list.errors, activeSkin, chooseSkin }),
    [activeSkin, chooseSkin, list.errors, list.skins]
  );
  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

function resolveSkin(skins: Skin[], id: string, dark: boolean): Skin {
  const mode = dark ? "dark" : "light";
  return (
    skins.find((skin) => skin.id === id && skin.mode === mode) ??
    BUILTIN_SKINS.find((skin) => skin.id === (dark ? "darkroom" : "sheet"))!
  );
}

function applySkin(skin: Skin) {
  const root = document.documentElement;
  for (const name of SKIN_TOKEN_NAMES) {
    root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, skin.tokens[name]);
  }
  root.style.setProperty("--r", `${skin.options.radius}px`);
  root.style.colorScheme = skin.mode;
  root.dataset.skin = skin.id;
  root.dataset.nav = skin.options.nav;
  root.dataset.preview = skin.options.preview;
  root.dataset.density = skin.options.density;
  root.dataset.headingFont = skin.options.headingFont;
}
