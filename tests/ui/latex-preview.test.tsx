import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LatexPreview } from "../../src/components/LatexPreview.js";

beforeEach(() => {
  window.MathJax = {
    texReset: vi.fn(),
    typesetClear: vi.fn(),
    typesetPromise: vi.fn().mockResolvedValue(undefined)
  };
});

describe("LatexPreview MathJax lifecycle", () => {
  it("clears and resets the MathJax document before every typeset", async () => {
    const calls: string[] = [];
    vi.mocked(window.MathJax!.typesetClear!).mockImplementation(() => {
      calls.push("clear");
    });
    vi.mocked(window.MathJax!.texReset!).mockImplementation(() => {
      calls.push("reset");
    });
    vi.mocked(window.MathJax!.typesetPromise!).mockImplementation(async () => {
      calls.push("typeset");
    });
    const view = render(<LatexPreview tex="$x$" assets={[]} />);

    await waitFor(() => expect(calls).toEqual(["clear", "reset", "typeset"]));
    expect(view.getByText("$x$")).toBeInTheDocument();

    view.rerender(<LatexPreview tex="$y$" assets={[]} />);
    await waitFor(() => expect(calls).toEqual([
      "clear",
      "reset",
      "typeset",
      "clear",
      "reset",
      "typeset"
    ]));
    expect(view.getByText("$y$")).toBeInTheDocument();
  });

  it("serializes rapid updates and skips the superseded debounced version", async () => {
    const first = createDeferred<void>();
    let activeTypesets = 0;
    let maxActiveTypesets = 0;
    const rendered: string[] = [];
    vi.mocked(window.MathJax!.typesetPromise!).mockImplementation(async ([root] = []) => {
      activeTypesets += 1;
      maxActiveTypesets = Math.max(maxActiveTypesets, activeTypesets);
      rendered.push(root?.textContent ?? "");
      if (rendered.length === 1) await first.promise;
      activeTypesets -= 1;
    });
    const view = render(<LatexPreview tex="$a$" assets={[]} />);
    await waitFor(() => expect(rendered).toEqual(["$a$"]));

    view.rerender(<LatexPreview tex="$b$" assets={[]} />);
    view.rerender(<LatexPreview tex="$c$" assets={[]} />);
    await wait(160);
    expect(rendered).toEqual(["$a$"]);

    first.resolve();
    await waitFor(() => expect(rendered).toEqual(["$a$", "$c$"]));
    expect(rendered).toEqual(["$a$", "$c$"]);
    expect(maxActiveTypesets).toBe(1);
  });

  it("recovers the queue after a rejected typeset and clears on unmount", async () => {
    const typeset = vi.mocked(window.MathJax!.typesetPromise!);
    typeset
      .mockRejectedValueOnce(new Error("typeset failed"))
      .mockResolvedValueOnce(undefined);
    const view = render(<LatexPreview tex="$first$" assets={[]} />);
    await waitFor(() => expect(typeset).toHaveBeenCalledTimes(1));

    view.rerender(<LatexPreview tex="$second$" assets={[]} />);
    await waitFor(() => expect(typeset).toHaveBeenCalledTimes(2));
    const clearsBeforeUnmount = vi.mocked(window.MathJax!.typesetClear!).mock.calls.length;

    view.unmount();
    expect(window.MathJax!.typesetClear).toHaveBeenCalledTimes(
      clearsBeforeUnmount + 1
    );
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
