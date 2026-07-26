export interface WheelScrollState {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  deltaX: number;
  deltaY: number;
}

export function nextWheelScrollState(state: WheelScrollState) {
  const maxTop = Math.max(0, state.scrollHeight - state.clientHeight);
  const maxLeft = Math.max(0, state.scrollWidth - state.clientWidth);
  const scrollTop = clamp(state.scrollTop + state.deltaY, 0, maxTop);
  const scrollLeft = clamp(state.scrollLeft + state.deltaX, 0, maxLeft);
  return {
    scrollTop,
    scrollLeft,
    changed: scrollTop !== state.scrollTop || scrollLeft !== state.scrollLeft
  };
}

export function wheelDeltaToPixels(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  clientWidth: number,
  clientHeight: number
) {
  if (deltaMode === 1) {
    return { deltaX: deltaX * 18, deltaY: deltaY * 18 };
  }
  if (deltaMode === 2) {
    return { deltaX: deltaX * clientWidth, deltaY: deltaY * clientHeight };
  }
  return { deltaX, deltaY };
}

export function normalizeWheelAxes(
  deltaX: number,
  deltaY: number,
  shiftKey: boolean
) {
  if (shiftKey && deltaX === 0) {
    return { deltaX: deltaY, deltaY: 0 };
  }
  return { deltaX, deltaY };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
