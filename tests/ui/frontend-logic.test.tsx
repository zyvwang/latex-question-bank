import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import {
  bestTextColor,
  contrastRatio,
  hasLowSurfaceContrast
} from "../../src/color-contrast.js";
import {
  moveItemToPositionInList,
  reorderItemByDrop,
  withOrder
} from "../../src/itemOrder.js";
import { validateReorderTarget } from "../../src/questionReorder.js";
import {
  nextWheelScrollState,
  normalizeWheelAxes,
  wheelDeltaToPixels
} from "../../src/wheelScroll.js";
import { appendTex } from "../../src/utils/form.js";
import { splitLatexImages } from "../../src/utils/preview.js";
import { bindWheelScroller } from "../../src/utils/wheel.js";

describe("frontend logic boundaries", () => {
  it("calculates color contrast and safe text choices", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21);
    expect(bestTextColor("#000000")).toBe("#FFFFFF");
    expect(bestTextColor("#FFFFFF")).toBe("#1F2926");
    expect(hasLowSurfaceContrast("#FCFBF8")).toBe(true);
    expect(hasLowSurfaceContrast("#000000")).toBe(false);
  });

  it("reorders chapter-local items and validates direct targets", () => {
    const items = createSampleBank().items;
    expect(withOrder(items[0], 2, "now")).toMatchObject({
      chapterOrder: 3,
      updatedAt: "now"
    });
    expect(moveItemToPositionInList(items, items[0].id, 1, "now"))
      .toHaveLength(2);
    expect(reorderItemByDrop(
      items,
      items[0].id,
      items[1].id,
      "after",
      "now"
    )).toHaveLength(2);
    expect(validateReorderTarget("x", 2)).toContain("整数");
    expect(validateReorderTarget("0", 2)).toContain("1 到 2");
    expect(validateReorderTarget("2", 2)).toBeNull();
  });

  it("normalizes wheel units, axes, and scroll bounds", () => {
    expect(wheelDeltaToPixels(1, 2, 1, 100, 200)).toEqual({
      deltaX: 18,
      deltaY: 36
    });
    expect(wheelDeltaToPixels(1, 2, 2, 100, 200)).toEqual({
      deltaX: 100,
      deltaY: 400
    });
    expect(wheelDeltaToPixels(1, 2, 0, 100, 200)).toEqual({
      deltaX: 1,
      deltaY: 2
    });
    expect(normalizeWheelAxes(0, 20, true)).toEqual({
      deltaX: 20,
      deltaY: 0
    });
    expect(normalizeWheelAxes(5, 20, true)).toEqual({
      deltaX: 5,
      deltaY: 20
    });
    expect(nextWheelScrollState({
      scrollTop: 90,
      scrollLeft: 0,
      scrollHeight: 100,
      scrollWidth: 100,
      clientHeight: 20,
      clientWidth: 100,
      deltaX: -20,
      deltaY: 20
    })).toEqual({
      scrollTop: 80,
      scrollLeft: 0,
      changed: true
    });
  });

  it("binds and removes a wheel scroller across ignored and changed events", () => {
    const root = document.createElement("div");
    const target = document.createElement("div");
    Object.defineProperties(root, {
      clientWidth: { value: 100 },
      clientHeight: { value: 100 }
    });
    Object.defineProperties(target, {
      scrollHeight: { value: 500 },
      scrollWidth: { value: 500 },
      clientHeight: { value: 100 },
      clientWidth: { value: 100 }
    });
    let currentTarget: HTMLElement | null = null;
    const cleanup = bindWheelScroller(root, () => currentTarget);

    root.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 20
    }));
    currentTarget = target;
    root.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: 20
    }));
    const changed = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      deltaY: 20
    });
    root.dispatchEvent(changed);
    expect(changed.defaultPrevented).toBe(true);
    expect(target.scrollLeft).toBe(20);

    cleanup();
    root.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 20
    }));
    expect(target.scrollTop).toBe(0);
  });

  it("appends TeX and resolves known and missing image assets", () => {
    const asset = {
      id: "asset",
      fileName: "safe.png",
      originalName: "figure.png",
      relativePath: "assets/safe.png",
      mimeType: "image/png",
      size: 1,
      uploadedAt: "2026-01-01T00:00:00.000Z"
    };
    expect(appendTex("first ", "second")).toBe("first\n\nsecond");
    expect(splitLatexImages(
      "before\\includegraphics{assets/safe.png}after\\includegraphics{assets/missing.png}",
      [asset]
    )).toEqual([
      { type: "text", text: "before" },
      { type: "image", src: "/assets/safe.png", alt: "figure.png" },
      { type: "text", text: "after" },
      {
        type: "image",
        src: "/assets/missing.png",
        alt: "assets/missing.png"
      }
    ]);
  });
});
