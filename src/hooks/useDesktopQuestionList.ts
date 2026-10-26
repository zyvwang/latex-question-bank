import { useSyncExternalStore } from "react";

const desktopQuery = "(min-width: 761px)";
function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia?.(desktopQuery);
  query?.addEventListener("change", callback);
  return () => query?.removeEventListener("change", callback);
}
export function useDesktopQuestionList() {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia?.(desktopQuery).matches ?? false, () => false);
}

