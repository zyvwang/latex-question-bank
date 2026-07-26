import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import { BANK_SAVE_BODY_LIMIT_BYTES } from "../../shared/api-limits.js";
import {
  ApiRequestError,
  fetchAppInfo,
  saveBank
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
});
