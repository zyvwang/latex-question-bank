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
  useBankSettings,
  useQuestions
} from "../context/questionBankContexts.js";
import {
  buildDistributionGroups,
  countByPriority,
  distributionCellId,
  isDistributionNavigationKey,
  nextDistributionItemId
} from "../reviewDistribution.js";
import controls from "../styles/controls.module.css";
import { DistributionGrid } from "./DistributionGrid.js";
import { DistributionPreview } from "./DistributionPreview.js";
import { DistributionSummary } from "./DistributionSummary.js";
import styles from "./Distribution.module.css";

type PreviewSource = "focus" | "hover";

// 快速划过格子时不反复排版 MathJax，只有停留下来才切换预览。
const PREVIEW_DELAY_MS = 200;

export function DistributionScreen() {
  const appView = useAppView();
  const { orderedItems, bank } = useQuestions();
  const { chapters, books } = useBankSettings();
  const {
    distributionFocusedId: focusedId,
    distributionHighlight: highlight,
    distributionScrollTop,
    openQuestionFromDistribution,
    setDistributionFocusedId,
    setDistributionHighlight,
    setDistributionScrollTop,
    showDistributionStatusInEditor
  } = appView;

  const groups = useMemo(
    () => buildDistributionGroups(orderedItems, chapters),
    [chapters, orderedItems]
  );
  const counts = useMemo(() => countByPriority(orderedItems), [orderedItems]);
  const firstId = orderedItems[0]?.id ?? null;
  const currentId =
    focusedId && orderedItems.some((item) => item.id === focusedId)
      ? focusedId
      : firstId;

  const [previewId, setPreviewId] = useState<string | null>(currentId);
  const previewItem =
    orderedItems.find((item) => item.id === previewId) ??
    orderedItems.find((item) => item.id === currentId) ??
    null;
  const previewGroup = previewItem
    ? groups.find((group) => group.items.some((item) => item.id === previewItem.id)) ?? null
    : null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previewTimer = useRef<{ source: PreviewSource | null; timer: number | null }>({
    source: null,
    timer: null
  });
  const restore = useRef({ scrollTop: distributionScrollTop, focusId: focusedId });

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = restore.current.scrollTop;
    if (!restore.current.focusId) return;
    document
      .getElementById(distributionCellId(restore.current.focusId))
      ?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const pending = previewTimer.current;
    const scroller = scrollRef.current;
    return () => {
      if (pending.timer !== null) window.clearTimeout(pending.timer);
      setDistributionScrollTop(scroller?.scrollTop ?? 0);
    };
  }, [setDistributionScrollTop]);

  const schedulePreview = useCallback((id: string, source: PreviewSource) => {
    const pending = previewTimer.current;
    if (pending.timer !== null) window.clearTimeout(pending.timer);
    pending.source = source;
    pending.timer = window.setTimeout(() => {
      setPreviewId(id);
      pending.source = null;
      pending.timer = null;
    }, PREVIEW_DELAY_MS);
  }, []);

  const cancelPreview = useCallback((source: PreviewSource) => {
    const pending = previewTimer.current;
    if (pending.source !== source || pending.timer === null) return;
    window.clearTimeout(pending.timer);
    pending.source = null;
    pending.timer = null;
  }, []);

  const handleNavigate = useCallback(
    (id: string, key: string) => {
      if (!isDistributionNavigationKey(key)) return false;
      const nextId = nextDistributionItemId(groups, id, key);
      setDistributionFocusedId(nextId);
      document.getElementById(distributionCellId(nextId))?.focus();
      return true;
    },
    [groups, setDistributionFocusedId]
  );

  if (!bank) return null;
  if (orderedItems.length === 0) {
    return (
      <section className={styles.empty} id="main-workspace" aria-label="复习分布">
        <h1>题库还没有题目</h1>
        <p>添加或导入题目后，这里会显示必须看、再看看、不用看和未标记的分布。</p>
        <button
          type="button"
          className={controls.primaryAction}
          onClick={() => appView.setActiveView("editor")}
        >
          返回编辑
        </button>
      </section>
    );
  }

  return (
    <section className={styles.screen} id="main-workspace" aria-label="复习分布">
      <DistributionSummary
        counts={counts}
        total={orderedItems.length}
        highlight={highlight}
        onHighlightChange={setDistributionHighlight}
        onShowInEditor={showDistributionStatusInEditor}
      />
      <div className={styles.content}>
        <div
          className={styles.gridPane}
          ref={scrollRef}
          role="region"
          aria-label="各章题目分布"
        >
          <DistributionGrid
            groups={groups}
            books={books}
            highlight={highlight}
            focusedId={currentId}
            previewedId={previewItem?.id ?? null}
            onFocusedIdChange={setDistributionFocusedId}
            onPreviewStart={schedulePreview}
            onPreviewEnd={cancelPreview}
            onOpenItem={openQuestionFromDistribution}
            onNavigate={handleNavigate}
          />
        </div>
        <DistributionPreview
          item={previewItem}
          group={previewGroup}
          books={books}
          onOpenItem={openQuestionFromDistribution}
        />
      </div>
    </section>
  );
}
