import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import { BANK_SAVE_BODY_LIMIT_BYTES } from "../../shared/api-limits.js";
import {
  ApiRequestError,
  compileItem,
  fetchAppInfo,
  saveBank,
  saveBankAs
} from "../../src/api/client.js";

vi.mock("../../shared/api-limits.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../shared/api-limits.js")
  >();
  return {
    ...actual,
    BANK_SAVE_BODY_LIMIT_BYTES: 16 * 1024
  };
});

describe("bank save client limit", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects before fetch and can save after the content is reduced", async () => {
    const oversizedBase = createSampleBank();
    const oversizedBank = {
      ...oversizedBase,
      settings: {
        ...oversizedBase.settings,
        preamble: "x".repeat(32 * 1024)
      }
    };
    const request = {
      workspacePath: "/tmp/bank",
      baseRevision: "a".repeat(64),
      bank: oversizedBank
    };

    await expect(saveBank(request)).rejects.toMatchObject({
      status: 413,
      code: "BANK_PAYLOAD_TOO_LARGE",
      message: "题库超过 64 MiB，请拆分工作区或缩减内容。"
    });
    expect(fetch).not.toHaveBeenCalled();

    const reducedBank = createSampleBank();
    reducedBank.items = [];
    const reducedRequest = { ...request, bank: reducedBank };
    expect(BANK_SAVE_BODY_LIMIT_BYTES).toBe(16 * 1024);
    expect(
      new TextEncoder().encode(JSON.stringify(reducedRequest)).byteLength
    ).toBeLessThan(BANK_SAVE_BODY_LIMIT_BYTES);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      workspacePath: request.workspacePath,
      revision: "b".repeat(64),
      bank: reducedBank
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    await expect(saveBank(reducedRequest)).resolves.toMatchObject({
      revision: "b".repeat(64)
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("applies the same client limit to save-as", async () => {
    const oversizedBank = createSampleBank();
    oversizedBank.settings = { ...oversizedBank.settings, preamble: "x".repeat(32 * 1024) };

    await expect(
      saveBankAs({
        sourceWorkspacePath: "/tmp/source",
        targetWorkspacePath: "/tmp/target",
        bank: oversizedBank
      })
    ).rejects.toMatchObject({
      status: 413,
      code: "BANK_PAYLOAD_TOO_LARGE"
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("non-JSON responses", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("turns an HTML response into an ApiRequestError, not a JSON SyntaxError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<!doctype html><title>app</title>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      })
    );

    const error = await fetchAppInfo().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error).toMatchObject({ status: 200, code: "RESPONSE_NOT_JSON" });
  });

  it("throws infrastructure errors instead of treating them as compile results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: "已有 LaTeX 编译正在运行，请稍后重试。",
        code: "LATEX_BUSY"
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      })
    );
    const sample = createSampleBank();

    await expect(
      compileItem(sample.items[0], sample.settings, "/synthetic/A")
    ).rejects.toMatchObject({
      status: 503,
      code: "LATEX_BUSY"
    });
  });
});

describe("request deadlines", () => {
  it("times out both a stalled connection and a stalled JSON body", async () => {
    vi.useFakeTimers();
    try {
      for (const bodyStalls of [false, true]) {
        const response = new Response("{}", { headers: { "Content-Type": "application/json" } });
        vi.spyOn(response, "json").mockReturnValue(new Promise(() => undefined));
        vi.stubGlobal("fetch", vi.fn(() => bodyStalls ? Promise.resolve(response) : new Promise(() => undefined)));
        const result = fetchAppInfo().catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(await result).toMatchObject({ code: "REQUEST_TIMEOUT" });
        expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry or claim cancellation when a write exceeds its deadline", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
      const sample = createSampleBank();
      sample.items = [];
      const result = saveBank({ workspacePath: "/tmp/bank", baseRevision: "a".repeat(64), bank: sample })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await result).toMatchObject({ code: "WRITE_RESULT_UNKNOWN" });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
