import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./PaneResizeHandle.module.css";

export function PaneResizeHandle({
  value,
  min,
  max,
  step,
  direction = 1,
  pixelsPerUnit = 1,
  label,
  controls,
  valueText,
  onPreview,
  onCommit
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  direction?: 1 | -1;
  pixelsPerUnit?: number | (() => number);
  label: string;
  controls: string;
  valueText: (value: number) => string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    lastValue: number;
  } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: value,
      lastValue: value
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const unitSize = typeof pixelsPerUnit === "function"
      ? pixelsPerUnit()
      : pixelsPerUnit;
    const next = clamp(
      drag.startValue + direction * (event.clientX - drag.startX) / Math.max(unitSize, 0.01),
      min,
      max
    );
    drag.lastValue = next;
    onPreview(next);
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit(Math.round(drag.lastValue));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const horizontalDelta =
      event.key === "ArrowRight" ? step * direction
        : event.key === "ArrowLeft" ? -step * direction
          : null;
    const next = event.key === "Home" ? min
      : event.key === "End" ? max
        : horizontalDelta === null ? null : clamp(value + horizontalDelta, min, max);
    if (next === null) return;
    event.preventDefault();
    onPreview(next);
    onCommit(Math.round(next));
  }

  return (
    <div
      className={styles.handle}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText(value)}
      tabIndex={0}
      title={`${label}，可拖拽或使用方向键调整`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={handleKeyDown}
    />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
