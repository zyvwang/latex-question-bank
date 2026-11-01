import type { Skin } from "../../shared/skins.js";
import { useLayoutPreferences } from "../context/layoutPreferences.js";
import { useSkins } from "../context/skins.js";
import styles from "./SkinSettings.module.css";

const MODES = [
  ["system", "跟随系统"],
  ["light", "浅色"],
  ["dark", "深色"]
] as const;

export function SkinSettings() {
  const { preferences, updatePreferences } = useLayoutPreferences();
  const { skins, errors, chooseSkin } = useSkins();
  return (
    <section className={styles.section} aria-labelledby="skin-settings-title">
      <h2 id="skin-settings-title">皮肤</h2>
      <div className={styles.body}>
        <div className={styles.modes} role="group" aria-label="明暗模式">
          {MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={preferences.skinMode === mode}
              onClick={() => updatePreferences({ skinMode: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <SkinGroup
          title="浅色时使用"
          skins={skins.filter((skin) => skin.mode === "light")}
          selectedId={preferences.lightSkinId}
          onChoose={chooseSkin}
        />
        <SkinGroup
          title="深色时使用"
          skins={skins.filter((skin) => skin.mode === "dark")}
          selectedId={preferences.darkSkinId}
          onChoose={chooseSkin}
        />
        <div className={styles.custom}>
          <h3>自定义皮肤</h3>
          <p>
            让你的 Agent 阅读仓库里的 docs/skin-authoring.md，生成配色和布局选项。皮肤文件只含设计设置，不含代码。安装后会立刻出现在这里。
          </p>
          <code>lqb skin init my-skin</code>
          {errors.length > 0 && (
            <ul role="alert" aria-label="无法读取的皮肤">
              {errors.map((error) => <li key={`${error.file}-${error.code}`}>{error.message}</li>)}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function SkinGroup({
  title,
  skins,
  selectedId,
  onChoose
}: {
  title: string;
  skins: Skin[];
  selectedId: string;
  onChoose: (skin: Skin) => void;
}) {
  return (
    <div className={styles.group} role="group" aria-label={title}>
      <h3>{title}</h3>
      <div className={styles.skins}>
        {skins.map((skin) => (
          <button
            key={skin.id}
            type="button"
            className={styles.skin}
            aria-pressed={skin.id === selectedId}
            onClick={() => onChoose(skin)}
          >
            <span className={styles.chips} aria-hidden="true">
              <i style={{ background: skin.tokens.chrome }} />
              <i style={{ background: skin.tokens.text }} />
              <i style={{ background: skin.tokens.must }} />
            </span>
            {skin.name}
          </button>
        ))}
      </div>
    </div>
  );
}
