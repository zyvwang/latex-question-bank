import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  useAppView,
  useQuestions
} from "../context/questionBankContexts.js";
import { buildHeatmapGroups } from "../heatmap.js";
import type { ModuleKind } from "../../shared/types.js";
import { HeatmapGrid } from "./HeatmapGrid.js";
import { HeatmapPreview } from "./HeatmapPreview.js";
import styles from "./Heatmap.module.css";

type PreviewSource = "focus" | "hover";

export function HeatmapScreen() {
  const appView = useAppView();
  const {
    heatmapFocusedId,
    heatmapMode,
    heatmapScrollTop,
    openQuestionFromHeatmap,
    setHeatmapFocusedId,
    setHeatmapMode,
    setHeatmapScrollTop
  } = appView;
  const questions = useQuestions();
  const bank = questions.bank;
  const groups = useMemo(() => (bank ? buildHeatmapGroups(bank) : []), [bank]);
  const allItemIds = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => item.id)),
    [groups]
  );
  const initialId =
    heatmapFocusedId && allItemIds.includes(heatmapFocusedId)
      ? heatmapFocusedId
      : (allItemIds[0] ?? null);
  const [previewItemId, setPreviewItemId] = useState<string | null>(initialId);
  const [previewModule, setPreviewModule] = useState<ModuleKind>("question");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previewTimer = useRef<{
    source: PreviewSource | null;
    timer: number | null;
  }>({
    source: null,
    timer: null
  });
  const restoreScrollTop = useRef(heatmapScrollTop);
  const restoreFocusId = useRef(initialId);

  useEffect(() => {
    if (!initialId) return;
    if (heatmapFocusedId !== initialId) {
      setHeatmapFocusedId(initialId);
    }
    if (!previewItemId || !allItemIds.includes(previewItemId)) {
      setPreviewItemId(initialId);
    }
  }, [
    allItemIds,
    heatmapFocusedId,
    initialId,
    previewItemId,
    setHeatmapFocusedId
  ]);

  useEffect(() => {
    setPreviewModule("question");
  }, [previewItemId]);

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = restoreScrollTop.current;
    }
    if (!restoreFocusId.current) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`heatmap-cell-${restoreFocusId.current}`)?.focus({
        preventScroll: true
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const pending = previewTimer.current;
    const scroller = scrollRef.current;
    return () => {
      if (pending.timer !== null) window.clearTimeout(pending.timer);
      setHeatmapScrollTop(scroller?.scrollTop ?? 0);
    };
  }, [setHeatmapScrollTop]);

  const schedulePreview = useCallback((id: string, source: PreviewSource) => {
    if (previewTimer.current.timer !== null) {
      window.clearTimeout(previewTimer.current.timer);
    }
    previewTimer.current.source = source;
    previewTimer.current.timer = window.setTimeout(() => {
      setPreviewItemId(id);
      previewTimer.current.source = null;
      previewTimer.current.timer = null;
    }, 200);
  }, []);

  const cancelPreview = useCallback((source: PreviewSource) => {
    if (
      previewTimer.current.source === source &&
      previewTimer.current.timer !== null
    ) {
      window.clearTimeout(previewTimer.current.timer);
      previewTimer.current.source = null;
      previewTimer.current.timer = null;
    }
  }, []);
  const openItem = useCallback((id: string) => {
    setHeatmapScrollTop(scrollRef.current?.scrollTop ?? 0);
    openQuestionFromHeatmap(id);
  }, [openQuestionFromHeatmap, setHeatmapScrollTop]);

  if (!bank) return null;
  const previewGroup = groups.find((group) =>
    group.items.some((item) => item.id === previewItemId)
  ) ?? null;
  const previewItem =
    previewGroup?.items.find((item) => item.id === previewItemId) ?? null;
  const activeGroupId = groups.find((group) =>
    group.items.some((item) => item.id === heatmapFocusedId)
  )?.id;

  return (
    <main className={styles.screen} id="main-workspace">
      <header className={styles.header}>
        <div>
          <span>当前掌握状态</span>
          <h1>热力图</h1>
          <p>{bank.items.length} 道题，按章节与章内题序排列。</p>
        </div>
        <div className={styles.modeSwitch} role="group" aria-label="热力图显示模式">
          {([
            ["mastery", "掌握程度"],
            ["errorReason", "错误原因"],
            ["combined", "组合"]
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              className={heatmapMode === mode ? styles.activeMode : ""}
              aria-pressed={heatmapMode === mode}
              onClick={() => setHeatmapMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <HeatmapLegend bank={bank} mode={heatmapMode} />
      <div className={styles.content}>
        <ChapterIndex
          groups={groups}
          activeGroupId={activeGroupId}
          onLocate={(id) =>
            document.getElementById(id)?.scrollIntoView({
              block: "start",
              behavior: "smooth"
            })
          }
        />
        <div
          className={styles.gridPane}
          ref={scrollRef}
          role="region"
          aria-label="题目热力图滚动区域"
        >
          <HeatmapGrid
            bank={bank}
            groups={groups}
            mode={heatmapMode}
            focusedId={initialId}
            previewedId={previewItemId}
            onFocusedIdChange={setHeatmapFocusedId}
            onPreviewStart={schedulePreview}
            onPreviewEnd={cancelPreview}
            onOpenItem={openItem}
          />
        </div>
        <HeatmapPreview
          bank={bank}
          item={previewItem}
          group={previewGroup}
          module={previewModule}
          onModuleChange={setPreviewModule}
        />
      </div>
    </main>
  );
}

function ChapterIndex({
  groups,
  activeGroupId,
  onLocate
}: {
  groups: ReturnType<typeof buildHeatmapGroups>;
  activeGroupId?: string;
  onLocate: (id: string) => void;
}) {
  return (
    <nav className={styles.chapterIndex} aria-label="热力图章节索引">
      <strong>章节索引</strong>
      {groups.map((group) => (
        <button
          key={group.id}
          className={activeGroupId === group.id ? styles.activeChapter : ""}
          onClick={() => onLocate(group.id)}
        >
          <span>{group.numeral ? `${group.numeral}、` : ""}</span>
          <span>{group.name}</span>
          <small>{group.items.length}</small>
        </button>
      ))}
    </nav>
  );
}

function HeatmapLegend({
  bank,
  mode
}: {
  bank: NonNullable<ReturnType<typeof useQuestions>["bank"]>;
  mode: ReturnType<typeof useAppView>["heatmapMode"];
}) {
  const mastery = [
    { id: "unset-mastery", name: "未设置", color: "#858681", pattern: "dots" as const },
    ...bank.masteryOptions
  ];
  const errors = [
    { id: "unset-error", name: "未设置", color: "#858681", pattern: "dots" as const },
    ...bank.errorReasonOptions
  ];
  return (
    <section className={styles.legend} aria-label="热力图图例">
      {(mode === "mastery" || mode === "combined") && (
        <LegendGroup label="掌握程度" options={mastery} />
      )}
      {(mode === "errorReason" || mode === "combined") && (
        <LegendGroup label="错误原因" options={errors} compact={mode === "combined"} />
      )}
      <p>颜色同时配合图案、角标和文字说明。</p>
    </section>
  );
}

function LegendGroup({
  label,
  options,
  compact = false
}: {
  label: string;
  options: Array<{ id: string; name: string; color: string; pattern: string }>;
  compact?: boolean;
}) {
  return (
    <div className={styles.legendGroup}>
      <strong>{label}</strong>
      {options.map((option) => (
        <span key={option.id}>
          <i
            className={`${styles.legendSwatch} ${styles[`pattern-${option.pattern}`]}`}
            style={{ "--swatch-color": option.color } as React.CSSProperties}
            aria-hidden="true"
          />
          {compact ? `${option.name}` : option.name}
        </span>
      ))}
    </div>
  );
}
