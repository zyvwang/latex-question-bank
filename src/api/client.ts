import type {
  AppInfo,
  AssetUploadResponse,
  Bank,
  BankHead,
  BankSnapshot,
  CompileResponse,
  ExportDefaultNameResponse,
  ExportRequest,
  ExportResponse,
  QuestionItem,
  RecoveryCandidate,
  SaveBankAsRequest,
  SaveBankAsResponse,
  SaveBankRequest,
  WorkspaceTransitionResponse
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

export async function fetchBankHead(): Promise<BankHead> {
  return fetchJson<BankHead>("/api/bank/head");
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
  return requestJson<BankSnapshot>("/api/bank", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body
  });
}

export async function fetchRecoveryCandidates(): Promise<RecoveryCandidate[]> {
  const data = await fetchJson<{ candidates: RecoveryCandidate[] }>("/api/recovery");
  return data.candidates;
}

export async function recoverBank(candidateId: string, workspacePath: string): Promise<BankSnapshot> {
  return postJson<BankSnapshot>("/api/recovery", { candidateId, workspacePath });
}

export async function createSampleWorkspace(
  workspacePath: string
): Promise<WorkspaceTransitionResponse> {
  return postJson<WorkspaceTransitionResponse>(
    "/api/workspaces/create-sample",
    { workspacePath }
  );
}

export async function createEmptyWorkspace(
  workspacePath: string
): Promise<WorkspaceTransitionResponse> {
  return postJson<WorkspaceTransitionResponse>(
    "/api/workspaces/create-empty",
    { workspacePath }
  );
}

export async function saveBankAs(request: SaveBankAsRequest): Promise<SaveBankAsResponse> {
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > BANK_SAVE_BODY_LIMIT_BYTES) {
    throw new ApiRequestError(
      BANK_PAYLOAD_TOO_LARGE_MESSAGE,
      413,
      BANK_PAYLOAD_TOO_LARGE_CODE
    );
  }
  return requestJson<SaveBankAsResponse>("/api/workspaces/save-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}

export async function openExistingWorkspace(
  workspacePath: string
): Promise<WorkspaceTransitionResponse> {
  return postJson<WorkspaceTransitionResponse>("/api/workspaces/open", {
    workspacePath
  });
}

export async function switchWorkspace(
  workspacePath: string
): Promise<WorkspaceTransitionResponse> {
  return postJson<WorkspaceTransitionResponse>("/api/workspaces/switch", {
    workspacePath
  });
}

export async function relocateWorkspace(
  workspacePath: string,
  replacementPath: string
): Promise<WorkspaceTransitionResponse> {
  return postJson<WorkspaceTransitionResponse>("/api/workspaces/relocate", {
    workspacePath,
    replacementPath
  });
}

export async function moveWorkspace(workspacePath: string, direction: "up" | "down"): Promise<AppInfo> {
  return postJson<AppInfo>("/api/workspaces/move", { workspacePath, direction });
}

export async function removeWorkspace(
  workspacePath: string
): Promise<WorkspaceTransitionResponse> {
  return postJson<WorkspaceTransitionResponse>("/api/workspaces/remove", {
    workspacePath
  });
}

export async function saveTexPath(texPath: string): Promise<AppInfo> {
  return postJson<AppInfo>("/api/tex-path", { texPath });
}

export async function uploadQuestionAsset(file: File, workspacePath: string): Promise<AssetUploadResponse> {
  const formData = new FormData();
  formData.append("workspacePath", workspacePath);
  formData.append("file", file);
  return requestJson<AssetUploadResponse>("/api/assets", { method: "POST", body: formData });
}

export async function compileItem(item: QuestionItem, settings: Bank["settings"], workspacePath: string): Promise<CompileResponse> {
  return requestJson<CompileResponse>("/api/compile-item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item, settings, workspacePath })
  }, {
    allowedErrorStatuses: [422]
  });
}

export async function exportItems(input: ExportRequest): Promise<ExportResponse> {
  return requestJson<ExportResponse>("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }, {
    allowedErrorStatuses: [422]
  });
}

export async function fetchDefaultExportName(): Promise<string> {
  const data = await fetchJson<ExportDefaultNameResponse>("/api/exports/default-name");
  return data.exportName;
}

export async function revealExportFolder(exportName: string): Promise<void> {
  await postJson<{ ok: true }>("/api/exports/reveal", { exportName });
}

async function fetchJson<T>(url: string): Promise<T> {
  return requestJson<T>(url);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

const pendingWorkspaceWrites = new Set<Promise<unknown>>();
let pendingSaveAs: Promise<unknown> | null = null;

export async function confirmSaveBankAs(): Promise<SaveBankAsResponse> {
  if (!pendingSaveAs) throw new Error("没有待确认的另存操作。");
  const operation = pendingSaveAs;
  const result = await deadline(operation, 15_000, true) as SaveBankAsResponse;
  if (pendingSaveAs === operation) pendingSaveAs = null;
  return result;
}

export async function waitForWorkspaceWrites(): Promise<void> {
  await deadline(Promise.allSettled([...pendingWorkspaceWrites]), 15_000, false);
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  options: { allowedErrorStatuses?: number[] } = {}
): Promise<T> {
  const writing = Boolean(init?.method && init.method !== "GET");
  const timeout = url === "/api/export" ? 180_000
    : url === "/api/compile-item" ? 75_000 : writing ? 60_000 : 15_000;
  const controller = new AbortController();
  const operation = fetch(url, { ...init, signal: controller.signal })
    .then((response) => readJsonResponse<T>(response, options));
  // Keep workspace writes observable after the UI deadline. Aborting the fetch
  // would discard the response without proving that the server stopped writing.
  const workspaceWrite = writing && (url.startsWith("/api/workspaces/") || url === "/api/recovery");
  if (url === "/api/workspaces/save-as") pendingSaveAs = operation;
  if (workspaceWrite) {
    pendingWorkspaceWrites.add(operation);
    void operation.finally(() => pendingWorkspaceWrites.delete(operation)).catch(() => undefined);
  }
  try {
    const result = await deadline(operation, timeout, writing);
    if (pendingSaveAs === operation) pendingSaveAs = null;
    return result;
  } catch (error) {
    if (error instanceof ApiRequestError) error.requestUrl = url;
    throw error;
  } finally {
    if (!writing) controller.abort();
  }
}

async function deadline<T>(operation: Promise<T>, timeout: number, writing: boolean): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ApiRequestError(
          writing ? "请求超时，操作结果尚未确认。请核对后重试；后台任务可能仍在执行。"
            : "请求超时，请重试。",
          0,
          writing ? "WRITE_RESULT_UNKNOWN" : "REQUEST_TIMEOUT"
        )), timeout);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse<T>(
  response: Response,
  options: { allowedErrorStatuses?: number[] } = {}
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
  if (
    !response.ok &&
    !options.allowedErrorStatuses?.includes(response.status)
  ) {
    throw new ApiRequestError(data.error ?? "请求失败。", response.status, data.code);
  }
  return data;
}

export class ApiRequestError extends Error {
  requestUrl?: string;
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}
