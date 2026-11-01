import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { questionSourceDisplay } from "../../shared/question-source.js";
import type { QuestionItem } from "../../shared/types.js";
import {
  useAppView,
  useBankSettings,
  useQuestions
} from "../context/questionBankContexts.js";
import {
  DISTRIBUTION_STATUSES,
  buildDistributionGroups,
  countByPriority,
  distributionStatus,
  distributionStatusLabel,
  percentOf,
  type DistributionCounts,
  type DistributionGroup
} from "../reviewDistribution.js";
import controls from "../styles/controls.module.css";
import styles from "./Distribution.module.css";

export function DistributionScreen() {
  const appView = useAppView();
  const { orderedItems } = useQuestions();
  const { chapters, books } = useBankSettings();
  const { distributionScrollTop, setDistributionScrollTop } = appView;
  const groups = useMemo(
    () => buildDistributionGroups(orderedItems, chapters),
    [chapters, orderedItems]
  );
  const counts = useMemo(() => countByPriority(orderedItems), [orderedItems]);
  const mustItems = useMemo(
    () => orderedItems.filter((item) => item.reviewPriority === "must"),
    [orderedItems]
  );
  const scrollRef = useRef<HTMLElement | null>(null);
  const restoreTop = useRef(distributionScrollTop);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = restoreTop.current;
  }, []);
  useEffect(() => {
    const scroller = scrollRef.current;
    return () => setDistributionScrollTop(scroller?.scrollTop ?? 0);
  }, [setDistributionScrollTop]);

  if (orderedItems.length === 0) {
    return (
      <section className={styles.empty} id="main-workspace" aria-label="复习分布">
        <h1>题库还没有题目</h1>
        <p>添加或导入题目后，这里会显示各复习优先级的数量和分布。</p>
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

  const total = orderedItems.length;
  const marked = total - counts.unset;
  const groupByChapterId = (item: QuestionItem) =>
    groups.find((group) => group.items.includes(item))?.name ?? "";

  return (
    <section ref={scrollRef} className={styles.screen} id="main-workspace" aria-label="复习分布">
      <div className={styles.inner}>
        <header className={styles.head}>
          <h1>复习分布</h1>
          <p>共 {total} 题，已标记 {marked} 题（{percentOf(marked, total)}%）</p>
        </header>
        <section className={styles.overall} aria-label="总体分布">
          <Bar counts={counts} label={summaryLabel(counts, total)} big />
          <div className={styles.stats}>
            {DISTRIBUTION_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className={styles.stat}
                aria-label={`${distributionStatusLabel(status)} ${counts[status]} 题，在题库中查看`}
                disabled={counts[status] === 0}
                onClick={() => appView.showDistributionStatusInEditor(status)}
              >
                <span className={styles.statName}>
                  <i className={styles.mark} data-status={status} aria-hidden="true" />
                  {distributionStatusLabel(status)}
                </span>
                <strong>{counts[status]}</strong>
                <small>{percentOf(counts[status], total)}%</small>
              </button>
            ))}
          </div>
        </section>
        <div className={styles.lower}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>各章复习分布</caption>
            <thead>
              <tr>
                <th scope="col">章节</th>
                <th scope="col">分布</th>
                {DISTRIBUTION_STATUSES.map((status) => (
                  <th scope="col" className={styles.num} key={status}>{distributionStatusLabel(status)}</th>
                ))}
                <th scope="col" className={styles.num}>已标记</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => <ChapterRows key={group.id} group={group} books={books} />)}
            </tbody>
          </table>
          <aside className={styles.mustList} aria-label="必须看清单">
            <h2><span>必须看</span><span>{mustItems.length} 题</span></h2>
            {mustItems.length ? (
              <ul>
                {mustItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => appView.openQuestionFromDistribution(item.id)}>
                      <strong>{questionSourceDisplay(item, books)}</strong>
                      <small>{item.topics[0] ?? groupByChapterId(item)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p>还没有标记为必须看的题。</p>}
          </aside>
        </div>
      </div>
    </section>
  );
}

function ChapterRows({
  group,
  books
}: {
  group: DistributionGroup;
  books: ReturnType<typeof useBankSettings>["books"];
}) {
  const appView = useAppView();
  const open = appView.distributionExpanded.includes(group.id);
  const done = group.items.length - group.counts.unset;
  const detailId = `distribution-detail-${group.id}`;
  return (
    <Fragment>
      <tr>
        <th scope="row">
          <button
            type="button"
            className={styles.chapter}
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => appView.toggleDistributionChapter(group.id)}
          >
            <ChevronRight size={14} aria-hidden="true" />
            {group.name}
          </button>
        </th>
        <td><Bar counts={group.counts} /></td>
        {DISTRIBUTION_STATUSES.map((status) => (
          <td className={`${styles.num} ${group.counts[status] ? "" : styles.zero}`} key={status}>
            {group.counts[status]}
          </td>
        ))}
        <td className={styles.num}>{percentOf(done, group.items.length)}%</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className={styles.detailCell} id={detailId}>
            <div className={styles.detail}>
              {group.items.map((item) => {
                const status = distributionStatus(item.reviewPriority);
                const source = questionSourceDisplay(item, books);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.cell}
                    data-status={status}
                    aria-label={`${source}，${distributionStatusLabel(status)}`}
                    title={source}
                    onClick={() => appView.openQuestionFromDistribution(item.id)}
                  >
                    {item.chapterOrder}
                  </button>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Bar({ counts, label, big = false }: { counts: DistributionCounts; label?: string; big?: boolean }) {
  return (
    <div
      className={`${styles.bar} ${big ? styles.barBig : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {DISTRIBUTION_STATUSES.filter((status) => counts[status] > 0).map((status) => (
        <i key={status} data-status={status} style={{ flexGrow: counts[status] }} />
      ))}
    </div>
  );
}

function summaryLabel(counts: DistributionCounts, total: number): string {
  return DISTRIBUTION_STATUSES.map(
    (status) => `${distributionStatusLabel(status)} ${counts[status]} 题，占 ${percentOf(counts[status], total)}%`
  ).join("；");
}
