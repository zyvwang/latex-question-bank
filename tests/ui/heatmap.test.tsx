import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, Bank, QuestionItem } from "../../shared/types.js";
import App from "../../src/App.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

vi.mock("../../src/components/LatexPreview.js", () => ({
  LatexPreview: ({ tex }: { tex: string }) => (
    <div data-testid="latex-preview">{tex}</div>
  )
}));

const appInfo: AppInfo = {
  appState: {
    version: 1,
    currentWorkspacePath: "/tmp/heatmap-bank",
    recentWorkspacePaths: ["/tmp/heatmap-bank"]
  },
  currentWorkspaceName: "heatmap-bank",
  currentWorkspacePath: "/tmp/heatmap-bank",
  recentWorkspaces: [
    { name: "heatmap-bank", path: "/tmp/heatmap-bank", exists: true }
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

let currentBank: Bank;

beforeEach(() => {
  vi.useRealTimers();
  currentBank = heatmapBank();
  vi.stubGlobal("fetch", vi.fn(handleFetch));
});

describe("heatmap UI", () => {
  it("shows full chapter labels, three modes, semantic marks, and accessible cells", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "热力图" }));
    expect(screen.getByRole("heading", { name: "热力图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "题库设置" })).toBeInTheDocument();

    expect(screen.queryByRole("navigation", {
      name: "热力图章节索引"
    })).not.toBeInTheDocument();
    const grid = screen.getByRole("region", { name: "题目掌握热力图" });
    expect(within(grid).getByText("高等数学与极限")).toBeInTheDocument();
    expect(within(grid).getByText("线性代数与矩阵")).toBeInTheDocument();
    expect(within(grid).getByText("未分类")).toBeInTheDocument();

    const first = screen.getByRole("button", {
      name: /章节 高等数学与极限，章内第 1 题，原编号 2026-A，掌握程度 待巩固，错误原因 计算、方法、审题、格式/
    });
    expect(first).toHaveAttribute("data-heatmap-mode", "mastery");

    await user.click(screen.getByRole("button", { name: "错误原因" }));
    expect(first).toHaveAttribute("data-heatmap-mode", "errorReason");
    expect(first.querySelector("[data-error-stripes='3']")).not.toBeNull();
    expect(within(first).getByText("+1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "组合" }));
    expect(first).toHaveAttribute("data-heatmap-mode", "combined");
    expect(first.querySelector("[data-error-marks='3']")).not.toBeNull();
    expect(within(first).getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("颜色同时配合图案、角标和文字说明。"))
      .toBeInTheDocument();
  });

  it("updates one preview only after a stable 200ms target and resets its module", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "热力图" }));

    expect(screen.getAllByTestId("latex-preview")).toHaveLength(1);
    expect(screen.getByTestId("latex-preview")).toHaveTextContent("题目 A");
    await user.click(screen.getByRole("tab", { name: "解析" }));
    expect(screen.getByTestId("latex-preview")).toHaveTextContent("解析 A");

    const matrix = screen.getByRole("button", {
      name: /原编号 2026-M/
    });
    await user.hover(matrix);
    await delay(100);
    expect(screen.getByTestId("latex-preview")).toHaveTextContent("解析 A");
    await waitFor(
      () => expect(screen.getByTestId("latex-preview")).toHaveTextContent("题目 M"),
      { timeout: 500 }
    );
    expect(screen.getByRole("tab", { name: "题目" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("latex-preview")).toHaveLength(1);
  });

  it("supports roving keyboard focus and restores mode, scroll, and focus after editing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "热力图" }));

    const first = screen.getByRole("button", { name: /原编号 2026-A/ });
    const second = screen.getByRole("button", { name: /原编号 2026-B/ });
    await user.click(screen.getByRole("button", { name: "组合" }));
    first.focus();
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("tabindex", "0");
    await user.keyboard("{Home}");
    expect(first).toHaveFocus();
    await user.keyboard("{End}");
    expect(second).toHaveFocus();

    const gridPane = screen.getByRole("region", {
      name: "题目热力图滚动区域"
    });
    gridPane.scrollTop = 137;
    await user.keyboard("{Enter}");

    expect(await screen.findByLabelText("原编号")).toHaveValue("2026-B");
    await user.click(screen.getByRole("button", { name: "热力图" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /原编号 2026-B/ })).toHaveFocus()
    );
    expect(screen.getByRole("button", { name: "组合" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", {
      name: "题目热力图滚动区域"
    })).toHaveProperty("scrollTop", 137);
  });

  it("renders a 1000-item fixture with one preview and keeps mode input responsive", async () => {
    currentBank = largeBank();
    render(<App />);
    await screen.findByRole("button", { name: "热力图" });

    const startedAt = performance.now();
    fireEvent.click(screen.getByRole("button", { name: "热力图" }));
    await waitFor(
      () =>
        expect(document.querySelectorAll("[data-heatmap-cell]"))
          .toHaveLength(1000),
      { timeout: 5000 }
    );
    expect(performance.now() - startedAt).toBeLessThan(5000);
    expect(screen.getAllByTestId("latex-preview")).toHaveLength(1);

    const modeStartedAt = performance.now();
    fireEvent.click(screen.getByRole("button", { name: "错误原因" }));
    await waitFor(() =>
      expect(document.querySelector("[data-heatmap-cell]"))
        .toHaveAttribute("data-heatmap-mode", "errorReason")
    );
    expect(performance.now() - modeStartedAt).toBeLessThan(2000);
  }, 20_000);
});

async function handleFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = String(input);
  if (url === "/api/app") return json(appInfo);
  if (url === "/api/bank" && !init) {
    return json({
      workspacePath: appInfo.currentWorkspacePath,
      revision: "heatmap-revision",
      bank: currentBank
    });
  }
  if (url === "/api/bank" && init?.method === "PUT") {
    const request = JSON.parse(String(init.body)) as {
      workspacePath: string;
      bank: Bank;
    };
    currentBank = request.bank;
    return json({
      workspacePath: request.workspacePath,
      revision: "saved-heatmap-revision",
      bank: request.bank
    });
  }
  if (url === "/api/exports/default-name") {
    return json({ exportName: "questions-2026-07-26-1" });
  }
  return json({ error: `Unhandled ${url}` }, 404);
}

function heatmapBank(): Bank {
  const timestamp = "2026-07-26T08:00:00.000Z";
  const masteryOptions: Bank["masteryOptions"] = [
    {
      id: "mastery-review",
      name: "待巩固",
      order: 1,
      color: "#9A4C35",
      pattern: "diagonal"
    },
    {
      id: "mastery-ready",
      name: "已掌握",
      order: 2,
      color: "#2F766F",
      pattern: "solid"
    }
  ];
  const errorReasonOptions: Bank["errorReasonOptions"] = [
    { id: "error-calc", name: "计算", order: 1, color: "#A9571C", pattern: "diagonal" },
    { id: "error-method", name: "方法", order: 2, color: "#74558F", pattern: "crosshatch" },
    { id: "error-read", name: "审题", order: 3, color: "#3D6E91", pattern: "dots" },
    { id: "error-format", name: "格式", order: 4, color: "#7D6641", pattern: "solid" }
  ];
  const item = (
    id: string,
    chapterId: string | null,
    chapterOrder: number,
    sourceNumber: string,
    marker: string,
    errors = ["error-calc"]
  ): QuestionItem => ({
    id,
    chapterId,
    chapterOrder,
    sourceNumber,
    tags: [],
    masteryOptionId: chapterOrder % 2 ? "mastery-review" : "mastery-ready",
    errorReasonOptionIds: errors,
    modules: {
      question: { tex: `题目 ${marker} $x$` },
      solution: { tex: `解析 ${marker} $y$` },
      note: { tex: `笔记 ${marker}` }
    },
    assets: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });
  return {
    version: 2,
    settings: {
      pageSize: "a4",
      spacing: { item: "1em", module: "0.5em" },
      preamble: ""
    },
    chapters: [
      { id: "chapter-calculus", name: "高等数学与极限", order: 1 },
      { id: "chapter-matrix", name: "线性代数与矩阵", order: 2 }
    ],
    masteryOptions,
    errorReasonOptions,
    masteryHistory: [],
    items: [
      item(
        "limit-a",
        "chapter-calculus",
        1,
        "2026-A",
        "A",
        errorReasonOptions.map((option) => option.id)
      ),
      item("limit-b", "chapter-calculus", 2, "2026-B", "B"),
      item("matrix-m", "chapter-matrix", 1, "2026-M", "M"),
      item("loose-u", null, 1, "", "U", [])
    ]
  };
}

function largeBank(): Bank {
  const base = heatmapBank();
  const chapters = Array.from({ length: 10 }, (_, index) => ({
    id: `chapter-${index + 1}`,
    name: `性能章节 ${index + 1}`,
    order: index + 1
  }));
  const items = chapters.flatMap((chapter) =>
    Array.from({ length: 100 }, (_, index) => ({
      ...base.items[0],
      id: `${chapter.id}-item-${index + 1}`,
      chapterId: chapter.id,
      chapterOrder: index + 1,
      sourceNumber: `${chapter.order}-${index + 1}`,
      modules: {
        question: { tex: `题目 ${chapter.order}-${index + 1} $x$` },
        solution: { tex: "解析" },
        note: { tex: "" }
      }
    }))
  );
  return { ...base, chapters, items };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
