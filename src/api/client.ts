import type {
  AppInfo,
  AssetUploadResponse,
  Bank,
  BankSnapshot,
  CompileResponse,
  ExportDefaultNameResponse,
  ExportOrderMode,
  ExportResponse,
  QuestionItem,
  RecoveryCandidate,
  SaveBankRequest
} from "../../shared/types.js";
import {
  BANK_PAYLOAD_TOO_LARGE_CODE,
  BANK_PAYLOAD_TOO_LARGE_MESSAGE,
  BANK_SAVE_BODY_LIMIT_BYTES
} from "../../shared/api-limits.js";

export async function fetchAppInfo(): Promise<AppInfo> {
  return fetchJson<AppInfo>("/api/app");
}

export async function fetchBank(): Promise<BankSnapshot> {
  return fetchJson<BankSnapshot>("/api/bank");
}

export async function saveBank(request: SaveBankRequest): Promise<BankSnapshot> {
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > BANK_SAVE_BODY_LIMIT_BYTES) {
    throw new ApiRequestError(
      BANK_PAYLOAD_TOO_LARGE_MESSAGE,
      413,
      BANK_PAYLOAD_TOO_LARGE_CODE
    );
  }
  const response = await fetch("/api/bank", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body
  });
  return readJsonResponse<BankSnapshot>(response);
}

export async function fetchRecoveryCandidates(): Promise<RecoveryCandidate[]> {
  const data = await fetchJson<{ candidates: RecoveryCandidate[] }>("/api/recovery");
  return data.candidates;
}

export async function recoverBank(candidateId: string): Promise<BankSnapshot> {
  return postJson<BankSnapshot>("/api/recovery", { candidateId });
}

export async function createSampleWorkspace(workspacePath: string): Promise<AppInfo> {
  return postJson<AppInfo>("/api/workspaces/create-sample", { workspacePath });
}

export async function createEmptyWorkspace(workspacePath: string): Promise<AppInfo> {
  return postJson<AppInfo>("/api/workspaces/create-empty", { workspacePath });
}

export async function openExistingWorkspace(workspacePath: string): Promise<AppInfo> {
  return postJson<AppInfo>("/api/workspaces/open", { workspacePath });
}

export async function switchWorkspace(workspacePath: string): Promise<AppInfo> {
  return postJson<AppInfo>("/api/workspaces/switch", { workspacePath });
}

export async function moveWorkspace(workspacePath: string, direction: "up" | "down"): Promise<AppInfo> {
  return postJson<AppInfo>("/api/workspaces/move", { workspacePath, direction });
}

export async function removeWorkspace(workspacePath: string): Promise<AppInfo> {
  return postJson<AppInfo>("/api/workspaces/remove", { workspacePath });
}

export async function saveTexPath(texPath: string): Promise<AppInfo> {
  return postJson<AppInfo>("/api/tex-path", { texPath });
}

export async function uploadQuestionAsset(file: File): Promise<AssetUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/assets", { method: "POST", body: formData });
  return readJsonResponse<AssetUploadResponse>(response);
}

export async function compileItem(item: QuestionItem, settings: Bank["settings"]): Promise<CompileResponse> {
  const response = await fetch("/api/compile-item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item, settings })
  });
  return readJsonResponse<CompileResponse>(response, { allowErrorPayload: true });
}

export async function exportItems(input: {
  itemIds: string[];
  fileName: string;
  orderMode: ExportOrderMode;
  randomSeed?: string;
}): Promise<ExportResponse> {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJsonResponse<ExportResponse>(response, { allowErrorPayload: true });
}

export async function fetchDefaultExportName(): Promise<string> {
  const data = await fetchJson<ExportDefaultNameResponse>("/api/exports/default-name");
  return data.exportName;
}

export async function revealExportFolder(exportName: string): Promise<void> {
  await postJson<{ ok: true }>("/api/exports/reveal", { exportName });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return readJsonResponse<T>(response);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readJsonResponse<T>(response);
}

async function readJsonResponse<T>(
  response: Response,
  options: { allowErrorPayload?: boolean } = {}
): Promise<T> {
  // 非 JSON 响应(代理错误页、SPA 兜底 HTML)先转成带状态码的 ApiRequestError,
  // 否则用户看到的是 "Unexpected token '<'"。
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiRequestError(
      `服务器返回了非 JSON 响应（HTTP ${response.status}）。`,
      response.status,
      "RESPONSE_NOT_JSON"
    );
  }
  const data = (await response.json()) as T & { error?: string; code?: string };
  if (!response.ok && !options.allowErrorPayload) {
    throw new ApiRequestError(data.error ?? "请求失败。", response.status, data.code);
  }
  return data;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}
