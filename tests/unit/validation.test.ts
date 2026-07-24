import { describe, expect, it } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import {
  isRecord,
  validateBankPayload,
  validateCompileItemRequest,
  validateExportRequest,
  validateRecoverBankRequest,
  validateSaveBankRequest,
  validateTexPathRequest,
  validateWorkspaceMoveRequest,
  validateWorkspacePathRequest
} from "../../shared/validation.js";

describe("shared validation", () => {
  it("validates request envelope variants", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);

    expect(validateWorkspacePathRequest(null).ok).toBe(false);
    expect(validateWorkspacePathRequest({ workspacePath: 3 }).ok).toBe(false);
    expect(validateWorkspacePathRequest({ workspacePath: " " }).ok).toBe(false);
    expect(validateWorkspacePathRequest({ workspacePath: " /tmp/bank " }).value?.workspacePath).toBe(
      "/tmp/bank"
    );

    expect(validateWorkspaceMoveRequest({}).ok).toBe(false);
    expect(validateWorkspaceMoveRequest({ workspacePath: "/tmp", direction: "left" }).ok).toBe(false);
    expect(validateWorkspaceMoveRequest({ workspacePath: "/tmp", direction: "up" }).ok).toBe(true);
    expect(validateWorkspaceMoveRequest({ workspacePath: "/tmp", direction: "down" }).ok).toBe(true);

    expect(validateTexPathRequest(null).ok).toBe(false);
    expect(validateTexPathRequest({ texPath: 3 }).ok).toBe(false);
    expect(validateTexPathRequest({ texPath: " " }).value?.texPath).toBeUndefined();
    expect(validateTexPathRequest({ texPath: " /bin/latexmk " }).value?.texPath).toBe("/bin/latexmk");

    expect(validateRecoverBankRequest(null).ok).toBe(false);
    expect(validateRecoverBankRequest({ candidateId: 3 }).ok).toBe(false);
    expect(validateRecoverBankRequest({ candidateId: " " }).ok).toBe(false);
    expect(validateRecoverBankRequest({ candidateId: "bank.json.bak" }).ok).toBe(true);

    expect(validateExportRequest(null).ok).toBe(false);
    expect(validateExportRequest({ itemIds: [3], fileName: "x" }).ok).toBe(false);
    expect(validateExportRequest({ itemIds: [], fileName: 3 }).ok).toBe(false);
    expect(validateExportRequest({ itemIds: [], fileName: "x", orderMode: "sideways" }).ok).toBe(false);
    expect(validateExportRequest({ itemIds: [], fileName: "x", randomSeed: 3 }).ok).toBe(false);
    expect(validateExportRequest({ itemIds: [], fileName: "x", orderMode: "normal" }).ok).toBe(true);
    expect(
      validateExportRequest({ itemIds: [], fileName: "x", orderMode: "random", randomSeed: " seed " })
        .value?.randomSeed
    ).toBe("seed");
  });

  it("rejects structurally unsafe banks and unsupported layouts", () => {
    const bank = createSampleBank();
    const item = bank.items[0];
    const validSave = validateSaveBankRequest({
      workspacePath: "/tmp/bank",
      baseRevision: "a".repeat(64),
      bank
    });
    expect(validSave.ok).toBe(true);
    expect(validateSaveBankRequest(null).ok).toBe(false);
    expect(validateSaveBankRequest({ workspacePath: " ", baseRevision: "", bank }).ok).toBe(false);
    expect(validateSaveBankRequest({ workspacePath: "/tmp", baseRevision: 1, bank }).ok).toBe(false);
    expect(validateSaveBankRequest({ workspacePath: "/tmp", baseRevision: "", bank: {} }).ok).toBe(false);

    const invalidBanks: unknown[] = [
      null,
      { ...bank, version: 3 },
      { ...bank, items: "not-array" },
      { ...bank, settings: null },
      { ...bank, settings: { ...bank.settings, pageSize: "letter" } },
      { ...bank, items: [null] },
      { ...bank, items: [{ ...item, sourceNumber: 5 }] },
      { ...bank, items: [{ ...item, id: 5 }] },
      { ...bank, items: [{ ...item, id: "" }] },
      { ...bank, items: [{ ...item, order: Number.NaN }] },
      { ...bank, items: [{ ...item, chapter: 5 }] },
      { ...bank, items: [{ ...item, tags: [5] }] },
      { ...bank, items: [{ ...item, star: 0 }] },
      { ...bank, items: [{ ...item, star: 6 }] },
      { ...bank, items: [{ ...item, star: 2.5 }] },
      { ...bank, items: [{ ...item, modules: undefined }] },
      { ...bank, items: [{ ...item, modules: { ...item.modules, note: null } }] },
      {
        ...bank,
        items: [{ ...item, modules: { ...item.modules, explanation: { tex: "extra" } } }]
      },
      { ...bank, items: [{ ...item, assets: "not-array" }] },
      { ...bank, items: [{ ...item, assets: [null] }] },
      {
        ...bank,
        items: [
          {
            ...item,
            assets: [
              {
                id: "a",
                fileName: "../escape.png",
                originalName: "escape.png",
                relativePath: "assets/escape.png",
                mimeType: "image/png",
                size: 1,
                uploadedAt: item.createdAt
              }
            ]
          }
        ]
      },
      {
        ...bank,
        items: [
          {
            ...item,
            assets: [
              {
                id: "a",
                fileName: "safe.png",
                originalName: "safe.png",
                relativePath: "../safe.png",
                mimeType: "image/png",
                size: 1,
                uploadedAt: item.createdAt
              }
            ]
          }
        ]
      },
      {
        ...bank,
        items: [
          {
            ...item,
            assets: [
              {
                id: "a",
                fileName: "..",
                originalName: "..",
                relativePath: "assets/..",
                mimeType: "image/png",
                size: 1,
                uploadedAt: item.createdAt
              }
            ]
          }
        ]
      },
      { ...bank, items: [item, { ...item }] }
    ];
    invalidBanks.forEach((value) => expect(validateBankPayload(value).ok).toBe(false));

    expect(
      validateBankPayload({
        version: 1,
        settings: bank.settings,
        items: [{ ...item, modules: undefined }]
      }).ok
    ).toBe(false);
  });

  it("validates compile requests independently", () => {
    const bank = createSampleBank();
    expect(validateCompileItemRequest(null).ok).toBe(false);
    expect(validateCompileItemRequest({ item: {}, settings: {} }).ok).toBe(false);
    expect(validateCompileItemRequest({ item: bank.items[0], settings: bank.settings }).ok).toBe(true);
  });
});
