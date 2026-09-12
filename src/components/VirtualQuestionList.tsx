import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { QuestionItem } from "../../shared/types.js";
import styles from "./Sidebar.module.css";

export interface QuestionGroup {
  chapterId: string | null;
  items: QuestionItem[];
}

type Entry = { key: string; item?: QuestionItem; group: number };

export function VirtualQuestionList({ groups, chapterById, activeId, draggingId, renderRow }: {
  groups: QuestionGroup[];
  chapterById: Map<string, string>;
  activeId: string | null;
  draggingId: string | null;
  renderRow: (item: QuestionItem) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const previousActiveId = useRef<string | null>(null);
  const pendingFocus = useRef<{ id: string; control: number } | null>(null);
  const { entries, headers, indexById } = useMemo(() => {
    const entries: Entry[] = [];
    const headers: number[] = [];
    const indexById = new Map<string, number>();
    groups.forEach((group, groupIndex) => {
      headers.push(entries.length);
      entries.push({ key: `chapter:${group.chapterId ?? "uncategorized"}`, group: groupIndex });
      for (const item of group.items) {
        indexById.set(item.id, entries.length);
        entries.push({ key: `question:${item.id}`, item, group: groupIndex });
      }
    });
    return { entries, headers, indexById };
  }, [groups]);
  const getItemKey = useCallback((index: number) => entries[index].key, [entries]);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    getItemKey,
    estimateSize: (index) => entries[index].item ? 98 : 42,
    overscan: 5,
    rangeExtractor: useCallback((range: Range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      // Keep the actual focused control mounted even when the user scrolls elsewhere.
      for (const id of [focusedId, draggingId]) {
        const index = id ? indexById.get(id) : undefined;
        if (index === undefined) continue;
        for (let offset = -2; offset <= 2; offset++) {
          if (index + offset >= 0 && index + offset < entries.length) indexes.add(index + offset);
        }
      }
      return [...indexes].sort((a, b) => a - b);
    }, [focusedId, draggingId, indexById, entries.length])
  });
  const virtualItems = virtualizer.getVirtualItems();
  const measurements = virtualizer.measurementsCache;
  const visibleByGroup = new Map<number, ReturnType<typeof virtualizer.getVirtualItems>>();
  for (const row of virtualItems) {
    const entry = entries[row.index];
    if (!entry.item) continue;
    const rows = visibleByGroup.get(entry.group) ?? [];
    rows.push(row);
    visibleByGroup.set(entry.group, rows);
  }

  useEffect(() => {
    if (previousActiveId.current === activeId) return;
    previousActiveId.current = activeId;
    const index = activeId ? indexById.get(activeId) : undefined;
    if (index !== undefined) virtualizer.scrollToIndex(index, { align: "auto" });
    // Filtering should not jump back to an unchanged active question.
  }, [activeId, indexById, virtualizer]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const row = document.getElementById(`question-nav-${target.id}`)?.closest("[data-question-id]");
    const control = row?.querySelectorAll<HTMLElement>("input, button")[target.control];
    if (control) {
      pendingFocus.current = null;
      control.focus({ preventScroll: true });
    }
  });

  return (
    <div ref={parentRef} className={`${styles.questionList} ${styles.virtualQuestionList}`}
      aria-label="题目列表" data-question-count={indexById.size}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
      }}
      onFocusCapture={(event) => {
        const row = event.target.closest<HTMLElement>("[data-question-id]");
        if (!row) return;
        setFocusedId(row.dataset.questionId ?? null);
        if (!event.target.matches(":focus-visible")) return;
        const list = event.currentTarget;
        const heading = row.closest("section")?.querySelector("h3");
        const bounds = row.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        const headingHeight = heading?.getBoundingClientRect().height ?? 0;
        if (bounds.top < listBounds.top + headingHeight + 4) {
          list.scrollTop += bounds.top - listBounds.top - headingHeight - 4;
        } else if (bounds.bottom > listBounds.bottom) {
          list.scrollTop += bounds.bottom - listBounds.bottom;
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-question-id]");
        const index = row?.dataset.questionId ? indexById.get(row.dataset.questionId) : undefined;
        if (!row || index === undefined) return;
        const controls = [...row.querySelectorAll<HTMLElement>("input, button")];
        const controlIndex = controls.indexOf(event.target as HTMLElement);
        if ((!event.shiftKey && controlIndex !== controls.length - 1) || (event.shiftKey && controlIndex !== 0)) return;
        const direction = event.shiftKey ? -1 : 1;
        let next = index + direction;
        while (next >= 0 && next < entries.length && !entries[next].item) next += direction;
        const item = entries[next]?.item;
        if (!item) return;
        event.preventDefault();
        pendingFocus.current = { id: item.id, control: event.shiftKey ? 1 : 0 };
        setFocusedId(item.id);
        virtualizer.scrollToIndex(next, { align: "auto" });
      }}>
      <div className={styles.virtualCanvas} style={{ height: virtualizer.getTotalSize() }}>
        {groups.map((group, groupIndex) => {
          const headerIndex = headers[groupIndex];
          const start = measurements[headerIndex]?.start ?? 0;
          const end = measurements[headers[groupIndex + 1]]?.start ?? virtualizer.getTotalSize();
          return (
            <section key={entries[headerIndex].key} className={styles.virtualChapter}
              style={{ top: start, height: end - start }}>
              <h3 className={styles.chapterHeading} data-index={headerIndex} ref={virtualizer.measureElement}>
                {group.chapterId ? chapterById.get(group.chapterId) ?? "未分类" : "未分类"}
              </h3>
              {(visibleByGroup.get(groupIndex) ?? []).map((row) => (
                <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
                  className={styles.virtualRow} style={{ top: row.start - start }}>
                  {renderRow(entries[row.index].item!)}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
