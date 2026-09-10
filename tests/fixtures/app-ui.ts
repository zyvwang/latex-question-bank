import { beforeEach, vi } from "vitest";
import type { AppInfo, Bank } from "../../shared/types.js";
export const appInfo: AppInfo = {
  appState: {
    version: 1,
    currentWorkspacePath: "/tmp/latex-bank",
    recentWorkspacePaths: ["/tmp/latex-bank", "/tmp/other-bank"]
  },
  currentWorkspaceName: "latex-bank",
  currentWorkspacePath: "/tmp/latex-bank",
  recentWorkspaces: [
    { name: "latex-bank", path: "/tmp/latex-bank", exists: true },
    { name: "other-bank", path: "/tmp/other-bank", exists: true }
  ],
  texStatus: {
    available: true,
    command: "latexmk",
    source: "path",
    message: "已检测到 LaTeX：latexmk"
  },
  isDesktop: false,
  setupRequired: false
};

export const bank: Bank = {
  version: 2,
  settings: {
    pageSize: "a4",
    spacing: { item: "1.0em", module: "0.45em" },
    preamble: "% test"
  },
  chapters: [
    { id: "chapter-calculus", name: "高等数学/极限", order: 1 },
    { id: "chapter-linear-algebra", name: "线性代数/矩阵", order: 2 }
  ],
  masteryOptions: [
    { id: "mastery-easy", name: "很简单", order: 1, color: "#2F766F", pattern: "solid" },
    { id: "mastery-hard", name: "太难了", order: 2, color: "#B84A3A", pattern: "crosshatch" }
  ],
  errorReasonOptions: [
    { id: "error-calculation", name: "计算问题", order: 1, color: "#A9571C", pattern: "diagonal" },
    { id: "error-method", name: "方法问题", order: 2, color: "#74558F", pattern: "crosshatch" }
  ],
  masteryHistory: [],
  items: [
    {
      id: "limit",
      sourceNumber: "2024-1",
      chapterId: "chapter-calculus",
      chapterOrder: 1,
      tags: ["极限"],
      masteryOptionId: "mastery-hard",
      errorReasonOptionIds: ["error-method"],
      modules: {
        question: { tex: "求极限 $x$。" },
        solution: { tex: "答案。" },
        note: { tex: "备注。" }
      },
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "matrix",
      sourceNumber: "2024-2",
      chapterId: "chapter-linear-algebra",
      chapterOrder: 1,
      tags: ["矩阵"],
      masteryOptionId: "mastery-easy",
      errorReasonOptionIds: ["error-calculation"],
      modules: {
        question: { tex: "求矩阵秩。" },
        solution: { tex: "答案。" },
        note: { tex: "" }
      },
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ]
};


export const fixtureState: { nextExportName: string; compileResponder: (() => Promise<Response>) | null } = { nextExportName: "", compileResponder: null };
export function setupAppFixture() {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    fixtureState.nextExportName = "questions-2026-06-13-1";
    fixtureState.compileResponder = null;
    vi.stubGlobal("fetch", vi.fn(handleFetch));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    delete window.lqb;
  });
}
export async function handleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === "/api/app") return json(appInfo);
  if (url === "/api/bank" && !init) {
    return json({ workspacePath: "/tmp/latex-bank", revision: "revision-1", bank });
  }
  if (url === "/api/bank/head") {
    return json({
      workspacePath: "/tmp/latex-bank",
      revision: "revision-1"
    });
  }
  if (url === "/api/bank" && init?.method === "PUT") {
    const request = JSON.parse(String(init.body)) as { workspacePath: string; bank: Bank };
    return json({ workspacePath: request.workspacePath, revision: crypto.randomUUID(), bank: request.bank });
  }
  if (url === "/api/workspaces/switch") {
    const nextAppInfo = {
      ...appInfo,
      currentWorkspaceName: "other-bank",
      currentWorkspacePath: "/tmp/other-bank",
      appState: {
        ...appInfo.appState,
        currentWorkspacePath: "/tmp/other-bank"
      }
    };
    return json({
      appInfo: nextAppInfo,
      snapshot: {
        workspacePath: "/tmp/other-bank",
        revision: "other-revision",
        bank
      }
    });
  }
  if (
    url === "/api/workspaces/create-empty" ||
    url === "/api/workspaces/create-sample" ||
    url === "/api/workspaces/open"
  ) {
    const request = JSON.parse(String(init?.body)) as {
      workspacePath: string;
    };
    const currentWorkspaceName =
      request.workspacePath.split("/").filter(Boolean).at(-1) ?? "bank";
    const nextAppInfo = {
      ...appInfo,
      currentWorkspaceName,
      currentWorkspacePath: request.workspacePath,
      appState: {
        ...appInfo.appState,
        currentWorkspacePath: request.workspacePath,
        recentWorkspacePaths: [
          request.workspacePath,
          ...appInfo.appState.recentWorkspacePaths
        ]
      },
      recentWorkspaces: [
        {
          name: currentWorkspaceName,
          path: request.workspacePath,
          exists: true
        },
        ...appInfo.recentWorkspaces
      ]
    };
    return json({
      appInfo: nextAppInfo,
      snapshot: {
        workspacePath: request.workspacePath,
        revision: "workspace-transition-revision",
        bank
      }
    });
  }
  if (url === "/api/tex-path") {
    const request = JSON.parse(String(init?.body)) as { texPath?: string };
    return json({
      ...appInfo,
      appState: {
        ...appInfo.appState,
        texPathOverride: request.texPath
      }
    });
  }
  if (url === "/api/assets") {
    return json({
      asset: {
        id: "asset-1",
        fileName: "asset.png",
        originalName: "figure.png",
        relativePath: "assets/asset.png",
        mimeType: "image/png",
        size: 5,
        uploadedAt: "2026-01-01T00:00:00.000Z"
      },
      url: "/assets/asset.png",
      insertText: "\\includegraphics{assets/asset.png}"
    });
  }
  if (url === "/api/compile-item") {
    return fixtureState.compileResponder ? fixtureState.compileResponder() : compileSuccess();
  }
  if (url === "/api/exports/default-name") {
    return json({ exportName: fixtureState.nextExportName });
  }
  if (url === "/api/exports/reveal") {
    return json({ ok: true });
  }
  if (url === "/api/export") {
    const request = JSON.parse(String(init?.body)) as { fileName: string };
    const sequence = /^(questions-\d{4}-\d{2}-\d{2})-(\d+)$/.exec(request.fileName);
    if (sequence) fixtureState.nextExportName = `${sequence[1]}-${Number(sequence[2]) + 1}`;
    return json({
      ok: true,
      exportName: request.fileName,
      exportPath: `/tmp/latex-bank/exports/${request.fileName}`,
      files: ["questions.tex", "questions.pdf", "full.tex", "full.pdf"],
      results: {
        questions: { ok: true, texPath: "questions.tex", pdfPath: "questions.pdf", log: "" },
        full: { ok: true, texPath: "full.tex", pdfPath: "full.pdf", log: "" }
      }
    });
  }
  return json({ error: `Unhandled ${url}` }, 404);
}

export function compileSuccess(): Response {
  return json({
    ok: true,
    texPath: "/tmp/current-item.tex",
    pdfPath: "/tmp/current-item.pdf",
    texUrl: "/tmp/current-item.tex",
    pdfUrl: "/tmp/current-item.pdf",
    log: ""
  });
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
