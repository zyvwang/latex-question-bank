import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appDataDir } from "../../server/app-state.js";
import {
  createEmptyWorkspace,
  isKnownWorkspacePath
} from "../../server/workspace-storage.js";
import {
  classifyExternalUrl,
  classifySender,
  createSecureWebPreferences,
  isCloseResponse,
  navigationIsAllowed,
  resolveDevelopmentUserDataDir
} from "../../electron/security-policy.js";

const workspacePath = path.resolve(".tmp/vitest-electron-workspace");
const unrelatedPath = path.resolve(".tmp/vitest-electron-unrelated");

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  await rm(unrelatedPath, { recursive: true, force: true });
});

describe("Electron shell path allowlist", () => {
  it("keeps node-test app data inside the repository temp directory", () => {
    expect(appDataDir).toBe(path.resolve(".tmp/vitest-app-data"));
  });

  it("keeps desktop development data separate from installed app data", () => {
    expect(resolveDevelopmentUserDataDir("/repo/latex-question-bank")).toBe(
      path.resolve("/repo/latex-question-bank/.tmp/electron-dev-app-data")
    );
  });

  it("allows only current or recent workspace roots", async () => {
    await createEmptyWorkspace(workspacePath);
    await expect(isKnownWorkspacePath(workspacePath)).resolves.toBe(true);
    await expect(isKnownWorkspacePath(path.join(workspacePath, "bank.json"))).resolves.toBe(false);
    await expect(isKnownWorkspacePath(unrelatedPath)).resolves.toBe(false);
  });

  it("enforces executable window, sender, navigation, and close policies", () => {
    expect(createSecureWebPreferences("/safe/preload.cjs")).toEqual({
      preload: "/safe/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });

    expect(navigationIsAllowed("http://127.0.0.1:5174/settings", "http://127.0.0.1:5174"))
      .toBe(true);
    expect(navigationIsAllowed("http://127.0.0.1:9999/", "http://127.0.0.1:5174"))
      .toBe(false);
    expect(navigationIsAllowed("not a url", "http://127.0.0.1:5174")).toBe(false);

    expect(classifySender({
      senderId: 7,
      expectedSenderId: 7,
      senderUrl: "http://127.0.0.1:5174/editor",
      currentUrl: "http://127.0.0.1:5174/"
    })).toBe("trusted");
    expect(classifySender({
      senderId: 8,
      expectedSenderId: 7,
      senderUrl: "http://127.0.0.1:5174/",
      currentUrl: "http://127.0.0.1:5174/"
    })).toBe("wrong-window");
    expect(classifySender({
      senderId: 7,
      expectedSenderId: 7,
      senderUrl: "https://example.invalid/",
      currentUrl: "http://127.0.0.1:5174/"
    })).toBe("wrong-origin");

    expect(classifyExternalUrl("https://example.com/docs", "http://127.0.0.1:5174"))
      .toBe("external");
    expect(classifyExternalUrl("http://127.0.0.1:5174/tmp/item.pdf", "http://127.0.0.1:5174"))
      .toBe("local");
    expect(classifyExternalUrl("http://example.com/", "http://127.0.0.1:5174"))
      .toBe("blocked");
    expect(classifyExternalUrl("javascript:alert(1)", "http://127.0.0.1:5174"))
      .toBe("blocked");

    expect(isCloseResponse({ requestId: "round-1", ok: true })).toBe(true);
    expect(isCloseResponse({ requestId: "round-1", ok: false, error: "save failed" })).toBe(true);
    expect(isCloseResponse({ requestId: "round-1", ok: "yes" })).toBe(false);
    expect(isCloseResponse({ requestId: "round-1", ok: false, error: 42 })).toBe(false);
  });

  it("keeps packaged mock-keychain metadata and cleanup command", async () => {
    const packageMetadata = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
      build?: { extraMetadata?: { lqbUseMockKeychain?: boolean } };
      scripts?: { "dist:mac"?: string };
    };
    expect(packageMetadata.build?.extraMetadata?.lqbUseMockKeychain).toBe(true);
    expect(packageMetadata.scripts?.["dist:mac"]).toContain("cleanup-macos-unpacked.mjs");
  });
});

it("rejects close responses without a valid request identity", () => {
  expect(isCloseResponse({ ok: true })).toBe(false);
  expect(isCloseResponse({ ok: true, requestId: "" })).toBe(false);
  expect(isCloseResponse({ ok: true, requestId: 1 })).toBe(false);
});
