import type { WebPreferences } from "electron";

export interface RendererCloseResponse {
  ok: boolean;
  error?: string;
}

export type SenderTrust = "trusted" | "wrong-window" | "wrong-origin";
export type ExternalUrlPolicy = "local" | "external" | "blocked";

export function createSecureWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  };
}

export function hasOrigin(value: string, expectedOrigin: string): boolean {
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function navigationIsAllowed(
  targetUrl: string,
  trustedOrigin: string
): boolean {
  return hasOrigin(targetUrl, trustedOrigin);
}

export function classifyExternalUrl(
  value: string,
  localAppUrl: string | null
): ExternalUrlPolicy {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return "external";
    if (
      localAppUrl &&
      hasOrigin(value, new URL(localAppUrl).origin)
    ) {
      return "local";
    }
    return "blocked";
  } catch {
    return "blocked";
  }
}

export function classifySender(input: {
  senderId: number;
  expectedSenderId: number | null;
  senderUrl?: string;
  currentUrl?: string;
}): SenderTrust {
  if (
    input.expectedSenderId === null ||
    input.senderId !== input.expectedSenderId
  ) {
    return "wrong-window";
  }
  if (!input.senderUrl || !input.currentUrl) {
    return "wrong-origin";
  }
  try {
    if (!hasOrigin(input.senderUrl, new URL(input.currentUrl).origin)) {
      return "wrong-origin";
    }
  } catch {
    return "wrong-origin";
  }
  return "trusted";
}

export function isCloseResponse(
  value: unknown
): value is RendererCloseResponse {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  if (typeof value.ok !== "boolean") return false;
  return (
    !("error" in value) ||
    value.error === undefined ||
    typeof value.error === "string"
  );
}
