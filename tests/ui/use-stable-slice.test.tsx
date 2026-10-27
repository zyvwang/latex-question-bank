import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStableSlice } from "../../src/hooks/useStableSlice.js";

interface Slice {
  count: number;
  items: string[];
  read: () => number;
}

describe("useStableSlice", () => {
  it("keeps identity until a data field changes and always calls the latest function", () => {
    const items = ["a"];
    const { result, rerender } = renderHook(
      ({ count, list }: { count: number; list: string[] }) =>
        useStableSlice<Slice>({ count, items: list, read: () => count * 10 }),
      { initialProps: { count: 1, list: items } }
    );
    const first = result.current;
    const read = first.read;

    rerender({ count: 1, list: items });
    expect(result.current).toBe(first);

    rerender({ count: 2, list: items });
    expect(result.current).not.toBe(first);
    expect(result.current.count).toBe(2);
    expect(result.current.read).toBe(read);
    expect(read()).toBe(20);

    rerender({ count: 2, list: ["a"] });
    expect(result.current.items).toEqual(["a"]);
    expect(result.current.read).toBe(read);
  });
});
