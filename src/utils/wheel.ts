import {
  nextWheelScrollState,
  normalizeWheelAxes,
  wheelDeltaToPixels
} from "../wheelScroll.js";

export function bindWheelScroller(root: HTMLElement, getTarget: () => HTMLElement | null) {
  const handleWheel = (event: WheelEvent) => scrollElementFromWheelEvent(root, event, getTarget());
  root.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  return () => root.removeEventListener("wheel", handleWheel, { capture: true });
}

function scrollElementFromWheelEvent(root: HTMLElement, event: WheelEvent, target: HTMLElement | null) {
  if (!target || event.ctrlKey) return;

  const normalized = normalizeWheelAxes(
    event.deltaX,
    event.deltaY,
    event.shiftKey
  );
  const { deltaX, deltaY } = wheelDeltaToPixels(
    normalized.deltaX,
    normalized.deltaY,
    event.deltaMode,
    root.clientWidth,
    root.clientHeight
  );
  const next = nextWheelScrollState({
    scrollTop: target.scrollTop,
    scrollLeft: target.scrollLeft,
    scrollHeight: target.scrollHeight,
    scrollWidth: target.scrollWidth,
    clientHeight: target.clientHeight,
    clientWidth: target.clientWidth,
    deltaX,
    deltaY
  });

  if (!next.changed) return;
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
  target.scrollTop = next.scrollTop;
  target.scrollLeft = next.scrollLeft;
}
