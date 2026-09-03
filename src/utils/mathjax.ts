import { ensureMathJax } from "./preview.js";

let typesetQueue: Promise<void> = Promise.resolve();
const requestVersionByRoot = new WeakMap<HTMLElement, number>();

export function scheduleMathJaxTypeset(
  root: HTMLElement,
  renderContent: () => void,
  delayMs: number
): () => void {
  const requestVersion = nextRequestVersion(root);
  let cancelled = false;
  let timer: number | null = window.setTimeout(() => {
    timer = null;
    const operation = typesetQueue
      .catch(() => undefined)
      .then(async () => {
        await ensureMathJax();
        if (
          cancelled ||
          !root.isConnected ||
          requestVersionByRoot.get(root) !== requestVersion
        ) {
          return;
        }

        const mathJax = window.MathJax;
        if (!mathJax?.typesetPromise) return;
        mathJax.typesetClear?.([root]);
        renderContent();
        mathJax.texReset?.();
        await mathJax.typesetPromise([root]);
      });
    // 一次排版失败不能让全局队列永久停在 rejected 状态。
    typesetQueue = operation.catch(() => undefined);
  }, delayMs);

  return () => {
    cancelled = true;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (requestVersionByRoot.get(root) === requestVersion) {
      nextRequestVersion(root);
    }
  };
}

export function disposeMathJaxRoot(root: HTMLElement): void {
  nextRequestVersion(root);
  window.MathJax?.typesetClear?.([root]);
}

function nextRequestVersion(root: HTMLElement): number {
  const next = (requestVersionByRoot.get(root) ?? 0) + 1;
  requestVersionByRoot.set(root, next);
  return next;
}
