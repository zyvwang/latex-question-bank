import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

globalThis.window.MathJax = {
  typesetPromise: vi.fn().mockResolvedValue(undefined)
};

Object.defineProperty(globalThis, "crypto", {
  value: {
    ...globalThis.crypto,
    randomUUID: (() => {
      let sequence = 0;
      return () => `test-random-id-${sequence += 1}`;
    })()
  },
  configurable: true
});
