import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

/**
 * 把键盘焦点关在 `aria-modal="true"` 的对话框里。遮罩只挡指针:没有这个 hook,
 * Tab 能穿到背后的 CodeMirror 继续打字 —— 容量对话框那条路径下,这期间的编辑
 * 会在确认时被丢掉(见 useReviewHistory 的 restoreHistory)。
 *
 * 初始焦点由这个 hook 统一接管,对话框不要再用 autoFocus:autoFocus 在 commit
 * 阶段就生效,等到这里的 effect 读 document.activeElement 时,记下的「打开对话框
 * 之前的焦点」已经是对话框内部的元素了,关闭时也就还不回去。需要指定落点的用
 * `data-autofocus` 标记,否则落在第一个可聚焦元素上。
 */
export function useFocusTrap<T extends HTMLElement>() {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    initialTarget(container)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !container) return;
      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        // 对话框里没有可聚焦元素时也不能放焦点出去。
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // 触发元素可能随对话框一起消失(右键菜单里的入口就是),那时不还焦点。
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return containerRef;
}

function initialTarget(container: HTMLElement): HTMLElement | null {
  return (
    container.querySelector<HTMLElement>("[data-autofocus]") ??
    focusableWithin(container)[0] ??
    null
  );
}

// 不按可见性过滤:两个对话框里的控件全是可见的,而 jsdom 里 offsetParent 恒为
// null,加了过滤反而会让这个 hook 在 UI 测试里筛空。
function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}
