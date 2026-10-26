import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  BoundedOutput,
  MAX_LATEX_LOG_BYTES
} from "../../server/bounded-output.js";
import { withLatexExecutionSlot } from "../../server/latex-execution.js";
import { compileLatex } from "../../server/latex-runtime.js";
import { StorageError } from "../../server/storage-types.js";

describe("LaTeX runtime limits", () => {
  it("rejects standalone compilation while a document owns the slot", async () => {
    await withLatexExecutionSlot(async () => {
      await expect(compileLatex("unused.tex", ".")).rejects.toMatchObject({ code: "LATEX_BUSY" });
    });
  });

  it("rejects expired or forged sessions before executing TeX", async () => {
    const expired = await withLatexExecutionSlot(async (session) => session);
    await expect(compileLatex("unused.tex", ".", 100, expired)).rejects.toThrow("expired");
    await withLatexExecutionSlot(async (session) => {
      await expect(compileLatex("unused.tex", ".", 100, { ...session })).rejects.toThrow("expired");
    });
  });

  it("retains a bounded head and tail with an explicit truncation marker", () => {
    const output = new BoundedOutput(1024, 128);
    output.append("latexmk command header\n");
    output.append(Buffer.alloc(8 * 1024, "x"));
    output.append("\n! Fatal Unicode error：最终错误\n");

    const value = output.toString();
    expect(Buffer.byteLength(value)).toBeLessThanOrEqual(1024);
    expect(value).toContain("latexmk command header");
    expect(value).toContain("LaTeX output truncated");
    expect(value).toContain("最终错误");
  });

  it("uses a one MiB default ceiling for compile logs", () => {
    const output = new BoundedOutput(MAX_LATEX_LOG_BYTES);
    output.append(Buffer.alloc(MAX_LATEX_LOG_BYTES * 4, "z"));
    expect(Buffer.byteLength(output.toString())).toBeLessThanOrEqual(
      MAX_LATEX_LOG_BYTES
    );
  });

  it("rejects concurrent compile work without building a waiting queue", async () => {
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withLatexExecutionSlot(async () => {
      await firstFinished;
      return "first";
    });

    await expect(
      withLatexExecutionSlot(async () => "second")
    ).rejects.toMatchObject({
      code: "LATEX_BUSY",
      status: 503
    } satisfies Partial<StorageError>);

    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(
      withLatexExecutionSlot(async () => "after-release")
    ).resolves.toBe("after-release");
  });
});
